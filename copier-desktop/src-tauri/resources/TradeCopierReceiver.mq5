//+------------------------------------------------------------------+
//|                                        TradeCopierReceiver.mq5   |
//|                   Trade Copier Receiver - Local Execution        |
//|                     With Integrated Cloud Journaling             |
//+------------------------------------------------------------------+
#property copyright "Trade Copier Receiver"
#property link      ""
#property version   "2.00"
#property description "Receives trade events from local queue and executes on this account"
#property description "Includes integrated cloud journaling for executed trades"
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

input group "=== Journal Settings ==="
input string   InpApiKey             = "";                         // API Key (for journaling to cloud)
input int      InpBrokerUTCOffset    = 2;                          // Broker Server UTC Offset (e.g., 2 for UTC+2)
input bool     InpEnableJournaling   = true;                       // Enable cloud journaling

input group "=== Safety Overrides ==="
input bool     InpEnableKillSwitch   = false;                      // Emergency stop all copying
input double   InpSlippageOverride   = 0;                          // Override max slippage (0 = use config)
input double   InpDailyLossOverride  = 0;                          // Override daily loss limit (0 = use config)
input double   InpMinEquity          = 0;                          // Minimum equity to continue copying (0 = disabled)
input double   InpMaxDrawdownPct     = 0;                          // Max drawdown % from high water mark (0 = disabled)

input group "=== Trade Execution ==="
input long     InpMagicNumber        = 12345;                      // Magic number for copier trades (0 = auto-generate)
input bool     InpAutoFillMode       = true;                       // Auto-detect order filling mode

input group "=== Logging ==="
input bool     InpEnableLogging      = true;                       // Enable file logging
input bool     InpVerboseMode        = false;                      // Verbose console output

//+------------------------------------------------------------------+
//| Constants                                                         |
//+------------------------------------------------------------------+
const string   EDGE_FUNCTION_URL = "https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1/ingest-events";

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
   bool     use_relative_sl_tp;      // Use distance-based SL/TP for indices
   bool     enable_retry;            // Enable execution retry
   int      max_retry_attempts;      // Max retry attempts
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
string         g_positionsFile       = "copier-positions.json";   // JSON format for robustness
string         g_executedFile        = "copier-executed.json";    // JSON format for robustness
string         g_pendingFolder       = "";
string         g_executedFolder      = "";
int            g_logHandle           = INVALID_HANDLE;
datetime       g_lastPoll            = 0;
datetime       g_lastHeartbeatCheck  = 0;
double         g_dailyPnL            = 0;
datetime       g_dailyPnLDate        = 0;
bool           g_configLoaded        = false;
int            g_configVersion       = 0;
double         g_startingEquity      = 0;
double         g_highWaterMark       = 0;
long           g_magicNumber         = 12345;                       // Effective magic number
ENUM_ORDER_TYPE_FILLING g_fillMode   = ORDER_FILLING_IOC;           // Detected fill mode
string         g_commandsFolder      = "";
bool           g_isPaused            = false;

// Journaling variables
string         g_terminalId          = "";
bool           g_webRequestOk        = false;
string         g_journalQueueFile    = "ReceiverJournalQueue.txt";
ulong          g_processedDeals[];
int            g_maxProcessedDeals   = 1000;
string         g_processedDealsFile  = "";  // M1 fix: file for persisting processed deals

