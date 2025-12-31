//+------------------------------------------------------------------+
//|                                        TradeCopierReceiver.mq5   |
//|                   Trade Copier Receiver - Local Execution        |
//|                        Standalone EA - No Cloud Connection       |
//+------------------------------------------------------------------+
#property copyright "Trade Copier Receiver"
#property link      ""
#property version   "1.00"
#property description "Receives trade events from local queue and executes on this account"
#property description "Config-driven via copier-config.json downloaded from web app"
#property description "PROP FIRM SAFE: All execution happens locally"

//+------------------------------------------------------------------+
//| Input Parameters                                                  |
//+------------------------------------------------------------------+
input group "=== Config Settings ==="
input string   InpConfigPath         = "copier-config.json";      // Config file path
input string   InpReceiverId         = "";                         // This receiver's ID (leave empty to auto-detect)

input group "=== Queue Settings ==="
input string   InpQueuePath          = "CopierQueue";              // Queue folder path (from Master EA)
input int      InpPollIntervalMs     = 1000;                       // Poll interval (ms) - overridden by config

input group "=== Safety Overrides ==="
input bool     InpEnableKillSwitch   = false;                      // Emergency stop all copying
input double   InpSlippageOverride   = 0;                          // Override max slippage (0 = use config)
input double   InpDailyLossOverride  = 0;                          // Override daily loss limit (0 = use config)

input group "=== Logging ==="
input bool     InpEnableLogging      = true;                       // Enable file logging
input bool     InpVerboseMode        = false;                      // Verbose console output

//+------------------------------------------------------------------+
//| Structures                                                        |
//+------------------------------------------------------------------+
struct ReceiverConfig
{
   string   receiver_id;
   string   account_name;
   string   risk_mode;
   double   risk_value;
   double   max_slippage_pips;
   double   max_daily_loss_r;
   string   allowed_sessions[];
   bool     manual_confirm_mode;
   bool     prop_firm_safe_mode;
   int      poll_interval_ms;
};

struct SymbolMapping
{
   string   master_symbol;
   string   receiver_symbol;
};

struct PositionMap
{
   long     master_position_id;
   long     receiver_position_id;
   string   symbol;
   string   direction;
   double   lots;
};

struct ExecutedEvent
{
   string   idempotency_key;
   long     receiver_position_id;
   datetime executed_at;
   double   slippage_pips;
};

//+------------------------------------------------------------------+
//| Global Variables                                                  |
//+------------------------------------------------------------------+
ReceiverConfig g_config;
SymbolMapping  g_symbolMappings[];
PositionMap    g_positionMaps[];
ExecutedEvent  g_executedEvents[];

string         g_logFileName         = "TradeCopierReceiver.log";
string         g_positionsFile       = "copier-positions.json";
string         g_executedFile        = "copier-executed.json";
string         g_pendingFolder       = "";
string         g_executedFolder      = "";
int            g_logHandle           = INVALID_HANDLE;
datetime       g_lastPoll            = 0;
datetime       g_lastHeartbeatCheck  = 0;
double         g_dailyPnL            = 0;
datetime       g_dailyPnLDate        = 0;
bool           g_configLoaded        = false;
int            g_configVersion       = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   // Setup folder paths
   g_pendingFolder = InpQueuePath + "\\pending";
   g_executedFolder = InpQueuePath + "\\executed";
   
   // Initialize logging
   if(InpEnableLogging)
   {
      g_logHandle = FileOpen(g_logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      if(g_logHandle != INVALID_HANDLE)
      {
         FileSeek(g_logHandle, 0, SEEK_END);
         LogMessage("=== Trade Copier Receiver v1.00 Started ===");
         LogMessage("Account: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
      }
   }
   
   // Load configuration
   if(!LoadConfig())
   {
      Print("ERROR: Failed to load config file: ", InpConfigPath);
      return INIT_PARAMETERS_INCORRECT;
   }
   
   // Load persisted data
   LoadPositionMaps();
   LoadExecutedEvents();
   
   // Calculate today's P&L
   CalculateDailyPnL();
   
   // Set timer for polling
   int pollMs = g_config.poll_interval_ms > 0 ? g_config.poll_interval_ms : InpPollIntervalMs;
   EventSetMillisecondTimer(pollMs);
   
   Print("=================================================");
   Print("Trade Copier Receiver v1.00");
   Print("=================================================");
   Print("Account: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("Broker: ", AccountInfoString(ACCOUNT_COMPANY));
   Print("Config: ", InpConfigPath);
   Print("Receiver ID: ", g_config.receiver_id);
   Print("Risk Mode: ", g_config.risk_mode, " (", g_config.risk_value, ")");
   Print("Poll Interval: ", pollMs, "ms");
   Print("Prop Firm Safe: ", g_config.prop_firm_safe_mode ? "YES" : "NO");
   Print("Symbol Mappings: ", ArraySize(g_symbolMappings));
   Print("=================================================");
   
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   
   // Save state
   SavePositionMaps();
   SaveExecutedEvents();
   
   if(g_logHandle != INVALID_HANDLE)
   {
      LogMessage("=== Trade Copier Receiver Stopped ===");
      FileClose(g_logHandle);
      g_logHandle = INVALID_HANDLE;
   }
   
   Print("Trade Copier Receiver stopped.");
}

//+------------------------------------------------------------------+
//| Timer Handler - Main Poll Loop                                    |
//+------------------------------------------------------------------+
void OnTimer()
{
   // Kill switch check
   if(InpEnableKillSwitch)
   {
      if(InpVerboseMode)
         Print("Kill switch enabled - skipping poll");
      return;
   }
   
   // Check heartbeat (master alive?)
   if(!CheckMasterHeartbeat())
   {
      // Master might be offline - log but continue processing any pending events
   }
   
   // Check daily loss limit
   if(!CheckDailyLossLimit())
   {
      LogMessage("Daily loss limit reached - stopping");
      return;
   }
   
   // Check session filter
   if(!CheckSessionFilter())
   {
      if(InpVerboseMode)
         Print("Outside allowed session - skipping");
      return;
   }
   
   // Process pending events
   ProcessPendingEvents();
}

//+------------------------------------------------------------------+
//| Load Configuration from JSON                                      |
//+------------------------------------------------------------------+
bool LoadConfig()
{
   if(!FileIsExist(InpConfigPath))
   {
      Print("Config file not found: ", InpConfigPath);
      return false;
   }
   
   int handle = FileOpen(InpConfigPath, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      Print("Cannot open config file");
      return false;
   }
   
   string content = "";
   while(!FileIsEnding(handle))
   {
      content += FileReadString(handle) + "\n";
   }
   FileClose(handle);
   
   // Parse config JSON (simplified parser)
   if(!ParseConfigJson(content))
   {
      Print("Failed to parse config JSON");
      return false;
   }
   
   g_configLoaded = true;
   LogMessage("Config loaded successfully");
   return true;
}

//+------------------------------------------------------------------+
//| Parse Config JSON                                                 |
//+------------------------------------------------------------------+
bool ParseConfigJson(string json)
{
   // Extract version
   g_configVersion = (int)ExtractJsonNumber(json, "version");
   
   // Find receivers array
   int receiversStart = StringFind(json, "\"receivers\"");
   if(receiversStart < 0)
   {
      Print("No receivers found in config");
      return false;
   }
   
   // Find this receiver's config
   string receiverId = InpReceiverId;
   
   // If no receiver ID specified, try to match by account number
   if(StringLen(receiverId) == 0)
   {
      // Auto-detect: look for first receiver config
      int receiverStart = StringFind(json, "\"receiver_id\"", receiversStart);
      if(receiverStart > 0)
      {
         receiverId = ExtractJsonString(json, "receiver_id", receiverStart);
      }
   }
   
   if(StringLen(receiverId) == 0)
   {
      Print("Could not determine receiver ID");
      return false;
   }
   
   g_config.receiver_id = receiverId;
   
   // Find this receiver's section
   int configStart = StringFind(json, "\"" + receiverId + "\"");
   if(configStart < 0)
   {
      // Try searching by receiver_id value
      configStart = StringFind(json, receiverId);
   }
   
   // Parse receiver settings (find the correct receiver block)
   // For simplicity, we'll parse the first receiver's settings
   g_config.account_name = ExtractJsonString(json, "account_name", receiversStart);
   
   // Parse risk settings
   int riskStart = StringFind(json, "\"risk\"", receiversStart);
   if(riskStart > 0)
   {
      g_config.risk_mode = ExtractJsonString(json, "mode", riskStart);
      g_config.risk_value = ExtractJsonNumber(json, "value", riskStart);
   }
   else
   {
      g_config.risk_mode = "balance_multiplier";
      g_config.risk_value = 1.0;
   }
   
   // Parse safety settings
   int safetyStart = StringFind(json, "\"safety\"", receiversStart);
   if(safetyStart > 0)
   {
      g_config.max_slippage_pips = ExtractJsonNumber(json, "max_slippage_pips", safetyStart);
      g_config.max_daily_loss_r = ExtractJsonNumber(json, "max_daily_loss_r", safetyStart);
      g_config.manual_confirm_mode = ExtractJsonBool(json, "manual_confirm_mode", safetyStart);
      g_config.prop_firm_safe_mode = ExtractJsonBool(json, "prop_firm_safe_mode", safetyStart);
      g_config.poll_interval_ms = (int)ExtractJsonNumber(json, "poll_interval_ms", safetyStart);
   }
   else
   {
      g_config.max_slippage_pips = 3.0;
      g_config.max_daily_loss_r = 3.0;
      g_config.manual_confirm_mode = false;
      g_config.prop_firm_safe_mode = false;
      g_config.poll_interval_ms = 1000;
   }
   
   // Parse symbol mappings
   int mappingsStart = StringFind(json, "\"symbol_mappings\"", receiversStart);
   if(mappingsStart > 0)
   {
      ParseSymbolMappings(json, mappingsStart);
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Parse Symbol Mappings from JSON                                   |
//+------------------------------------------------------------------+
void ParseSymbolMappings(string json, int startPos)
{
   ArrayResize(g_symbolMappings, 0);
   
   // Find the mappings object
   int braceStart = StringFind(json, "{", startPos);
   if(braceStart < 0) return;
   
   int braceEnd = StringFind(json, "}", braceStart);
   if(braceEnd < 0) return;
   
   string mappingsStr = StringSubstr(json, braceStart + 1, braceEnd - braceStart - 1);
   
   // Parse key-value pairs
   int pos = 0;
   while(pos < StringLen(mappingsStr))
   {
      int quoteStart = StringFind(mappingsStr, "\"", pos);
      if(quoteStart < 0) break;
      
      int quoteEnd = StringFind(mappingsStr, "\"", quoteStart + 1);
      if(quoteEnd < 0) break;
      
      string key = StringSubstr(mappingsStr, quoteStart + 1, quoteEnd - quoteStart - 1);
      
      int colonPos = StringFind(mappingsStr, ":", quoteEnd);
      if(colonPos < 0) break;
      
      int valueStart = StringFind(mappingsStr, "\"", colonPos);
      if(valueStart < 0) break;
      
      int valueEnd = StringFind(mappingsStr, "\"", valueStart + 1);
      if(valueEnd < 0) break;
      
      string value = StringSubstr(mappingsStr, valueStart + 1, valueEnd - valueStart - 1);
      
      // Add mapping
      int idx = ArraySize(g_symbolMappings);
      ArrayResize(g_symbolMappings, idx + 1);
      g_symbolMappings[idx].master_symbol = key;
      g_symbolMappings[idx].receiver_symbol = value;
      
      pos = valueEnd + 1;
   }
   
   if(InpVerboseMode)
      Print("Loaded ", ArraySize(g_symbolMappings), " symbol mappings");
}

//+------------------------------------------------------------------+
//| JSON Helper Functions                                             |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key, int startFrom = 0)
{
   string searchKey = "\"" + key + "\"";
   int keyPos = StringFind(json, searchKey, startFrom);
   if(keyPos < 0) return "";
   
   int colonPos = StringFind(json, ":", keyPos);
   if(colonPos < 0) return "";
   
   int valueStart = StringFind(json, "\"", colonPos);
   if(valueStart < 0) return "";
   
   int valueEnd = StringFind(json, "\"", valueStart + 1);
   if(valueEnd < 0) return "";
   
   return StringSubstr(json, valueStart + 1, valueEnd - valueStart - 1);
}

double ExtractJsonNumber(string json, string key, int startFrom = 0)
{
   string searchKey = "\"" + key + "\"";
   int keyPos = StringFind(json, searchKey, startFrom);
   if(keyPos < 0) return 0;
   
   int colonPos = StringFind(json, ":", keyPos);
   if(colonPos < 0) return 0;
   
   // Find start of number
   int numStart = colonPos + 1;
   while(numStart < StringLen(json) && (StringGetCharacter(json, numStart) == ' ' || StringGetCharacter(json, numStart) == '\n'))
      numStart++;
   
   // Find end of number
   int numEnd = numStart;
   while(numEnd < StringLen(json))
   {
      ushort c = StringGetCharacter(json, numEnd);
      if((c >= '0' && c <= '9') || c == '.' || c == '-')
         numEnd++;
      else
         break;
   }
   
   string numStr = StringSubstr(json, numStart, numEnd - numStart);
   return StringToDouble(numStr);
}

bool ExtractJsonBool(string json, string key, int startFrom = 0)
{
   string searchKey = "\"" + key + "\"";
   int keyPos = StringFind(json, searchKey, startFrom);
   if(keyPos < 0) return false;
   
   int colonPos = StringFind(json, ":", keyPos);
   if(colonPos < 0) return false;
   
   string afterColon = StringSubstr(json, colonPos + 1, 10);
   StringTrimLeft(afterColon);
   
   return StringFind(afterColon, "true") == 0;
}

//+------------------------------------------------------------------+
//| Process Pending Events                                            |
//+------------------------------------------------------------------+
void ProcessPendingEvents()
{
   if(!FolderCreate(g_pendingFolder))
   {
      if(GetLastError() != 5020) // Already exists
         return;
   }
   
   string searchPattern = g_pendingFolder + "\\*.json";
   string filename;
   
   // Collect all pending files
   string files[];
   int fileCount = 0;
   
   long handle = FileFindFirst(searchPattern, filename);
   if(handle != INVALID_HANDLE)
   {
      do
      {
         if(StringFind(filename, ".tmp") >= 0)
            continue; // Skip temp files
         
         ArrayResize(files, fileCount + 1);
         files[fileCount] = filename;
         fileCount++;
      }
      while(FileFindNext(handle, filename));
      
      FileFindClose(handle);
   }
   
   if(fileCount == 0)
      return;
   
   // Sort by filename (which includes timestamp) for FIFO processing
   ArraySort(files);
   
   // Process each file
   for(int i = 0; i < fileCount; i++)
   {
      string eventFile = g_pendingFolder + "\\" + files[i];
      ProcessEventFile(eventFile, files[i]);
   }
}

//+------------------------------------------------------------------+
//| Process Single Event File                                         |
//+------------------------------------------------------------------+
void ProcessEventFile(string fullPath, string filename)
{
   // Read event content
   int handle = FileOpen(fullPath, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      Print("Cannot open event file: ", filename);
      return;
   }
   
   string content = "";
   while(!FileIsEnding(handle))
   {
      content += FileReadString(handle) + "\n";
   }
   FileClose(handle);
   
   // Parse event
   string idempotencyKey = ExtractJsonString(content, "idempotency_key");
   
   // Check if already executed
   if(IsEventExecuted(idempotencyKey))
   {
      if(InpVerboseMode)
         Print("Event already executed: ", idempotencyKey);
      MoveToExecuted(fullPath, filename);
      return;
   }
   
   // Parse event details
   string eventType = ExtractJsonString(content, "event_type");
   long masterPositionId = (long)ExtractJsonNumber(content, "position_id");
   string masterSymbol = ExtractJsonString(content, "symbol");
   string direction = ExtractJsonString(content, "direction");
   double masterLots = ExtractJsonNumber(content, "lot_size");
   double masterPrice = ExtractJsonNumber(content, "price");
   double masterSL = ExtractJsonNumber(content, "sl");
   double masterTP = ExtractJsonNumber(content, "tp");
   
   // Map symbol
   string receiverSymbol = MapSymbol(masterSymbol);
   if(StringLen(receiverSymbol) == 0)
   {
      Print("No symbol mapping for: ", masterSymbol);
      LogMessage("Skipped - no mapping for " + masterSymbol);
      MoveToExecuted(fullPath, filename);
      return;
   }
   
   // Check slippage before execution
   double currentPrice = GetCurrentPrice(receiverSymbol, direction, eventType);
   double slippagePips = CalculateSlippage(masterPrice, currentPrice, receiverSymbol);
   double maxSlippage = InpSlippageOverride > 0 ? InpSlippageOverride : g_config.max_slippage_pips;
   
   if(slippagePips > maxSlippage)
   {
      Print("Slippage too high: ", slippagePips, " > ", maxSlippage, " pips");
      LogMessage("Skipped - slippage " + DoubleToString(slippagePips, 1) + " > " + DoubleToString(maxSlippage, 1));
      MarkEventExecuted(idempotencyKey, 0, slippagePips);
      MoveToExecuted(fullPath, filename);
      return;
   }
   
   // Calculate receiver lot size
   double receiverLots = CalculateLotSize(content, masterLots, masterSL, masterPrice, receiverSymbol);
   
   if(InpVerboseMode)
      Print("Processing: ", eventType, " ", receiverSymbol, " ", direction, " ", receiverLots, " lots");
   
   LogMessage("Processing " + eventType + " " + receiverSymbol + " " + direction + " " + DoubleToString(receiverLots, 2) + " lots");
   
   // Manual confirm mode
   if(g_config.manual_confirm_mode)
   {
      int confirm = MessageBox(
         "Execute " + eventType + "?\n\n" +
         "Symbol: " + receiverSymbol + "\n" +
         "Direction: " + direction + "\n" +
         "Lots: " + DoubleToString(receiverLots, 2) + "\n" +
         "Slippage: " + DoubleToString(slippagePips, 1) + " pips",
         "Trade Copier Confirm",
         MB_YESNO | MB_ICONQUESTION
      );
      
      if(confirm != IDYES)
      {
         LogMessage("User rejected: " + idempotencyKey);
         MarkEventExecuted(idempotencyKey, 0, slippagePips);
         MoveToExecuted(fullPath, filename);
         return;
      }
   }
   
   // Execute based on event type
   long receiverPositionId = 0;
   bool success = false;
   
   if(eventType == "entry")
   {
      success = ExecuteEntry(receiverSymbol, direction, receiverLots, masterSL, masterTP, masterPositionId, receiverPositionId);
   }
   else if(eventType == "exit")
   {
      success = ExecuteExit(masterPositionId, receiverPositionId);
   }
   
   // Record execution
   double actualSlippage = 0;
   if(success && receiverPositionId > 0)
   {
      // Calculate actual slippage from fill price
      // (simplified - would need to get fill price from order result)
      actualSlippage = slippagePips;
   }
   
   MarkEventExecuted(idempotencyKey, receiverPositionId, actualSlippage);
   MoveToExecuted(fullPath, filename);
   
   if(success)
   {
      LogMessage("SUCCESS: " + eventType + " " + receiverSymbol + " position " + IntegerToString(receiverPositionId));
   }
   else
   {
      LogMessage("FAILED: " + eventType + " " + receiverSymbol);
   }
}

//+------------------------------------------------------------------+
//| Execute Entry Trade                                               |
//+------------------------------------------------------------------+
bool ExecuteEntry(string symbol, string direction, double lots, double masterSL, double masterTP, long masterPosId, long &receiverPosId)
{
   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   
   request.action = TRADE_ACTION_DEAL;
   request.symbol = symbol;
   request.volume = lots;
   request.type = (direction == "buy") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   request.price = (direction == "buy") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   request.deviation = (ulong)(g_config.max_slippage_pips * 10); // In points
   request.magic = 12345; // Copier magic number
   request.comment = "Copier:" + IntegerToString(masterPosId);
   
   // Map SL/TP if provided
   if(masterSL > 0)
      request.sl = masterSL; // Note: Should be mapped/adjusted for receiver symbol
   if(masterTP > 0)
      request.tp = masterTP;
   
   request.type_filling = ORDER_FILLING_IOC;
   
   if(!OrderSend(request, result))
   {
      Print("OrderSend failed: ", result.retcode, " - ", result.comment);
      return false;
   }
   
   if(result.retcode != TRADE_RETCODE_DONE && result.retcode != TRADE_RETCODE_PLACED)
   {
      Print("Order not filled: ", result.retcode);
      return false;
   }
   
   receiverPosId = (long)result.order;
   
   // Store position mapping
   int idx = ArraySize(g_positionMaps);
   ArrayResize(g_positionMaps, idx + 1);
   g_positionMaps[idx].master_position_id = masterPosId;
   g_positionMaps[idx].receiver_position_id = receiverPosId;
   g_positionMaps[idx].symbol = symbol;
   g_positionMaps[idx].direction = direction;
   g_positionMaps[idx].lots = lots;
   
   SavePositionMaps();
   
   Print("Entry executed: ", symbol, " ", direction, " ", lots, " lots, Position: ", receiverPosId);
   return true;
}

//+------------------------------------------------------------------+
//| Execute Exit Trade                                                |
//+------------------------------------------------------------------+
bool ExecuteExit(long masterPosId, long &receiverPosId)
{
   // Find receiver position
   receiverPosId = GetReceiverPositionId(masterPosId);
   if(receiverPosId == 0)
   {
      Print("No receiver position found for master: ", masterPosId);
      return false;
   }
   
   // Find the position
   if(!PositionSelectByTicket((ulong)receiverPosId))
   {
      Print("Position not found: ", receiverPosId);
      RemovePositionMap(masterPosId);
      return false;
   }
   
   string symbol = PositionGetString(POSITION_SYMBOL);
   double volume = PositionGetDouble(POSITION_VOLUME);
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   
   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   
   request.action = TRADE_ACTION_DEAL;
   request.symbol = symbol;
   request.volume = volume;
   request.type = (posType == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   request.price = (posType == POSITION_TYPE_BUY) ? SymbolInfoDouble(symbol, SYMBOL_BID) : SymbolInfoDouble(symbol, SYMBOL_ASK);
   request.position = (ulong)receiverPosId;
   request.deviation = (ulong)(g_config.max_slippage_pips * 10);
   request.type_filling = ORDER_FILLING_IOC;
   
   if(!OrderSend(request, result))
   {
      Print("Close order failed: ", result.retcode);
      return false;
   }
   
   if(result.retcode != TRADE_RETCODE_DONE)
   {
      Print("Close not filled: ", result.retcode);
      return false;
   }
   
   RemovePositionMap(masterPosId);
   SavePositionMaps();
   
   Print("Exit executed: Position ", receiverPosId, " closed");
   return true;
}

//+------------------------------------------------------------------+
//| Calculate Lot Size Based on Risk Mode                             |
//+------------------------------------------------------------------+
double CalculateLotSize(string eventJson, double masterLots, double masterSL, double masterPrice, string receiverSymbol)
{
   double lots = masterLots;
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   
   if(g_config.risk_mode == "fixed_lot")
   {
      lots = g_config.risk_value;
   }
   else if(g_config.risk_mode == "balance_multiplier")
   {
      // Get master balance from event
      double masterBalance = ExtractJsonNumber(eventJson, "balance");
      if(masterBalance > 0)
      {
         double ratio = balance / masterBalance;
         lots = masterLots * ratio * g_config.risk_value;
      }
   }
   else if(g_config.risk_mode == "risk_percent" && masterSL > 0)
   {
      // Calculate lot size based on risk percentage
      double riskAmount = balance * (g_config.risk_value / 100.0);
      double riskPips = MathAbs(masterPrice - masterSL) / SymbolInfoDouble(receiverSymbol, SYMBOL_POINT);
      double tickValue = SymbolInfoDouble(receiverSymbol, SYMBOL_TRADE_TICK_VALUE);
      
      if(riskPips > 0 && tickValue > 0)
      {
         lots = riskAmount / (riskPips * tickValue);
      }
   }
   else if(g_config.risk_mode == "risk_dollar" && masterSL > 0)
   {
      // Calculate lot size based on fixed dollar risk
      double riskPips = MathAbs(masterPrice - masterSL) / SymbolInfoDouble(receiverSymbol, SYMBOL_POINT);
      double tickValue = SymbolInfoDouble(receiverSymbol, SYMBOL_TRADE_TICK_VALUE);
      
      if(riskPips > 0 && tickValue > 0)
      {
         lots = g_config.risk_value / (riskPips * tickValue);
      }
   }
   else if(g_config.risk_mode == "intent")
   {
      // Use intent data from master
      double riskPips = ExtractJsonNumber(eventJson, "risk_pips");
      double tickValue = SymbolInfoDouble(receiverSymbol, SYMBOL_TRADE_TICK_VALUE);
      double riskAmount = balance * 0.01; // Default 1%
      
      if(riskPips > 0 && tickValue > 0)
      {
         lots = riskAmount / (riskPips * tickValue);
      }
   }
   
   // Normalize lot size
   double minLot = SymbolInfoDouble(receiverSymbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(receiverSymbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(receiverSymbol, SYMBOL_VOLUME_STEP);
   
   lots = MathMax(minLot, lots);
   lots = MathMin(maxLot, lots);
   lots = MathFloor(lots / lotStep) * lotStep;
   
   return NormalizeDouble(lots, 2);
}

//+------------------------------------------------------------------+
//| Map Symbol from Master to Receiver                                |
//+------------------------------------------------------------------+
string MapSymbol(string masterSymbol)
{
   for(int i = 0; i < ArraySize(g_symbolMappings); i++)
   {
      if(g_symbolMappings[i].master_symbol == masterSymbol)
         return g_symbolMappings[i].receiver_symbol;
   }
   
   // If no mapping, try to use same symbol if it exists
   if(SymbolInfoInteger(masterSymbol, SYMBOL_EXIST))
      return masterSymbol;
   
   return "";
}

//+------------------------------------------------------------------+
//| Get Current Price for Slippage Check                              |
//+------------------------------------------------------------------+
double GetCurrentPrice(string symbol, string direction, string eventType)
{
   if(eventType == "entry")
   {
      return (direction == "buy") ? 
             SymbolInfoDouble(symbol, SYMBOL_ASK) : 
             SymbolInfoDouble(symbol, SYMBOL_BID);
   }
   else
   {
      return (direction == "buy") ? 
             SymbolInfoDouble(symbol, SYMBOL_BID) : 
             SymbolInfoDouble(symbol, SYMBOL_ASK);
   }
}

//+------------------------------------------------------------------+
//| Calculate Slippage in Pips                                        |
//+------------------------------------------------------------------+
double CalculateSlippage(double masterPrice, double currentPrice, string symbol)
{
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   
   double diff = MathAbs(currentPrice - masterPrice);
   double pips = diff / point;
   
   // For 5-digit brokers, divide by 10
   if(digits == 5 || digits == 3)
      pips /= 10;
   
   return pips;
}

//+------------------------------------------------------------------+
//| Check Master Heartbeat                                            |
//+------------------------------------------------------------------+
bool CheckMasterHeartbeat()
{
   string heartbeatFile = InpQueuePath + "\\heartbeat.json";
   
   if(!FileIsExist(heartbeatFile))
      return false;
   
   datetime fileTime = (datetime)FileGetInteger(heartbeatFile, FILE_MODIFY_DATE);
   datetime now = TimeCurrent();
   
   // Allow 30 seconds grace period
   if(now - fileTime > 30)
   {
      if(InpVerboseMode)
         Print("Master heartbeat stale: ", now - fileTime, " seconds old");
      return false;
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Check Daily Loss Limit                                            |
//+------------------------------------------------------------------+
bool CheckDailyLossLimit()
{
   // Reset at new day
   MqlDateTime now;
   TimeCurrent(now);
   
   if(g_dailyPnLDate != now.day)
   {
      CalculateDailyPnL();
   }
   
   double maxLoss = InpDailyLossOverride > 0 ? InpDailyLossOverride : g_config.max_daily_loss_r;
   
   // Assuming 1R = 1% of balance for simplicity
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double maxLossAmount = balance * (maxLoss / 100.0);
   
   if(g_dailyPnL < -maxLossAmount)
   {
      Print("Daily loss limit reached: ", g_dailyPnL, " < -", maxLossAmount);
      return false;
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Calculate Today's P&L                                             |
//+------------------------------------------------------------------+
void CalculateDailyPnL()
{
   MqlDateTime now;
   TimeCurrent(now);
   g_dailyPnLDate = now.day;
   
   datetime dayStart = StringToTime(StringFormat("%04d.%02d.%02d 00:00:00", now.year, now.mon, now.day));
   
   g_dailyPnL = 0;
   
   // Sum closed deals today
   if(HistorySelect(dayStart, TimeCurrent()))
   {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong ticket = HistoryDealGetTicket(i);
         ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY);
         
         if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT)
         {
            g_dailyPnL += HistoryDealGetDouble(ticket, DEAL_PROFIT);
            g_dailyPnL += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
            g_dailyPnL += HistoryDealGetDouble(ticket, DEAL_SWAP);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Check Session Filter                                              |
//+------------------------------------------------------------------+
bool CheckSessionFilter()
{
   if(ArraySize(g_config.allowed_sessions) == 0)
      return true; // No filter = allow all
   
   // Get current hour in broker time
   MqlDateTime now;
   TimeCurrent(now);
   int hour = now.hour;
   
   // Simple session detection (would need proper timezone handling)
   string currentSession = "";
   
   if(hour >= 0 && hour < 8)
      currentSession = "tokyo";
   else if(hour >= 8 && hour < 13)
      currentSession = "london";
   else if(hour >= 13 && hour < 17)
      currentSession = "new_york_am";
   else if(hour >= 17 && hour < 22)
      currentSession = "new_york_pm";
   else
      currentSession = "off_hours";
   
   // Check if current session is allowed
   for(int i = 0; i < ArraySize(g_config.allowed_sessions); i++)
   {
      if(g_config.allowed_sessions[i] == currentSession)
         return true;
   }
   
   return false;
}

//+------------------------------------------------------------------+
//| Position Map Functions                                            |
//+------------------------------------------------------------------+
long GetReceiverPositionId(long masterPosId)
{
   for(int i = 0; i < ArraySize(g_positionMaps); i++)
   {
      if(g_positionMaps[i].master_position_id == masterPosId)
         return g_positionMaps[i].receiver_position_id;
   }
   return 0;
}

void RemovePositionMap(long masterPosId)
{
   for(int i = 0; i < ArraySize(g_positionMaps); i++)
   {
      if(g_positionMaps[i].master_position_id == masterPosId)
      {
         // Shift remaining elements
         for(int j = i; j < ArraySize(g_positionMaps) - 1; j++)
         {
            g_positionMaps[j] = g_positionMaps[j + 1];
         }
         ArrayResize(g_positionMaps, ArraySize(g_positionMaps) - 1);
         return;
      }
   }
}

void LoadPositionMaps()
{
   ArrayResize(g_positionMaps, 0);
   
   if(!FileIsExist(g_positionsFile))
      return;
   
   int handle = FileOpen(g_positionsFile, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return;
   
   string content = "";
   while(!FileIsEnding(handle))
      content += FileReadString(handle);
   FileClose(handle);
   
   // Parse JSON (simplified)
   // Would need proper parsing for production
}

void SavePositionMaps()
{
   int handle = FileOpen(g_positionsFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return;
   
   string json = "{\n  \"positions\": [\n";
   
   for(int i = 0; i < ArraySize(g_positionMaps); i++)
   {
      if(i > 0) json += ",\n";
      json += "    {";
      json += "\"master\": " + IntegerToString(g_positionMaps[i].master_position_id) + ", ";
      json += "\"receiver\": " + IntegerToString(g_positionMaps[i].receiver_position_id) + ", ";
      json += "\"symbol\": \"" + g_positionMaps[i].symbol + "\", ";
      json += "\"direction\": \"" + g_positionMaps[i].direction + "\", ";
      json += "\"lots\": " + DoubleToString(g_positionMaps[i].lots, 2);
      json += "}";
   }
   
   json += "\n  ]\n}";
   
   FileWriteString(handle, json);
   FileClose(handle);
}

//+------------------------------------------------------------------+
//| Executed Events Functions                                         |
//+------------------------------------------------------------------+
bool IsEventExecuted(string idempotencyKey)
{
   for(int i = 0; i < ArraySize(g_executedEvents); i++)
   {
      if(g_executedEvents[i].idempotency_key == idempotencyKey)
         return true;
   }
   return false;
}

void MarkEventExecuted(string idempotencyKey, long receiverPosId, double slippage)
{
   int idx = ArraySize(g_executedEvents);
   ArrayResize(g_executedEvents, idx + 1);
   g_executedEvents[idx].idempotency_key = idempotencyKey;
   g_executedEvents[idx].receiver_position_id = receiverPosId;
   g_executedEvents[idx].executed_at = TimeCurrent();
   g_executedEvents[idx].slippage_pips = slippage;
   
   // Limit size
   if(ArraySize(g_executedEvents) > 1000)
   {
      for(int i = 0; i < 500; i++)
         g_executedEvents[i] = g_executedEvents[i + 500];
      ArrayResize(g_executedEvents, 500);
   }
   
   SaveExecutedEvents();
}

void LoadExecutedEvents()
{
   ArrayResize(g_executedEvents, 0);
   // Would load from file for persistence
}

void SaveExecutedEvents()
{
   // Would save to file for persistence
}

//+------------------------------------------------------------------+
//| Move Event to Executed Folder                                     |
//+------------------------------------------------------------------+
void MoveToExecuted(string fullPath, string filename)
{
   string destPath = g_executedFolder + "\\" + filename;
   
   if(!FileMove(fullPath, 0, destPath, FILE_REWRITE))
   {
      // If move fails, try delete
      FileDelete(fullPath);
   }
}

//+------------------------------------------------------------------+
//| Log Message                                                       |
//+------------------------------------------------------------------+
void LogMessage(string message)
{
   if(!InpEnableLogging || g_logHandle == INVALID_HANDLE)
      return;
   
   string logLine = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + " | " + message;
   FileWriteString(g_logHandle, logLine + "\n");
   FileFlush(g_logHandle);
}