//+------------------------------------------------------------------+
//| Expert initialization function                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   // Setup folder paths
   g_pendingFolder = InpQueuePath + "\\pending";
   g_executedFolder = InpQueuePath + "\\executed";
   g_commandsFolder = "CopierCommands";
   
   // Create commands folder
   if(!FolderCreate(g_commandsFolder))
   {
      if(GetLastError() != 5020) // Already exists
         Print("Warning: Could not create commands folder");
   }
   
   // Generate terminal ID for journaling
   g_terminalId = "MT5_RCV_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + 
                  StringSubstr(AccountInfoString(ACCOUNT_SERVER), 0, 10);
   
   // Initialize equity tracking
   g_startingEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_highWaterMark = g_startingEquity;
   
   // Initialize magic number
   if(InpMagicNumber == 0)
   {
      // Auto-generate based on account number for uniqueness
      g_magicNumber = 12345000 + (AccountInfoInteger(ACCOUNT_LOGIN) % 1000);
   }
   else
   {
      g_magicNumber = InpMagicNumber;
   }
   Print("Magic number: ", g_magicNumber);
   
   // Initialize logging
   if(InpEnableLogging)
   {
      g_logHandle = FileOpen(g_logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      if(g_logHandle != INVALID_HANDLE)
      {
         FileSeek(g_logHandle, 0, SEEK_END);
         LogMessage("=== Trade Copier Receiver v2.00 Started ===");
         LogMessage("Account: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
         LogMessage("Terminal ID: " + g_terminalId);
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
   LoadProcessedDeals();  // M1 fix: load persisted deals to prevent duplicate journaling
   
   // Reconcile position maps - remove stale entries for positions that no longer exist
   ReconcilePositionMaps();
   
   // Calculate today's P&L
   CalculateDailyPnL();
   
   // Test WebRequest for journaling
   if(InpEnableJournaling && StringLen(InpApiKey) > 0)
   {
      TestWebRequest();
   }
   
   // Set timer for polling
   int pollMs = g_config.poll_interval_ms > 0 ? g_config.poll_interval_ms : InpPollIntervalMs;
   EventSetMillisecondTimer(pollMs);
   
   // Write initial account info for desktop app detection
   WriteAccountInfo();
   
   Print("=================================================");
   Print("Trade Copier Receiver v2.00");
   Print("=================================================");
   Print("Account: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("Broker: ", AccountInfoString(ACCOUNT_COMPANY));
   Print("Config: ", InpConfigPath);
   Print("Receiver ID: ", g_config.receiver_id);
   Print("Risk Mode: ", g_config.risk_mode, " (", g_config.risk_value, ")");
   Print("Poll Interval: ", pollMs, "ms");
   Print("Prop Firm Safe: ", g_config.prop_firm_safe_mode ? "YES" : "NO");
   Print("Symbol Mappings: ", ArraySize(g_symbolMappings));
   Print("Cloud Journaling: ", (InpEnableJournaling && StringLen(InpApiKey) > 0) ? "ENABLED" : "DISABLED");
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
   SaveProcessedDeals();  // M1 fix: persist processed deals
   
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
   
   // Check for emergency commands from desktop app
   CheckEmergencyCommands();
   
   // Check if paused
   if(g_isPaused)
   {
      if(InpVerboseMode)
         Print("Copying paused - skipping poll");
      return;
   }
   
   // Check equity protection
   if(!CheckEquityProtection())
   {
      LogMessage("Equity protection triggered - stopping");
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
   
   // Update high water mark
   double currentEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(currentEquity > g_highWaterMark)
      g_highWaterMark = currentEquity;
   
   // Process pending events
   ProcessPendingEvents();
   
   // Periodically update account info for desktop app (every 10 seconds)
   static datetime lastAccountInfoUpdate = 0;
   if(TimeCurrent() - lastAccountInfoUpdate >= 10)
   {
      WriteAccountInfo();
      lastAccountInfoUpdate = TimeCurrent();
   }
   
   // Process journal retry queue
   if(InpEnableJournaling && StringLen(InpApiKey) > 0)
   {
      ProcessJournalQueue();
   }
}

//+------------------------------------------------------------------+
//| Check Equity Protection                                           |
//+------------------------------------------------------------------+
bool CheckEquityProtection()
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   
   // Minimum equity check
   if(InpMinEquity > 0 && equity < InpMinEquity)
   {
      Print("Equity below minimum: ", equity, " < ", InpMinEquity);
      return false;
   }
   
   // Drawdown from high water mark check
   if(InpMaxDrawdownPct > 0 && g_highWaterMark > 0)
   {
      double drawdownPct = ((g_highWaterMark - equity) / g_highWaterMark) * 100.0;
      if(drawdownPct > InpMaxDrawdownPct)
      {
         Print("Drawdown exceeded: ", DoubleToString(drawdownPct, 2), "% > ", InpMaxDrawdownPct, "%");
         return false;
      }
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Check for Emergency Commands from Desktop App                     |
//+------------------------------------------------------------------+
void CheckEmergencyCommands()
{
   // Check for emergency commands (emergency_*.json)
   string searchPattern = g_commandsFolder + "\\emergency_*.json";
   string filename;
   
   long handle = FileFindFirst(searchPattern, filename);
   if(handle != INVALID_HANDLE)
   {
      do
      {
         string fullPath = g_commandsFolder + "\\" + filename;
         ProcessEmergencyCommand(fullPath, filename);
      }
      while(FileFindNext(handle, filename));
      
      FileFindClose(handle);
   }
   
   // Check for trade commands from desktop app (cmd_*.json)
   searchPattern = g_commandsFolder + "\\cmd_*.json";
   
   handle = FileFindFirst(searchPattern, filename);
   if(handle != INVALID_HANDLE)
   {
      do
      {
         string fullPath = g_commandsFolder + "\\" + filename;
         ProcessDesktopCommand(fullPath, filename);
      }
      while(FileFindNext(handle, filename));
      
      FileFindClose(handle);
   }
}

//+------------------------------------------------------------------+
//| Process Desktop Trade Command and Write Response                  |
//+------------------------------------------------------------------+
void ProcessDesktopCommand(string fullPath, string filename)
{
   int fHandle = FileOpen(fullPath, FILE_READ|FILE_TXT|FILE_ANSI);
   if(fHandle == INVALID_HANDLE)
      return;
   
   string content = "";
   while(!FileIsEnding(fHandle))
   {
      content += FileReadString(fHandle) + "\n";
   }
   FileClose(fHandle);
   
   // Parse command
   string action = ExtractJsonString(content, "action");
   string symbol = ExtractJsonString(content, "symbol");
   string direction = ExtractJsonString(content, "direction");
   double lots = ExtractJsonNumber(content, "lots");
   double sl = ExtractJsonNumber(content, "sl");
   double tp = ExtractJsonNumber(content, "tp");
   long timestamp = (long)ExtractJsonNumber(content, "timestamp");
   long masterPosId = (long)ExtractJsonNumber(content, "master_position_id");
   
   // Map symbol
   symbol = MapSymbol(symbol);
   if(StringLen(symbol) == 0)
   {
      WriteCommandResponse(timestamp, false, 0, 0, 0, "No symbol mapping found");
      FileDelete(fullPath);
      return;
   }
   
   bool success = false;
   double executedPrice = 0;
   double slippagePips = 0;
   long receiverPosId = 0;
   string errorMsg = "";
   
   if(action == "entry")
   {
      success = ExecuteEntry(symbol, direction, lots, sl, tp, masterPosId, receiverPosId);
      if(success)
      {
         executedPrice = (direction == "buy") ? 
            SymbolInfoDouble(symbol, SYMBOL_ASK) : 
            SymbolInfoDouble(symbol, SYMBOL_BID);
      }
      else
      {
         errorMsg = "Entry execution failed";
      }
   }
   else if(action == "exit")
   {
      success = ExecuteExit(masterPosId, receiverPosId);
      if(success)
      {
         executedPrice = SymbolInfoDouble(symbol, SYMBOL_BID);
      }
      else
      {
         errorMsg = "Exit execution failed - position not found";
      }
   }
   else if(action == "modify")
   {
      receiverPosId = GetReceiverPositionId(masterPosId);
      if(receiverPosId > 0 && PositionSelectByTicket((ulong)receiverPosId))
      {
         MqlTradeRequest request = {};
         MqlTradeResult result = {};
         
         request.action = TRADE_ACTION_SLTP;
         request.symbol = symbol;
         request.position = (ulong)receiverPosId;
         if(sl > 0) request.sl = sl;
         if(tp > 0) request.tp = tp;
         
         success = OrderSend(request, result);
         if(!success)
         {
            errorMsg = "Modify failed: " + IntegerToString(result.retcode);
         }
      }
      else
      {
         errorMsg = "Position not found for modify";
      }
   }
   
   // Write response file
   WriteCommandResponse(timestamp, success, executedPrice, slippagePips, receiverPosId, errorMsg);
   
   // Delete command file
   FileDelete(fullPath);
   
   if(success)
   {
      LogMessage("Desktop command executed: " + action + " " + symbol);
   }
   else
   {
      LogMessage("Desktop command failed: " + action + " " + symbol + " - " + errorMsg);
   }
}

//+------------------------------------------------------------------+
//| Write Response File for Desktop App (Atomic Write - m2 fix)       |
//+------------------------------------------------------------------+
void WriteCommandResponse(long timestamp, bool success, double price, double slippage, long posId, string error)
{
   string tempFilename = g_commandsFolder + "\\resp_" + IntegerToString(timestamp) + ".tmp";
   string respFilename = g_commandsFolder + "\\resp_" + IntegerToString(timestamp) + ".json";
   
   string json = "{\n";
   json += "  \"success\": " + (success ? "true" : "false") + ",\n";
   json += "  \"executed_price\": " + DoubleToString(price, 5) + ",\n";
   json += "  \"slippage_pips\": " + DoubleToString(slippage, 1) + ",\n";
   json += "  \"receiver_position_id\": " + IntegerToString(posId) + ",\n";
   if(StringLen(error) > 0)
      json += "  \"error\": \"" + error + "\",\n";
   json += "  \"timestamp\": " + IntegerToString(TimeCurrent()) + "\n";
   json += "}";
   
   // Write to temp file first, then rename (atomic)
   int handle = FileOpen(tempFilename, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
      FileMove(tempFilename, 0, respFilename, FILE_REWRITE);
   }
}

//+------------------------------------------------------------------+
//| Process Emergency Command File                                    |
//+------------------------------------------------------------------+
void ProcessEmergencyCommand(string fullPath, string filename)
{
   int fHandle = FileOpen(fullPath, FILE_READ|FILE_TXT|FILE_ANSI);
   if(fHandle == INVALID_HANDLE)
      return;
   
   string content = "";
   while(!FileIsEnding(fHandle))
   {
      content += FileReadString(fHandle) + "\n";
   }
   FileClose(fHandle);
   
   // Parse command type
   string commandType = ExtractJsonString(content, "command_type");
   
   if(commandType == "close_all")
   {
      LogMessage("EMERGENCY: Close all positions command received");
      CloseAllCopierPositions();
   }
   else if(commandType == "pause_copying")
   {
      LogMessage("Pause copying command received");
      g_isPaused = true;
   }
   else if(commandType == "resume_copying")
   {
      LogMessage("Resume copying command received");
      g_isPaused = false;
   }
   else if(commandType == "open")
   {
      // Sync command - open position
      string symbol = ExtractJsonString(content, "symbol");
      string direction = ExtractJsonString(content, "direction");
      double volume = ExtractJsonNumber(content, "volume");
      double sl = ExtractJsonNumber(content, "sl");
      double tp = ExtractJsonNumber(content, "tp");
      long masterPosId = (long)ExtractJsonNumber(content, "master_position_id");
      
      symbol = MapSymbol(symbol);
      if(StringLen(symbol) > 0)
      {
         long receiverPosId = 0;
         if(ExecuteEntry(symbol, direction, volume, sl, tp, masterPosId, receiverPosId))
         {
            LogMessage("Sync open successful: " + symbol);
         }
      }
   }
   else if(commandType == "close")
   {
      // Sync command - close position
      long positionId = (long)ExtractJsonNumber(content, "position_id");
      if(PositionSelectByTicket((ulong)positionId))
      {
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
         request.position = (ulong)positionId;
         request.deviation = 50;
         request.type_filling = GetOptimalFillingMode(symbol);  // m1 fix: use dynamic fill mode
         
         if(OrderSend(request, result))
         {
            LogMessage("Sync close successful: position " + IntegerToString(positionId));
         }
      }
   }
   
   // Delete the command file after processing
   FileDelete(fullPath);
}

//+------------------------------------------------------------------+
//| Close All Copier Positions                                        |
//+------------------------------------------------------------------+
void CloseAllCopierPositions()
{
   int total = PositionsTotal();
   for(int i = total - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      
      // Only close copier positions (check for our magic number)
      if(PositionGetInteger(POSITION_MAGIC) != g_magicNumber)
         continue;
      
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
      request.position = ticket;
      request.deviation = 50;
      request.type_filling = GetOptimalFillingMode(symbol);  // m4 fix: use dynamic fill mode
      
      if(OrderSend(request, result))
      {
         Print("Closed position: ", ticket);
      }
      else
      {
         Print("Failed to close position: ", ticket, " Error: ", result.retcode);
      }
   }
   
   // Clear position maps
   ArrayResize(g_positionMaps, 0);
   SavePositionMaps();
}

//+------------------------------------------------------------------+
//| Trade Transaction Handler - Capture Manual Trades                 |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   // Only process if journaling is enabled
   if(!InpEnableJournaling || StringLen(InpApiKey) == 0)
      return;
   
   // Only process DEAL transactions (actual trade executions)
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   
   ulong dealTicket = trans.deal;
   if(dealTicket == 0)
      return;
   
   // Get deal details
   if(!HistoryDealSelect(dealTicket))
   {
      HistorySelect(TimeCurrent() - 86400, TimeCurrent() + 3600);
      if(!HistoryDealSelect(dealTicket))
         return;
   }
   
    // Check if this is a copier trade (magic number check)
    long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
    if(magic == g_magicNumber) // Copier magic - already handled by ExecuteEntry/ExecuteExit
       return;
   
   // Check if already processed
   if(IsDealProcessed(dealTicket))
      return;
   
   // Get deal type and entry
   ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   
   // Skip balance/credit deals
   if(dealType == DEAL_TYPE_BALANCE || dealType == DEAL_TYPE_CREDIT ||
      dealType == DEAL_TYPE_COMMISSION || dealType == DEAL_TYPE_COMMISSION_DAILY)
      return;
   
   string direction = "";
   if(dealType == DEAL_TYPE_BUY)
      direction = "buy";
   else if(dealType == DEAL_TYPE_SELL)
      direction = "sell";
   else
      return;
   
   string eventType = (dealEntry == DEAL_ENTRY_IN) ? "entry" : "exit";
   if(eventType == "" && dealEntry != DEAL_ENTRY_OUT && dealEntry != DEAL_ENTRY_INOUT)
      return;
   
   // Build and send journal event for manual trades
   string payload = BuildJournalPayload(dealTicket, eventType, direction);
   
   if(InpVerboseMode)
      Print("Manual trade captured: ", eventType, " | Deal: ", dealTicket);
   
   if(!SendJournalEvent(payload, dealTicket))
   {
      AddToJournalQueue(payload, dealTicket);
   }
   else
   {
      MarkDealProcessed(dealTicket);
   }
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
   g_configVersion = (int)ExtractJsonNumber(json, "version");
   
   int receiversStart = StringFind(json, "\"receivers\"");
   if(receiversStart < 0)
   {
      Print("No receivers found in config");
      return false;
   }
   
   string receiverId = InpReceiverId;
   
   if(StringLen(receiverId) == 0)
   {
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
   
   int configStart = StringFind(json, "\"" + receiverId + "\"");
   if(configStart < 0)
   {
      configStart = StringFind(json, receiverId);
   }
   
   g_config.account_name = ExtractJsonString(json, "account_name", receiversStart);
   
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
   
   int braceStart = StringFind(json, "{", startPos);
   if(braceStart < 0) return;
   
   int braceEnd = StringFind(json, "}", braceStart);
   if(braceEnd < 0) return;
   
   string mappingsStr = StringSubstr(json, braceStart + 1, braceEnd - braceStart - 1);
   
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
   
   int numStart = colonPos + 1;
   while(numStart < StringLen(json) && (StringGetCharacter(json, numStart) == ' ' || StringGetCharacter(json, numStart) == '\n'))
      numStart++;
   
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
      if(GetLastError() != 5020)
         return;
   }
   
   string searchPattern = g_pendingFolder + "\\*.json";
   string filename;
   
   string files[];
   int fileCount = 0;
   
   long handle = FileFindFirst(searchPattern, filename);
   if(handle != INVALID_HANDLE)
   {
      do
      {
         if(StringFind(filename, ".tmp") >= 0)
            continue;
         
         ArrayResize(files, fileCount + 1);
         files[fileCount] = filename;
         fileCount++;
      }
      while(FileFindNext(handle, filename));
      
      FileFindClose(handle);
   }
   
   if(fileCount == 0)
      return;
   
   ArraySort(files);
   
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
   
   string idempotencyKey = ExtractJsonString(content, "idempotency_key");
   
   if(IsEventExecuted(idempotencyKey))
   {
      if(InpVerboseMode)
         Print("Event already executed: ", idempotencyKey);
      MoveToExecuted(fullPath, filename);
      return;
   }
   
   string eventType = ExtractJsonString(content, "event_type");
   long masterPositionId = (long)ExtractJsonNumber(content, "position_id");
   string masterSymbol = ExtractJsonString(content, "symbol");
   string direction = ExtractJsonString(content, "direction");
   double masterLots = ExtractJsonNumber(content, "lot_size");
   double masterPrice = ExtractJsonNumber(content, "price");
   double masterSL = ExtractJsonNumber(content, "sl");
   double masterTP = ExtractJsonNumber(content, "tp");
   
   string receiverSymbol = MapSymbol(masterSymbol);
   if(StringLen(receiverSymbol) == 0)
   {
      Print("No symbol mapping for: ", masterSymbol);
      LogMessage("Skipped - no mapping for " + masterSymbol);
      MoveToExecuted(fullPath, filename);
      return;
   }
   
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
   
   double receiverLots = CalculateLotSize(content, masterLots, masterSL, masterPrice, receiverSymbol);
   
   if(InpVerboseMode)
      Print("Processing: ", eventType, " ", receiverSymbol, " ", direction, " ", receiverLots, " lots");
   
   LogMessage("Processing " + eventType + " " + receiverSymbol + " " + direction + " " + DoubleToString(receiverLots, 2) + " lots");
   
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
   else if(eventType == "partial_close")
   {
      success = ExecutePartialClose(content, masterPositionId, receiverPositionId);
   }
   else if(eventType == "modify")
   {
      success = ExecuteModify(content, masterPositionId);
      receiverPositionId = GetReceiverPositionId(masterPositionId);
   }
   
   double actualSlippage = 0;
   if(success && receiverPositionId > 0)
   {
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
   request.deviation = (ulong)(g_config.max_slippage_pips * 10);
   request.magic = g_magicNumber;
   request.comment = "Copier:" + IntegerToString(masterPosId);
   
   // Apply SL/TP - use relative mode for indices if enabled
   if(g_config.use_relative_sl_tp && masterSL > 0)
   {
      // Calculate SL as distance from entry
      double slDistance = MathAbs(request.price - masterSL);
      if(direction == "buy")
         request.sl = request.price - slDistance;
      else
         request.sl = request.price + slDistance;
   }
   else if(masterSL > 0)
   {
      request.sl = masterSL;
   }
   
   if(g_config.use_relative_sl_tp && masterTP > 0)
   {
      // Calculate TP as distance from entry
      double tpDistance = MathAbs(masterTP - request.price);
      if(direction == "buy")
         request.tp = request.price + tpDistance;
      else
         request.tp = request.price - tpDistance;
   }
   else if(masterTP > 0)
   {
      request.tp = masterTP;
   }
   
   // Dynamic order filling mode detection
   request.type_filling = GetOptimalFillingMode(symbol);

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
   
   // CRITICAL: Get actual position ID, not order ticket
   // result.order is the order ticket, we need the position ID
   // After order execution, we need to find the position that was created
   receiverPosId = 0;
   
   // Method 1: Check if result.deal has a position
   if(result.deal > 0)
   {
      if(HistoryDealSelect(result.deal))
      {
         receiverPosId = HistoryDealGetInteger(result.deal, DEAL_POSITION_ID);
      }
   }
   
   // Method 2: If no position ID from deal, try to find matching position
   if(receiverPosId == 0)
   {
      // Wait a moment for position to appear
      Sleep(50);
      
      // Find the position with our comment
      string expectedComment = "Copier:" + IntegerToString(masterPosId);
      int total = PositionsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong posTicket = PositionGetTicket(i);
         if(posTicket == 0) continue;
         
         if(PositionGetString(POSITION_SYMBOL) == symbol &&
            PositionGetInteger(POSITION_MAGIC) == g_magicNumber &&
            PositionGetString(POSITION_COMMENT) == expectedComment)
         {
            receiverPosId = (long)PositionGetInteger(POSITION_IDENTIFIER);
            break;
         }
      }
   }
   
   // Method 3: Fallback to order ticket if still no position ID
   if(receiverPosId == 0)
   {
      receiverPosId = (long)result.order;
      Print("Warning: Using order ticket as position ID: ", receiverPosId);
   }
   
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
   
   // Journal the entry to cloud
   if(InpEnableJournaling && StringLen(InpApiKey) > 0)
   {
      JournalCopiedTrade((ulong)result.deal, "entry", direction, symbol, lots, request.price, masterSL, masterTP);
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Execute Exit Trade                                                |
//+------------------------------------------------------------------+
bool ExecuteExit(long masterPosId, long &receiverPosId)
{
   receiverPosId = GetReceiverPositionId(masterPosId);
   if(receiverPosId == 0)
   {
      Print("No receiver position found for master: ", masterPosId);
      return false;
   }
   
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
   request.type_filling = GetOptimalFillingMode(symbol);
   
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
   
   string direction = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
   
   RemovePositionMap(masterPosId);
   SavePositionMaps();
   
   Print("Exit executed: Position ", receiverPosId, " closed");
   
   // Journal the exit to cloud
   if(InpEnableJournaling && StringLen(InpApiKey) > 0)
   {
      JournalCopiedTrade((ulong)result.deal, "exit", direction, symbol, volume, request.price, 0, 0);
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Execute Partial Close                                             |
//+------------------------------------------------------------------+
bool ExecutePartialClose(string eventJson, long masterPosId, long &receiverPosId)
{
   receiverPosId = GetReceiverPositionId(masterPosId);
   if(receiverPosId == 0)
   {
      Print("No receiver position found for master: ", masterPosId);
      return false;
   }
   
   if(!PositionSelectByTicket((ulong)receiverPosId))
   {
      Print("Position not found: ", receiverPosId);
      RemovePositionMap(masterPosId);
      return false;
   }
   
   string symbol = PositionGetString(POSITION_SYMBOL);
   double currentVolume = PositionGetDouble(POSITION_VOLUME);
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   
   // Get closed volume from event
   double closedVolume = ExtractJsonNumber(eventJson, "closed_volume");
   double remainingVolume = ExtractJsonNumber(eventJson, "remaining_volume");
   
   // Calculate proportional close volume
   double closeVolume = closedVolume;
   
   // If we're using risk scaling, calculate proportionally
   if(g_config.risk_mode != "fixed_lot")
   {
      // Get the position map to find original receiver lots
      for(int i = 0; i < ArraySize(g_positionMaps); i++)
      {
         if(g_positionMaps[i].master_position_id == masterPosId)
         {
            double originalMasterLots = closedVolume + remainingVolume;
            if(originalMasterLots > 0)
            {
               double ratio = closedVolume / originalMasterLots;
               closeVolume = currentVolume * ratio;
            }
            break;
         }
      }
   }
   
   // Normalize volume
   double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   closeVolume = MathMax(minLot, closeVolume);
   closeVolume = MathFloor(closeVolume / lotStep) * lotStep;
   closeVolume = NormalizeDouble(closeVolume, 2);
   
   // Don't close more than we have
   if(closeVolume >= currentVolume)
   {
      closeVolume = currentVolume;
   }
   
   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   
   request.action = TRADE_ACTION_DEAL;
   request.symbol = symbol;
   request.volume = closeVolume;
   request.type = (posType == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   request.price = (posType == POSITION_TYPE_BUY) ? SymbolInfoDouble(symbol, SYMBOL_BID) : SymbolInfoDouble(symbol, SYMBOL_ASK);
   request.position = (ulong)receiverPosId;
   request.deviation = (ulong)(g_config.max_slippage_pips * 10);
   request.type_filling = GetOptimalFillingMode(symbol);
   
   if(!OrderSend(request, result))
   {
      Print("Partial close failed: ", result.retcode);
      return false;
   }
   
   if(result.retcode != TRADE_RETCODE_DONE)
   {
      Print("Partial close not filled: ", result.retcode);
      return false;
   }
   
   // Update position map with remaining volume
   for(int i = 0; i < ArraySize(g_positionMaps); i++)
   {
      if(g_positionMaps[i].master_position_id == masterPosId)
      {
         g_positionMaps[i].lots -= closeVolume;
         if(g_positionMaps[i].lots <= 0)
         {
            RemovePositionMap(masterPosId);
         }
         break;
      }
   }
   SavePositionMaps();
   
   Print("Partial close executed: ", closeVolume, " lots closed, position ", receiverPosId);
   
   // Journal the partial close
   if(InpEnableJournaling && StringLen(InpApiKey) > 0)
   {
      string direction = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
      JournalCopiedTrade((ulong)result.deal, "partial_close", direction, symbol, closeVolume, request.price, 0, 0);
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Execute SL/TP Modification                                        |
//+------------------------------------------------------------------+
bool ExecuteModify(string eventJson, long masterPosId)
{
   long receiverPosId = GetReceiverPositionId(masterPosId);
   if(receiverPosId == 0)
   {
      Print("No receiver position found for master: ", masterPosId);
      return false;
   }
   
   if(!PositionSelectByTicket((ulong)receiverPosId))
   {
      Print("Position not found: ", receiverPosId);
      RemovePositionMap(masterPosId);
      return false;
   }
   
   string symbol = PositionGetString(POSITION_SYMBOL);
   double newSL = ExtractJsonNumber(eventJson, "sl");
   double newTP = ExtractJsonNumber(eventJson, "tp");
   
   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   
   request.action = TRADE_ACTION_SLTP;
   request.symbol = symbol;
   request.position = (ulong)receiverPosId;
   request.sl = newSL;
   request.tp = newTP;
   
   if(!OrderSend(request, result))
   {
      Print("Modify SL/TP failed: ", result.retcode);
      return false;
   }
   
   if(result.retcode != TRADE_RETCODE_DONE)
   {
      Print("Modify SL/TP not completed: ", result.retcode);
      return false;
   }
   
   Print("SL/TP modified for position ", receiverPosId, ": SL=", newSL, " TP=", newTP);
   LogMessage("Modified SL/TP for position " + IntegerToString(receiverPosId));
   
   return true;
}

//+------------------------------------------------------------------+
//| Journal a Copied Trade to Cloud                                   |
//+------------------------------------------------------------------+
void JournalCopiedTrade(ulong dealTicket, string eventType, string direction, string symbol, double lots, double price, double sl, double tp)
{
   if(!g_webRequestOk)
   {
      if(InpVerboseMode)
         Print("WebRequest not available for journaling");
      return;
   }
   
   // Build journal payload
   string payload = BuildJournalPayloadFromParams(dealTicket, eventType, direction, symbol, lots, price, sl, tp);
   
   if(!SendJournalEvent(payload, dealTicket))
   {
      AddToJournalQueue(payload, dealTicket);
      LogMessage("Journaling queued for retry: " + IntegerToString(dealTicket));
   }
   else
   {
      MarkDealProcessed(dealTicket);
      LogMessage("Trade journaled to cloud: " + IntegerToString(dealTicket));
   }
}

//+------------------------------------------------------------------+
//| Build Journal Payload from Parameters                             |
//+------------------------------------------------------------------+
string BuildJournalPayloadFromParams(ulong dealTicket, string eventType, string direction, string symbol, double lots, double price, double sl, double tp)
{
   datetime dealTime = TimeCurrent();
   datetime dealTimeUTC = dealTime - (InpBrokerUTCOffset * 3600);
   string utcTimestamp = FormatTimestampUTC(dealTimeUTC);
   
   long accountLogin = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string server = AccountInfoString(ACCOUNT_SERVER);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   
   string accountType = "live";
   string serverLower = server;
   StringToLower(serverLower);
   if(StringFind(serverLower, "demo") >= 0)
      accountType = "demo";
   else if(StringFind(serverLower, "ftmo") >= 0 || StringFind(serverLower, "fundednext") >= 0 || StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   string idempotencyKey = g_terminalId + "_" + IntegerToString(dealTicket) + "_" + eventType;
   
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"ea_type\":\"receiver\",";  // Identify this as the receiver EA
   json += "\"event_type\":\"" + eventType + "\",";
   json += "\"position_id\":" + IntegerToString(dealTicket) + ",";
   json += "\"deal_id\":" + IntegerToString(dealTicket) + ",";
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(lots, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   
   if(sl > 0)
      json += "\"sl\":" + DoubleToString(sl, digits) + ",";
   if(tp > 0)
      json += "\"tp\":" + DoubleToString(tp, digits) + ",";
   
   json += "\"timestamp\":\"" + utcTimestamp + "\",";
   json += "\"broker_utc_offset\":" + IntegerToString(InpBrokerUTCOffset) + ",";
   
   if(eventType == "entry")
      json += "\"equity_at_entry\":" + DoubleToString(equity, 2) + ",";
   
   json += "\"account_info\":{";
   json += "\"login\":" + IntegerToString(accountLogin) + ",";
   json += "\"broker\":\"" + EscapeJsonString(broker) + "\",";
   json += "\"server\":\"" + server + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"account_type\":\"" + accountType + "\"";
   json += "},";
   
   json += "\"raw_payload\":{";
   json += "\"magic\":" + IntegerToString(g_magicNumber) + ",";
   json += "\"comment\":\"Copier\",";
   json += "\"source\":\"receiver_ea\"";
   json += "}";
   
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Build Journal Payload from Deal (for manual trades)               |
//+------------------------------------------------------------------+
string BuildJournalPayload(ulong dealTicket, string eventType, string direction)
{
   string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   long positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
   long orderId = HistoryDealGetInteger(dealTicket, DEAL_ORDER);
   double volume = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
   double price = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
   double sl = HistoryDealGetDouble(dealTicket, DEAL_SL);
   double tp = HistoryDealGetDouble(dealTicket, DEAL_TP);
   double commission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
   double swap = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
   double profit = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
   datetime dealTime = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
   long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
   string comment = HistoryDealGetString(dealTicket, DEAL_COMMENT);
   
   datetime dealTimeUTC = dealTime - (InpBrokerUTCOffset * 3600);
   string utcTimestamp = FormatTimestampUTC(dealTimeUTC);
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   long accountLogin = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string server = AccountInfoString(ACCOUNT_SERVER);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   
   string accountType = "live";
   string serverLower = server;
   StringToLower(serverLower);
   if(StringFind(serverLower, "demo") >= 0)
      accountType = "demo";
   else if(StringFind(serverLower, "ftmo") >= 0 || StringFind(serverLower, "fundednext") >= 0 || StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   string idempotencyKey = g_terminalId + "_" + IntegerToString(dealTicket) + "_" + eventType;
   
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"ea_type\":\"receiver\",";  // Identify this as the receiver EA
   json += "\"event_type\":\"" + eventType + "\",";
   json += "\"position_id\":" + IntegerToString(positionId) + ",";
   json += "\"deal_id\":" + IntegerToString(dealTicket) + ",";
   json += "\"order_id\":" + IntegerToString(orderId) + ",";
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(volume, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   
   if(sl > 0)
      json += "\"sl\":" + DoubleToString(sl, digits) + ",";
   if(tp > 0)
      json += "\"tp\":" + DoubleToString(tp, digits) + ",";
   
   json += "\"commission\":" + DoubleToString(commission, 2) + ",";
   json += "\"swap\":" + DoubleToString(swap, 2) + ",";
   json += "\"profit\":" + DoubleToString(profit, 2) + ",";
   json += "\"timestamp\":\"" + utcTimestamp + "\",";
   json += "\"broker_utc_offset\":" + IntegerToString(InpBrokerUTCOffset) + ",";
   
   if(eventType == "entry")
      json += "\"equity_at_entry\":" + DoubleToString(equity, 2) + ",";
   
   json += "\"account_info\":{";
   json += "\"login\":" + IntegerToString(accountLogin) + ",";
   json += "\"broker\":\"" + EscapeJsonString(broker) + "\",";
   json += "\"server\":\"" + server + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"account_type\":\"" + accountType + "\"";
   json += "},";
   
   json += "\"raw_payload\":{";
   json += "\"magic\":" + IntegerToString(magic) + ",";
   json += "\"comment\":\"" + EscapeJsonString(comment) + "\",";
   json += "\"source\":\"receiver_ea_manual\"";
   json += "}";
   
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Send Journal Event to Edge Function                               |
//+------------------------------------------------------------------+
bool SendJournalEvent(string payload, ulong dealId = 0)
{
   if(!g_webRequestOk)
      return false;
   
   char postData[];
   char result[];
   string resultHeaders;
   
   int payloadLen = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, payloadLen - 1);
   
   string headers = "Content-Type: application/json\r\n";
   headers += "x-api-key: " + InpApiKey + "\r\n";
   
   int timeout = 15000;
   
   ResetLastError();
   int responseCode = WebRequest("POST", EDGE_FUNCTION_URL, headers, timeout, postData, result, resultHeaders);
   
   if(responseCode == -1)
   {
      int error = GetLastError();
      if(InpVerboseMode)
         Print("Journal WebRequest failed. Error: ", error);
      return false;
   }
   
   if(responseCode >= 200 && responseCode < 300)
   {
      if(InpVerboseMode)
         Print("Journal event sent successfully");
      return true;
   }
   else if(responseCode == 409)
   {
      return true; // Duplicate, consider success
   }
   else
   {
      if(InpVerboseMode)
         Print("Journal server error. Code: ", responseCode);
      return false;
   }
}

//+------------------------------------------------------------------+
//| Add to Journal Queue                                              |
//+------------------------------------------------------------------+
void AddToJournalQueue(string payload, ulong dealId)
{
   int handle = FileOpen(g_journalQueueFile, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   
   if(handle != INVALID_HANDLE)
   {
      FileSeek(handle, 0, SEEK_END);
      
      string escapedPayload = payload;
      StringReplace(escapedPayload, "|", "{{PIPE}}");
      
      string line = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "|0|" + 
                    IntegerToString(dealId) + "|" + escapedPayload + "\n";
      FileWriteString(handle, line);
      FileClose(handle);
   }
}

//+------------------------------------------------------------------+
//| Process Journal Retry Queue                                       |
//+------------------------------------------------------------------+
void ProcessJournalQueue()
{
   if(!FileIsExist(g_journalQueueFile))
      return;
   
   int handle = FileOpen(g_journalQueueFile, FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
   
   if(handle == INVALID_HANDLE)
      return;
   
   string entries[];
   int count = 0;
   
   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      if(StringLen(line) > 0)
      {
         ArrayResize(entries, count + 1);
         entries[count] = line;
         count++;
      }
   }
   FileClose(handle);
   
   if(count == 0)
   {
      FileDelete(g_journalQueueFile);
      return;
   }
   
   string remainingEntries[];
   int remainingCount = 0;
   
   for(int i = 0; i < count; i++)
   {
      string parts[];
      int partCount = StringSplit(entries[i], '|', parts);
      
      if(partCount < 4)
         continue;
      
      int retryCount = (int)StringToInteger(parts[1]);
      ulong dealId = (ulong)StringToInteger(parts[2]);
      
      string escapedPayload = parts[3];
      for(int j = 4; j < partCount; j++)
      {
         escapedPayload += "|" + parts[j];
      }
      
      StringReplace(escapedPayload, "{{PIPE}}", "|");
      string payload = escapedPayload;
      
      if(retryCount >= 5)
      {
         LogMessage("Journal max retries exceeded for deal " + IntegerToString(dealId));
         continue;
      }
      
      if(SendJournalEvent(payload, dealId))
      {
         MarkDealProcessed(dealId);
         if(InpVerboseMode)
            Print("Queued journal event sent successfully");
      }
      else
      {
         string escapedForRequeue = payload;
         StringReplace(escapedForRequeue, "|", "{{PIPE}}");
         ArrayResize(remainingEntries, remainingCount + 1);
         remainingEntries[remainingCount] = parts[0] + "|" + IntegerToString(retryCount + 1) + "|" + 
                                            IntegerToString(dealId) + "|" + escapedForRequeue;
         remainingCount++;
      }
   }
   
   if(remainingCount > 0)
   {
      handle = FileOpen(g_journalQueueFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
      if(handle != INVALID_HANDLE)
      {
         for(int i = 0; i < remainingCount; i++)
         {
            FileWriteString(handle, remainingEntries[i] + "\n");
         }
         FileClose(handle);
      }
   }
   else
   {
      FileDelete(g_journalQueueFile);
   }
}

//+------------------------------------------------------------------+
//| Test WebRequest Availability                                      |
//+------------------------------------------------------------------+
void TestWebRequest()
{
   char postData[];
   char result[];
   string resultHeaders;
   
   ArrayResize(postData, 0);
   string headers = "";
   
   ResetLastError();
   int responseCode = WebRequest("OPTIONS", EDGE_FUNCTION_URL, headers, 5000, postData, result, resultHeaders);
   
   if(responseCode == -1)
   {
      int error = GetLastError();
      if(error == 4060)
      {
         Print("=================================================");
         Print("JOURNALING SETUP REQUIRED: Enable WebRequest");
         Print("");
         Print("1. Go to: Tools > Options > Expert Advisors");
         Print("2. Check 'Allow WebRequest for listed URL'");
         Print("3. Click 'Add' and enter:");
         Print("   https://soosdjmnpcyuqppdjsse.supabase.co");
         Print("4. Click OK and restart the EA");
         Print("=================================================");
      }
      g_webRequestOk = false;
   }
   else
   {
      Print("Journaling connection OK!");
      g_webRequestOk = true;
   }
}

//+------------------------------------------------------------------+
//| Check if Deal Already Processed                                   |
//+------------------------------------------------------------------+
bool IsDealProcessed(ulong dealTicket)
{
   int size = ArraySize(g_processedDeals);
   for(int i = 0; i < size; i++)
   {
      if(g_processedDeals[i] == dealTicket)
         return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Mark Deal as Processed                                            |
//+------------------------------------------------------------------+
void MarkDealProcessed(ulong dealTicket)
{
   int size = ArraySize(g_processedDeals);
   
   if(size >= g_maxProcessedDeals)
   {
      int removeCount = g_maxProcessedDeals / 2;
      for(int i = 0; i < size - removeCount; i++)
      {
         g_processedDeals[i] = g_processedDeals[i + removeCount];
      }
      ArrayResize(g_processedDeals, size - removeCount);
      size = ArraySize(g_processedDeals);
   }
   
   ArrayResize(g_processedDeals, size + 1);
   g_processedDeals[size] = dealTicket;
}

//+------------------------------------------------------------------+
//| Format Timestamp as ISO 8601 UTC                                  |
//+------------------------------------------------------------------+
string FormatTimestampUTC(datetime time)
{
   MqlDateTime dt;
   TimeToStruct(time, dt);
   
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       dt.year, dt.mon, dt.day,
                       dt.hour, dt.min, dt.sec);
}

//+------------------------------------------------------------------+
//| Escape JSON String                                                |
//+------------------------------------------------------------------+
string EscapeJsonString(string str)
{
   string result = str;
   StringReplace(result, "\\", "\\\\");
   StringReplace(result, "\"", "\\\"");
   StringReplace(result, "\n", "\\n");
   StringReplace(result, "\r", "\\r");
   StringReplace(result, "\t", "\\t");
   return result;
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
      double masterBalance = ExtractJsonNumber(eventJson, "balance");
      if(masterBalance > 0)
      {
         double ratio = balance / masterBalance;
         lots = masterLots * ratio * g_config.risk_value;
      }
   }
   else if(g_config.risk_mode == "risk_percent" && masterSL > 0)
   {
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
      double riskPips = MathAbs(masterPrice - masterSL) / SymbolInfoDouble(receiverSymbol, SYMBOL_POINT);
      double tickValue = SymbolInfoDouble(receiverSymbol, SYMBOL_TRADE_TICK_VALUE);
      
      if(riskPips > 0 && tickValue > 0)
      {
         lots = g_config.risk_value / (riskPips * tickValue);
      }
   }
   else if(g_config.risk_mode == "intent")
   {
      double riskPips = ExtractJsonNumber(eventJson, "risk_pips");
      double tickValue = SymbolInfoDouble(receiverSymbol, SYMBOL_TRADE_TICK_VALUE);
      double riskAmount = balance * 0.01;
      
      if(riskPips > 0 && tickValue > 0)
      {
         lots = riskAmount / (riskPips * tickValue);
      }
   }
   
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
   MqlDateTime now;
   TimeCurrent(now);
   
   MqlDateTime pnlDate;
   TimeToStruct(g_dailyPnLDate, pnlDate);
   
   if(now.day != pnlDate.day || now.mon != pnlDate.mon || now.year != pnlDate.year)
   {
      CalculateDailyPnL();
   }
   
   double maxLoss = InpDailyLossOverride > 0 ? InpDailyLossOverride : g_config.max_daily_loss_r;
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double lossPercent = (g_dailyPnL / balance) * 100.0;
   
   if(lossPercent < -maxLoss)
   {
      Print("Daily loss limit reached: ", DoubleToString(lossPercent, 2), "% < -", maxLoss, "%");
      return false;
   }
   
   return true;
}

//+------------------------------------------------------------------+
//| Calculate Daily P&L                                               |
//+------------------------------------------------------------------+
void CalculateDailyPnL()
{
   g_dailyPnL = 0;
   g_dailyPnLDate = TimeCurrent();
   
   MqlDateTime today;
   TimeToStruct(g_dailyPnLDate, today);
   today.hour = 0;
   today.min = 0;
   today.sec = 0;
   
   datetime startOfDay = StructToTime(today);
   
   HistorySelect(startOfDay, TimeCurrent());
   
   int totalDeals = HistoryDealsTotal();
   for(int i = 0; i < totalDeals; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      
      ENUM_DEAL_TYPE type = (ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(type == DEAL_TYPE_BALANCE || type == DEAL_TYPE_CREDIT)
         continue;
      
      g_dailyPnL += HistoryDealGetDouble(ticket, DEAL_PROFIT);
      g_dailyPnL += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      g_dailyPnL += HistoryDealGetDouble(ticket, DEAL_SWAP);
   }
}

//+------------------------------------------------------------------+
//| Check Session Filter                                              |
//+------------------------------------------------------------------+
bool CheckSessionFilter()
{
   int sessionCount = ArraySize(g_config.allowed_sessions);
   if(sessionCount == 0)
      return true;
   
   // Get current broker time and convert to UTC
   MqlDateTime now;
   TimeCurrent(now);
   
   // Adjust for broker UTC offset to get actual UTC hour
   int utcHour = now.hour - InpBrokerUTCOffset;
   if(utcHour < 0) utcHour += 24;
   if(utcHour >= 24) utcHour -= 24;
   
   for(int i = 0; i < sessionCount; i++)
   {
      string session = g_config.allowed_sessions[i];
      
      // Session times in UTC
      if(session == "tokyo" && utcHour >= 0 && utcHour < 9)
         return true;
      if(session == "london" && utcHour >= 7 && utcHour < 16)
         return true;
      if(session == "new_york" && utcHour >= 12 && utcHour < 21)
         return true;
      if(session == "new_york_am" && utcHour >= 12 && utcHour < 17)
         return true;
      if(session == "new_york_pm" && utcHour >= 17 && utcHour < 21)
         return true;
      if(session == "overlap_london_ny" && utcHour >= 12 && utcHour < 16)
         return true;
   }
   
   return false;
}

//+------------------------------------------------------------------+
//| Move File to Executed Folder                                      |
//+------------------------------------------------------------------+
void MoveToExecuted(string fullPath, string filename)
{
   if(!FolderCreate(g_executedFolder))
   {
      if(GetLastError() != 5020)
         return;
   }
   
   string destPath = g_executedFolder + "\\" + filename;
   
   FileMove(fullPath, 0, destPath, FILE_REWRITE);
}

//+------------------------------------------------------------------+
//| Check if Event Already Executed                                   |
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

//+------------------------------------------------------------------+
//| Mark Event as Executed                                            |
//+------------------------------------------------------------------+
void MarkEventExecuted(string idempotencyKey, long receiverPosId, double slippage)
{
   // Prune old events if array is too large (keep last 500)
   if(ArraySize(g_executedEvents) > 1000)
   {
      int keepCount = 500;
      ExecutedEvent tempEvents[];
      ArrayResize(tempEvents, keepCount);
      
      int startIdx = ArraySize(g_executedEvents) - keepCount;
      for(int i = 0; i < keepCount; i++)
      {
         tempEvents[i] = g_executedEvents[startIdx + i];
      }
      
      ArrayResize(g_executedEvents, keepCount);
      for(int i = 0; i < keepCount; i++)
      {
         g_executedEvents[i] = tempEvents[i];
      }
      
      if(InpVerboseMode)
         Print("Pruned executed events array from 1000+ to ", keepCount);
   }
   
   int idx = ArraySize(g_executedEvents);
   ArrayResize(g_executedEvents, idx + 1);
   g_executedEvents[idx].idempotency_key = idempotencyKey;
   g_executedEvents[idx].receiver_position_id = receiverPosId;
   g_executedEvents[idx].executed_at = TimeCurrent();
   g_executedEvents[idx].slippage_pips = slippage;
}

//+------------------------------------------------------------------+
//| Get Receiver Position ID from Master Position ID                  |
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

//+------------------------------------------------------------------+
//| Remove Position Map                                               |
//+------------------------------------------------------------------+
void RemovePositionMap(long masterPosId)
{
   int size = ArraySize(g_positionMaps);
   for(int i = 0; i < size; i++)
   {
      if(g_positionMaps[i].master_position_id == masterPosId)
      {
         for(int j = i; j < size - 1; j++)
         {
            g_positionMaps[j] = g_positionMaps[j + 1];
         }
         ArrayResize(g_positionMaps, size - 1);
         return;
      }
   }
}

//+------------------------------------------------------------------+
//| Save Position Maps to JSON File (Atomic Write)                    |
//+------------------------------------------------------------------+
void SavePositionMaps()
{
   string tempFile = g_positionsFile + ".tmp";
   
   int handle = FileOpen(tempFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return;
   
   string json = "{\n";
   json += "  \"version\": 2,\n";
   json += "  \"receiver_id\": \"" + g_config.receiver_id + "\",\n";
   json += "  \"magic_number\": " + IntegerToString(g_magicNumber) + ",\n";
   json += "  \"updated_at\": \"" + FormatTimestampUTC(TimeCurrent()) + "\",\n";
   json += "  \"positions\": [\n";
   
   int count = ArraySize(g_positionMaps);
   for(int i = 0; i < count; i++)
   {
      json += "    {\n";
      json += "      \"master_position_id\": " + IntegerToString(g_positionMaps[i].master_position_id) + ",\n";
      json += "      \"receiver_position_id\": " + IntegerToString(g_positionMaps[i].receiver_position_id) + ",\n";
      json += "      \"symbol\": \"" + g_positionMaps[i].symbol + "\",\n";
      json += "      \"direction\": \"" + g_positionMaps[i].direction + "\",\n";
      json += "      \"lots\": " + DoubleToString(g_positionMaps[i].lots, 2) + "\n";
      json += "    }";
      if(i < count - 1)
         json += ",";
      json += "\n";
   }
   
   json += "  ]\n";
   json += "}";
   
   FileWriteString(handle, json);
   FileClose(handle);
   
   // Atomic rename: delete old file and rename temp to final
   if(FileIsExist(g_positionsFile))
      FileDelete(g_positionsFile);
   FileMove(tempFile, 0, g_positionsFile, FILE_REWRITE);
}

//+------------------------------------------------------------------+
//| Load Position Maps from JSON File                                 |
//+------------------------------------------------------------------+
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
   {
      content += FileReadString(handle) + "\n";
   }
   FileClose(handle);
   
   // Check if it's the old pipe-delimited format (for migration)
   if(StringFind(content, "{") < 0)
   {
      // Old format - parse pipe-delimited
      LoadPositionMapsLegacy(content);
      // Save in new JSON format
      SavePositionMaps();
      return;
   }
   
   // Parse JSON format
   int positionsStart = StringFind(content, "\"positions\"");
   if(positionsStart < 0)
      return;
   
   int arrayStart = StringFind(content, "[", positionsStart);
   int arrayEnd = StringFind(content, "]", arrayStart);
   if(arrayStart < 0 || arrayEnd < 0)
      return;
   
   string positionsStr = StringSubstr(content, arrayStart + 1, arrayEnd - arrayStart - 1);
   
   // Parse each position object
   int searchPos = 0;
   while(searchPos < StringLen(positionsStr))
   {
      int objStart = StringFind(positionsStr, "{", searchPos);
      if(objStart < 0)
         break;
      
      int objEnd = StringFind(positionsStr, "}", objStart);
      if(objEnd < 0)
         break;
      
      string objStr = StringSubstr(positionsStr, objStart, objEnd - objStart + 1);
      
      long masterPosId = (long)ExtractJsonNumber(objStr, "master_position_id");
      long receiverPosId = (long)ExtractJsonNumber(objStr, "receiver_position_id");
      string symbol = ExtractJsonString(objStr, "symbol");
      string direction = ExtractJsonString(objStr, "direction");
      double lots = ExtractJsonNumber(objStr, "lots");
      
      if(masterPosId > 0 && receiverPosId > 0)
      {
         int idx = ArraySize(g_positionMaps);
         ArrayResize(g_positionMaps, idx + 1);
         g_positionMaps[idx].master_position_id = masterPosId;
         g_positionMaps[idx].receiver_position_id = receiverPosId;
         g_positionMaps[idx].symbol = symbol;
         g_positionMaps[idx].direction = direction;
         g_positionMaps[idx].lots = lots;
      }
      
      searchPos = objEnd + 1;
   }
   
   if(InpVerboseMode)
      Print("Loaded ", ArraySize(g_positionMaps), " position maps from JSON");
}

//+------------------------------------------------------------------+
//| Load Legacy Position Maps (pipe-delimited format)                 |
//+------------------------------------------------------------------+
void LoadPositionMapsLegacy(string content)
{
   string lines[];
   StringSplit(content, '\n', lines);
   
   for(int i = 0; i < ArraySize(lines); i++)
   {
      string line = lines[i];
      StringTrimLeft(line);
      StringTrimRight(line);
      
      if(StringLen(line) == 0)
         continue;
      
      string parts[];
      if(StringSplit(line, '|', parts) >= 5)
      {
         int idx = ArraySize(g_positionMaps);
         ArrayResize(g_positionMaps, idx + 1);
         g_positionMaps[idx].master_position_id = StringToInteger(parts[0]);
         g_positionMaps[idx].receiver_position_id = StringToInteger(parts[1]);
         g_positionMaps[idx].symbol = parts[2];
         g_positionMaps[idx].direction = parts[3];
         g_positionMaps[idx].lots = StringToDouble(parts[4]);
      }
   }
   
   if(InpVerboseMode)
      Print("Migrated ", ArraySize(g_positionMaps), " position maps from legacy format");
}

//+------------------------------------------------------------------+
//| Reconcile Position Maps - Validate and clean stale entries        |
//| Called on EA startup to ensure position maps are consistent       |
//+------------------------------------------------------------------+
void ReconcilePositionMaps()
{
   if(ArraySize(g_positionMaps) == 0)
      return;
   
   int originalCount = ArraySize(g_positionMaps);
   int removedCount = 0;
   int orphanedCount = 0;
   
   // Check each mapped position from the end (to safely remove while iterating)
   for(int i = ArraySize(g_positionMaps) - 1; i >= 0; i--)
   {
      long receiverPosId = g_positionMaps[i].receiver_position_id;
      long masterPosId = g_positionMaps[i].master_position_id;
      string symbol = g_positionMaps[i].symbol;
      
      // Check if receiver position still exists
      bool positionExists = PositionSelectByTicket((ulong)receiverPosId);
      
      if(!positionExists)
      {
         // Position was closed (manually or by SL/TP) - remove stale mapping
         LogMessage("Reconcile: Removing stale mapping for closed receiver position " + 
                   IntegerToString(receiverPosId) + " (master: " + IntegerToString(masterPosId) + ")");
         
         if(InpVerboseMode)
            Print("Reconcile: Position ", receiverPosId, " no longer exists - removing mapping");
         
         // Remove this mapping
         int size = ArraySize(g_positionMaps);
         for(int j = i; j < size - 1; j++)
         {
            g_positionMaps[j] = g_positionMaps[j + 1];
         }
         ArrayResize(g_positionMaps, size - 1);
         removedCount++;
         continue;
      }
      
      // Position exists - verify it matches our mapping
      string posSymbol = PositionGetString(POSITION_SYMBOL);
      double posVolume = PositionGetDouble(POSITION_VOLUME);
      long posMagic = PositionGetInteger(POSITION_MAGIC);
      
      // Check if this is actually our copier position (m4 fix: remove stale mappings)
      if(posMagic != g_magicNumber)
      {
         // Position exists but has different magic number - remove stale mapping
         LogMessage("Reconcile: Removing orphaned mapping for position " + 
                   IntegerToString(receiverPosId) + " (magic " + IntegerToString(posMagic) + 
                   " != " + IntegerToString(g_magicNumber) + ")");
         
         if(InpVerboseMode)
            Print("Reconcile: Position ", receiverPosId, " has wrong magic - removing mapping");
         
         // Remove this mapping
         int size = ArraySize(g_positionMaps);
         for(int j = i; j < size - 1; j++)
         {
            g_positionMaps[j] = g_positionMaps[j + 1];
         }
         ArrayResize(g_positionMaps, size - 1);
         orphanedCount++;
         removedCount++;
         continue;
      }
      
      // Update lot size if it changed (partial closes)
      if(MathAbs(g_positionMaps[i].lots - posVolume) > 0.001)
      {
         if(InpVerboseMode)
            Print("Reconcile: Updating lot size for position ", receiverPosId, 
                  " from ", g_positionMaps[i].lots, " to ", posVolume);
         g_positionMaps[i].lots = posVolume;
      }
   }
   
   // Save updated position maps if any changes were made
   if(removedCount > 0)
   {
      SavePositionMaps();
   }
   
   // Log reconciliation summary
   Print("=== Position Reconciliation Summary ===");
   Print("Original mappings: ", originalCount);
   Print("Removed (closed): ", removedCount);
   Print("Orphaned (magic mismatch): ", orphanedCount);
   Print("Active mappings: ", ArraySize(g_positionMaps));
   Print("=======================================");
   
   LogMessage("Reconciliation complete: " + IntegerToString(removedCount) + " stale mappings removed, " +
              IntegerToString(ArraySize(g_positionMaps)) + " active");
   
   // Alert user if there are orphaned positions
   if(orphanedCount > 0)
   {
      Print("WARNING: ", orphanedCount, " position(s) have mismatched magic numbers.");
      Print("These may be orphaned positions from previous runs or manual trades.");
   }
}

//+------------------------------------------------------------------+
//| Save Executed Events to JSON File (Atomic Write)                  |
//+------------------------------------------------------------------+
void SaveExecutedEvents()
{
   string tempFile = g_executedFile + ".tmp";
   
   int handle = FileOpen(tempFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return;
   
   int saveCount = MathMin(ArraySize(g_executedEvents), 500);
   int startIdx = MathMax(0, ArraySize(g_executedEvents) - saveCount);
   
   // Write as JSON array for better robustness
   string json = "{\n";
   json += "  \"version\": 1,\n";
   json += "  \"saved_at\": \"" + FormatTimestampUTC(TimeCurrent()) + "\",\n";
   json += "  \"events\": [\n";
   
   for(int i = startIdx; i < ArraySize(g_executedEvents); i++)
   {
      json += "    {\n";
      json += "      \"idempotency_key\": \"" + g_executedEvents[i].idempotency_key + "\",\n";
      json += "      \"receiver_position_id\": " + IntegerToString(g_executedEvents[i].receiver_position_id) + ",\n";
      json += "      \"executed_at\": \"" + TimeToString(g_executedEvents[i].executed_at, TIME_DATE|TIME_SECONDS) + "\",\n";
      json += "      \"slippage_pips\": " + DoubleToString(g_executedEvents[i].slippage_pips, 1) + "\n";
      json += "    }";
      if(i < ArraySize(g_executedEvents) - 1)
         json += ",";
      json += "\n";
   }
   
   json += "  ]\n";
   json += "}";
   
   FileWriteString(handle, json);
   FileClose(handle);
   
   // Atomic rename
   if(FileIsExist(g_executedFile))
      FileDelete(g_executedFile);
   FileMove(tempFile, 0, g_executedFile, FILE_REWRITE);
}

//+------------------------------------------------------------------+
//| Load Executed Events from File (supports both JSON and legacy)    |
//+------------------------------------------------------------------+
void LoadExecutedEvents()
{
   ArrayResize(g_executedEvents, 0);
   
   if(!FileIsExist(g_executedFile))
      return;
   
   int handle = FileOpen(g_executedFile, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return;
   
   string content = "";
   while(!FileIsEnding(handle))
   {
      content += FileReadString(handle) + "\n";
   }
   FileClose(handle);
   
   // Check if JSON format (new) or pipe-delimited (legacy)
   if(StringFind(content, "{") >= 0 && StringFind(content, "\"events\"") >= 0)
   {
      // New JSON format
      LoadExecutedEventsJson(content);
   }
   else
   {
      // Legacy pipe-delimited format
      LoadExecutedEventsLegacy(content);
   }
   
   if(InpVerboseMode)
      Print("Loaded ", ArraySize(g_executedEvents), " executed events");
}

//+------------------------------------------------------------------+
//| Load Executed Events from JSON format                             |
//+------------------------------------------------------------------+
void LoadExecutedEventsJson(string content)
{
   int eventsStart = StringFind(content, "\"events\"");
   if(eventsStart < 0) return;
   
   int arrayStart = StringFind(content, "[", eventsStart);
   int arrayEnd = StringFind(content, "]", arrayStart);
   if(arrayStart < 0 || arrayEnd < 0) return;
   
   string eventsStr = StringSubstr(content, arrayStart + 1, arrayEnd - arrayStart - 1);
   
   int searchPos = 0;
   while(searchPos < StringLen(eventsStr))
   {
      int objStart = StringFind(eventsStr, "{", searchPos);
      if(objStart < 0) break;
      
      int objEnd = StringFind(eventsStr, "}", objStart);
      if(objEnd < 0) break;
      
      string objStr = StringSubstr(eventsStr, objStart, objEnd - objStart + 1);
      
      string idempKey = ExtractJsonString(objStr, "idempotency_key");
      long recvPosId = (long)ExtractJsonNumber(objStr, "receiver_position_id");
      string execAt = ExtractJsonString(objStr, "executed_at");
      double slippage = ExtractJsonNumber(objStr, "slippage_pips");
      
      if(StringLen(idempKey) > 0)
      {
         int idx = ArraySize(g_executedEvents);
         ArrayResize(g_executedEvents, idx + 1);
         g_executedEvents[idx].idempotency_key = idempKey;
         g_executedEvents[idx].receiver_position_id = recvPosId;
         g_executedEvents[idx].executed_at = StringToTime(execAt);
         g_executedEvents[idx].slippage_pips = slippage;
      }
      
      searchPos = objEnd + 1;
   }
}

//+------------------------------------------------------------------+
//| Load Executed Events from Legacy pipe-delimited format            |
//+------------------------------------------------------------------+
void LoadExecutedEventsLegacy(string content)
{
   string lines[];
   StringSplit(content, '\n', lines);
   
   for(int i = 0; i < ArraySize(lines); i++)
   {
      string line = lines[i];
      StringTrimLeft(line);
      StringTrimRight(line);
      
      if(StringLen(line) == 0)
         continue;
      
      string parts[];
      if(StringSplit(line, '|', parts) >= 4)
      {
         int idx = ArraySize(g_executedEvents);
         ArrayResize(g_executedEvents, idx + 1);
         g_executedEvents[idx].idempotency_key = parts[0];
         g_executedEvents[idx].receiver_position_id = StringToInteger(parts[1]);
         g_executedEvents[idx].executed_at = StringToTime(parts[2]);
         g_executedEvents[idx].slippage_pips = StringToDouble(parts[3]);
      }
   }
}

//+------------------------------------------------------------------+
//| Log Message to File                                               |
//+------------------------------------------------------------------+
void LogMessage(string message)
{
   if(!InpEnableLogging || g_logHandle == INVALID_HANDLE)
      return;
   
   string logLine = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + " | " + message;
   FileWriteString(g_logHandle, logLine + "\n");
   FileFlush(g_logHandle);
}

//+------------------------------------------------------------------+
//| Get Optimal Filling Mode for Symbol                               |
//| Automatically detects broker-supported filling mode               |
//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING GetOptimalFillingMode(string symbol)
{
   // If auto-detect is disabled, use IOC as default
   if(!InpAutoFillMode)
      return ORDER_FILLING_IOC;
   
   // Get the filling modes supported by the symbol
   uint fillModes = (uint)SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   
   // Check which modes are available and prefer in order: FOK > IOC > RETURN
   if((fillModes & SYMBOL_FILLING_FOK) != 0)
   {
      // Fill or Kill - entire order must be filled or canceled
      // Good for prop firms requiring full fills
      return ORDER_FILLING_FOK;
   }
   else if((fillModes & SYMBOL_FILLING_IOC) != 0)
   {
      // Immediate or Cancel - fill what's available, cancel rest
      // Good for partial fills
      return ORDER_FILLING_IOC;
   }
   else if((fillModes & SYMBOL_FILLING_BOC) != 0)
   {
      // Book or Cancel (Return mode in some brokers)
      return ORDER_FILLING_BOC;
   }
   
   // Fallback to IOC if nothing detected (shouldn't happen)
   return ORDER_FILLING_IOC;
}

//+------------------------------------------------------------------+
//| Write Account Info for Desktop App (Atomic Write)                 |
//+------------------------------------------------------------------+
void WriteAccountInfo()
{
   string filename = "CopierAccountInfo.json";
   string tempFile = filename + ".tmp";
   
   int handle = FileOpen(tempFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   
   if(handle != INVALID_HANDLE)
   {
      string json = "{\n";
      json += "  \"account_number\": \"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\",\n";
      json += "  \"broker\": \"" + EscapeJsonString(AccountInfoString(ACCOUNT_COMPANY)) + "\",\n";
      json += "  \"server\": \"" + AccountInfoString(ACCOUNT_SERVER) + "\",\n";
      json += "  \"balance\": " + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",\n";
      json += "  \"equity\": " + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",\n";
      json += "  \"margin\": " + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",\n";
      json += "  \"free_margin\": " + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",\n";
      json += "  \"leverage\": " + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",\n";
      json += "  \"currency\": \"" + AccountInfoString(ACCOUNT_CURRENCY) + "\",\n";
      json += "  \"updated_at\": \"" + FormatTimestampUTC(TimeCurrent() - InpBrokerUTCOffset * 3600) + "\"\n";
      json += "}";
      
      FileWriteString(handle, json);
      FileClose(handle);
      
      // Atomic rename
      if(FileIsExist(filename))
         FileDelete(filename);
      FileMove(tempFile, 0, filename, FILE_REWRITE);
   }
}

//+------------------------------------------------------------------+
//| Save Processed Deals to File (M1 fix - prevent duplicate journal) |
//| Atomic write with temp file pattern                               |
//+------------------------------------------------------------------+
void SaveProcessedDeals()
{
   if(StringLen(g_processedDealsFile) == 0)
   {
      g_processedDealsFile = "ReceiverProcessedDeals_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".txt";
   }
   
   string tempFile = g_processedDealsFile + ".tmp";
   
   int handle = FileOpen(tempFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      LogMessage("Failed to save processed deals - cannot open file");
      return;
   }
   
   // Save only the most recent deals to prevent file growth
   int saveCount = MathMin(ArraySize(g_processedDeals), g_maxProcessedDeals);
   int startIdx = MathMax(0, ArraySize(g_processedDeals) - saveCount);
   
   for(int i = startIdx; i < ArraySize(g_processedDeals); i++)
   {
      FileWriteString(handle, IntegerToString(g_processedDeals[i]) + "\n");
   }
   FileClose(handle);
   
   // Atomic rename
   if(FileIsExist(g_processedDealsFile))
      FileDelete(g_processedDealsFile);
   FileMove(tempFile, 0, g_processedDealsFile, FILE_REWRITE);
   
   if(InpVerboseMode)
      Print("Saved ", saveCount, " processed deals to disk");
}

//+------------------------------------------------------------------+
//| Load Processed Deals from File (M1 fix)                           |
//+------------------------------------------------------------------+
void LoadProcessedDeals()
{
   ArrayResize(g_processedDeals, 0);
   
   // Set filename based on account
   g_processedDealsFile = "ReceiverProcessedDeals_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".txt";
   
   if(!FileIsExist(g_processedDealsFile))
   {
      if(InpVerboseMode)
         Print("No processed deals file found - starting fresh");
      return;
   }
   
   int handle = FileOpen(g_processedDealsFile, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
   {
      LogMessage("Failed to load processed deals - cannot open file");
      return;
   }
   
   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      StringTrimLeft(line);
      StringTrimRight(line);
      
      if(StringLen(line) == 0)
         continue;
      
      ulong dealId = (ulong)StringToInteger(line);
      if(dealId > 0)
      {
         int idx = ArraySize(g_processedDeals);
         ArrayResize(g_processedDeals, idx + 1);
         g_processedDeals[idx] = dealId;
      }
   }
   FileClose(handle);
   
   // Prune if loaded too many (keep most recent)
   if(ArraySize(g_processedDeals) > g_maxProcessedDeals)
   {
      ulong tempDeals[];
      int keepCount = g_maxProcessedDeals;
      ArrayResize(tempDeals, keepCount);
      
      int startIdx = ArraySize(g_processedDeals) - keepCount;
      for(int i = 0; i < keepCount; i++)
      {
         tempDeals[i] = g_processedDeals[startIdx + i];
      }
      
      ArrayResize(g_processedDeals, keepCount);
      for(int i = 0; i < keepCount; i++)
      {
         g_processedDeals[i] = tempDeals[i];
      }
   }
   
   if(InpVerboseMode)
      Print("Loaded ", ArraySize(g_processedDeals), " processed deals from disk");
   
   LogMessage("Loaded " + IntegerToString(ArraySize(g_processedDeals)) + " processed deals");
}
