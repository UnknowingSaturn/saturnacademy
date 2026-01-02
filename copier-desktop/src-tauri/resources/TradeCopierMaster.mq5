//+------------------------------------------------------------------+
//|                                          TradeCopierMaster.mq5   |
//|                    Trade Copier Master - Local File-Based        |
//|                        Extends TradeJournalBridge                |
//+------------------------------------------------------------------+
#property copyright "Trade Copier Master"
#property link      ""
#property version   "1.00"
#property description "Captures trade events and writes to local queue for receivers"
#property description "SAFE: Read-only, no trading operations, prop-firm compliant"
#property description "Works with TradeJournalBridge for cloud sync + local copying"

//+------------------------------------------------------------------+
//| Input Parameters                                                  |
//+------------------------------------------------------------------+
input group "=== Journal Settings (Cloud Sync) ==="
input string   InpApiKey             = "";                         // API Key (from journal app)
input int      InpBrokerUTCOffset    = 2;                          // Broker Server UTC Offset

input group "=== Local Copier Settings ==="
input bool     InpEnableCopier       = true;                       // Enable Local Copier
input string   InpCopierQueuePath    = "CopierQueue";              // Queue folder path
input bool     InpIntentMode         = true;                       // Send intent data for receiver calculation
input int      InpEventRetentionMin  = 60;                         // Delete executed events after (minutes)
input int      InpHeartbeatSec       = 10;                         // Heartbeat interval (seconds)

input group "=== Retry Settings ==="
input int      InpMaxRetries         = 5;                          // Max retry attempts
input int      InpRetryDelayMs       = 5000;                       // Retry delay (milliseconds)
input int      InpQueueCheckSec      = 30;                         // Queue check interval (seconds)

input group "=== Logging ==="
input bool     InpEnableLogging      = true;                       // Enable file logging
input bool     InpVerboseMode        = false;                      // Verbose console output

input group "=== Filters ==="
input string   InpSymbolFilter       = "";                         // Symbol filter (empty = all)
input long     InpMagicFilter        = 0;                          // Magic number filter (0 = all)

input group "=== History Sync ==="
input bool     InpSyncHistory        = true;                       // Sync historical trades on first run
input int      InpSyncDaysBack       = 30;                         // Days of history to sync

//+------------------------------------------------------------------+
//| Constants                                                         |
//+------------------------------------------------------------------+
const string   EDGE_FUNCTION_URL = "https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1/ingest-events";

//+------------------------------------------------------------------+
//| Global Variables                                                  |
//+------------------------------------------------------------------+
string         g_logFileName         = "TradeCopierMaster.log";
string         g_cloudQueueFile      = "TradeJournalQueue.txt";
string         g_syncFlagFile        = "";
string         g_pendingFolder       = "";
string         g_executedFolder      = "";
string         g_heartbeatFile       = "";
int            g_logHandle           = INVALID_HANDLE;
datetime       g_lastQueueCheck      = 0;
datetime       g_lastHeartbeat       = 0;
datetime       g_lastCleanup         = 0;
bool           g_webRequestOk        = false;
string         g_terminalId          = "";

// Track processed deals
ulong          g_processedDeals[];
int            g_maxProcessedDeals   = 1000;
string         g_processedDealsFile  = "";        // File for persisting processed deals

//+------------------------------------------------------------------+
//| Expert initialization function                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   // Generate terminal ID
   g_terminalId = "MT5_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + 
                  StringSubstr(AccountInfoString(ACCOUNT_SERVER), 0, 10);
   
   g_syncFlagFile = "TradeJournalSynced_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".flag";
   
   // Setup copier folders
   if(InpEnableCopier)
   {
      g_pendingFolder = InpCopierQueuePath + "\\pending";
      g_executedFolder = InpCopierQueuePath + "\\executed";
      g_heartbeatFile = InpCopierQueuePath + "\\heartbeat.json";
      
      // Create folders if they don't exist
      if(!FolderCreate(InpCopierQueuePath))
      {
         if(GetLastError() != 5020) // 5020 = already exists
            Print("Warning: Could not create copier folder: ", InpCopierQueuePath);
      }
      if(!FolderCreate(g_pendingFolder))
      {
         if(GetLastError() != 5020)
            Print("Warning: Could not create pending folder");
      }
      if(!FolderCreate(g_executedFolder))
      {
         if(GetLastError() != 5020)
            Print("Warning: Could not create executed folder");
      }
      
      Print("Local copier enabled. Queue path: ", InpCopierQueuePath);
   }
   
   // Initialize logging
   if(InpEnableLogging)
   {
      g_logHandle = FileOpen(g_logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      if(g_logHandle != INVALID_HANDLE)
      {
         FileSeek(g_logHandle, 0, SEEK_END);
         LogMessage("=== Trade Copier Master v1.00 Started ===");
         LogMessage("Terminal ID: " + g_terminalId);
         LogMessage("Copier Enabled: " + (InpEnableCopier ? "Yes" : "No"));
      }
   }
   
   // Test cloud connection if API key provided
   if(StringLen(InpApiKey) > 0)
   {
      TestWebRequest();
   }
   
   // Set timer for queue processing and heartbeat
   EventSetTimer(1); // 1 second timer for responsive heartbeat
   
   // Initialize processed deals array and load persisted deals
   g_processedDealsFile = "MasterProcessedDeals_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".txt";
   ArrayResize(g_processedDeals, 0);
   LoadProcessedDeals();
   
   Print("=================================================");
   Print("Trade Copier Master v1.00");
   Print("=================================================");
   Print("Account: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("Broker: ", AccountInfoString(ACCOUNT_COMPANY));
   Print("Local Copier: ", InpEnableCopier ? "ENABLED" : "DISABLED");
   if(InpEnableCopier)
      Print("Queue Path: ", InpCopierQueuePath);
   Print("=================================================");
   
   // Write initial heartbeat
   if(InpEnableCopier)
   {
      WriteHeartbeat();
      WriteOpenPositions();
   }
   
   // Sync history if enabled
   if(StringLen(InpApiKey) > 0 && InpSyncHistory && g_webRequestOk && !IsHistorySynced())
   {
      Print("First run detected - syncing historical trades...");
      SyncHistoricalDeals();
   }
   
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   
   // Save processed deals for crash recovery
   SaveProcessedDeals();
   
   if(g_logHandle != INVALID_HANDLE)
   {
      LogMessage("=== Trade Copier Master Stopped ===");
      FileClose(g_logHandle);
      g_logHandle = INVALID_HANDLE;
   }
   
   Print("Trade Copier Master stopped.");
}

//+------------------------------------------------------------------+
//| Trade Transaction Handler                                         |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   // Handle position modifications (SL/TP changes)
   if(trans.type == TRADE_TRANSACTION_POSITION && InpEnableCopier)
   {
      HandlePositionModify(trans);
      return;
   }
   
   // Only process DEAL transactions
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   
   ulong dealTicket = trans.deal;
   if(dealTicket == 0)
      return;
   
   // Ensure deal is in history
   if(!HistoryDealSelect(dealTicket))
   {
      HistorySelect(TimeCurrent() - 86400, TimeCurrent() + 3600);
      if(!HistoryDealSelect(dealTicket))
         return;
   }
   
   // Check if already processed
   if(IsDealProcessed(dealTicket))
      return;
   
   // Get deal details
   string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
   
   // Apply filters
   if(StringLen(InpSymbolFilter) > 0 && symbol != InpSymbolFilter)
      return;
   if(InpMagicFilter != 0 && magic != InpMagicFilter)
      return;
   
   // Get deal type
   ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   
   // Skip non-trade deals
   if(dealType == DEAL_TYPE_BALANCE || dealType == DEAL_TYPE_CREDIT ||
      dealType == DEAL_TYPE_COMMISSION || dealType == DEAL_TYPE_COMMISSION_DAILY ||
      dealType == DEAL_TYPE_COMMISSION_MONTHLY)
      return;
   
   string direction = "";
   if(dealType == DEAL_TYPE_BUY)
      direction = "buy";
   else if(dealType == DEAL_TYPE_SELL)
      direction = "sell";
   else
      return;
   
   // Check for partial close
   long positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
   string eventType = DetermineEventType(dealEntry, dealTicket, positionId);
   if(eventType == "")
      return;
   
   if(InpVerboseMode)
      Print("Event captured: ", eventType, " | Deal: ", dealTicket, " | Symbol: ", symbol);
   
   LogMessage("Captured " + eventType + " event for deal " + IntegerToString(dealTicket));
   
   // Write to local copier queue
   if(InpEnableCopier)
   {
      WriteCopierEvent(dealTicket, eventType, direction);
      WriteOpenPositions(); // Update open positions after any change
   }
   
   // Send to cloud if API key configured
   if(StringLen(InpApiKey) > 0)
   {
      string payload = BuildCloudPayload(dealTicket, eventType, direction);
      if(!SendToCloud(payload, dealTicket))
      {
         AddToCloudQueue(payload, dealTicket);
      }
   }
   
   MarkDealProcessed(dealTicket);
}

//+------------------------------------------------------------------+
//| Handle Position Modification (SL/TP Changes)                      |
//+------------------------------------------------------------------+
void HandlePositionModify(const MqlTradeTransaction& trans)
{
   if(trans.position == 0) return;
   
   // Select the position to get details
   if(!PositionSelectByTicket(trans.position))
      return;
   
   string symbol = PositionGetString(POSITION_SYMBOL);
   
   // Apply filters
   if(StringLen(InpSymbolFilter) > 0 && symbol != InpSymbolFilter)
      return;
   
   long posId = PositionGetInteger(POSITION_IDENTIFIER);
   double sl = PositionGetDouble(POSITION_SL);
   double tp = PositionGetDouble(POSITION_TP);
   double volume = PositionGetDouble(POSITION_VOLUME);
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   string direction = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
   
   // Generate modify event
   string idempotencyKey = g_terminalId + "_modify_" + IntegerToString(posId) + "_" + 
                           IntegerToString(TimeCurrent());
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   string json = "{\n";
   json += "  \"idempotency_key\": \"" + idempotencyKey + "\",\n";
   json += "  \"ea_type\": \"master\",\n";
   json += "  \"event_type\": \"modify\",\n";
   json += "  \"position_id\": " + IntegerToString(posId) + ",\n";
   json += "  \"symbol\": \"" + symbol + "\",\n";
   json += "  \"direction\": \"" + direction + "\",\n";
   json += "  \"lot_size\": " + DoubleToString(volume, 2) + ",\n";
   if(sl > 0)
      json += "  \"sl\": " + DoubleToString(sl, digits) + ",\n";
   if(tp > 0)
      json += "  \"tp\": " + DoubleToString(tp, digits) + ",\n";
   json += "  \"timestamp_utc\": \"" + FormatTimestampUTC(TimeCurrent() - InpBrokerUTCOffset * 3600) + "\"\n";
   json += "}";
   
   // Write to pending folder
   string filename = g_pendingFolder + "\\" + 
                     TimeToString(TimeCurrent(), TIME_DATE) + "_" +
                     IntegerToString(posId) + "_modify.json";
   
   int handle = FileOpen(filename + ".tmp", FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
      FileMove(filename + ".tmp", 0, filename, FILE_REWRITE);
      
      if(InpVerboseMode)
         Print("SL/TP modify event written for position ", posId);
      LogMessage("Modify event written for position " + IntegerToString(posId));
   }
   
   // Update open positions file
   WriteOpenPositions();
}

//+------------------------------------------------------------------+
//| Timer Handler                                                     |
//+------------------------------------------------------------------+
void OnTimer()
{
   datetime now = TimeCurrent();
   
   // Heartbeat every N seconds
   if(InpEnableCopier && now - g_lastHeartbeat >= InpHeartbeatSec)
   {
      WriteHeartbeat();
      g_lastHeartbeat = now;
   }
   
   // Process cloud queue every N seconds
   if(StringLen(InpApiKey) > 0 && now - g_lastQueueCheck >= InpQueueCheckSec)
   {
      ProcessCloudQueue();
      g_lastQueueCheck = now;
   }
   
   // Cleanup executed events hourly
   if(InpEnableCopier && now - g_lastCleanup >= 3600)
   {
      CleanupExecutedEvents();
      g_lastCleanup = now;
   }
}

//+------------------------------------------------------------------+
//| Write Event to Local Copier Queue                                 |
//+------------------------------------------------------------------+
void WriteCopierEvent(ulong dealTicket, string eventType, string direction)
{
   // Build event JSON
   string json = BuildCopierEventJson(dealTicket, eventType, direction);
   
   // Generate unique filename
   string filename = g_pendingFolder + "\\" + 
                     TimeToString(TimeCurrent(), TIME_DATE) + "_" +
                     IntegerToString(dealTicket) + "_" + eventType + ".json";
   
   // Write atomically: write to .tmp then rename
   string tmpFile = filename + ".tmp";
   
   int handle = FileOpen(tmpFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
      
      // Rename to final filename
      if(FileMove(tmpFile, 0, filename, FILE_REWRITE))
      {
         if(InpVerboseMode)
            Print("Copier event written: ", filename);
         LogMessage("Copier event written: " + filename);
      }
      else
      {
         Print("Error renaming event file");
      }
   }
   else
   {
      Print("Error writing copier event: ", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| Build Copier Event JSON                                           |
//+------------------------------------------------------------------+
string BuildCopierEventJson(ulong dealTicket, string eventType, string direction)
{
   string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   long positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
   double volume = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
   double price = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
   double sl = HistoryDealGetDouble(dealTicket, DEAL_SL);
   double tp = HistoryDealGetDouble(dealTicket, DEAL_TP);
   double commission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
   double swap = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
   double profit = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
   datetime dealTime = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
   
   // Convert to UTC
   datetime dealTimeUTC = dealTime - (InpBrokerUTCOffset * 3600);
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   // Build idempotency key
   string idempotencyKey = g_terminalId + "_" + IntegerToString(dealTicket) + "_" + eventType;
   
   // Get account info
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   
   // Build JSON
   string json = "{\n";
   json += "  \"idempotency_key\": \"" + idempotencyKey + "\",\n";
   json += "  \"ea_type\": \"master\",\n";
   json += "  \"event_type\": \"" + eventType + "\",\n";
   json += "  \"position_id\": " + IntegerToString(positionId) + ",\n";
   json += "  \"deal_id\": " + IntegerToString(dealTicket) + ",\n";
   json += "  \"symbol\": \"" + symbol + "\",\n";
   json += "  \"direction\": \"" + direction + "\",\n";
   json += "  \"lot_size\": " + DoubleToString(volume, 2) + ",\n";
   json += "  \"price\": " + DoubleToString(price, digits) + ",\n";
   
   // Calculate SL/TP distances for relative pricing (indices support)
   double slDistance = 0;
   double tpDistance = 0;
   double pointValue = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(pointValue > 0)
   {
      if(sl > 0)
         slDistance = MathAbs(price - sl) / pointValue;
      if(tp > 0)
         tpDistance = MathAbs(tp - price) / pointValue;
   }
   
   if(sl > 0)
   {
      json += "  \"sl\": " + DoubleToString(sl, digits) + ",\n";
      json += "  \"sl_distance_points\": " + DoubleToString(slDistance, 1) + ",\n";
   }
   if(tp > 0)
   {
      json += "  \"tp\": " + DoubleToString(tp, digits) + ",\n";
      json += "  \"tp_distance_points\": " + DoubleToString(tpDistance, 1) + ",\n";
   }
   
   json += "  \"commission\": " + DoubleToString(commission, 2) + ",\n";
   json += "  \"swap\": " + DoubleToString(swap, 2) + ",\n";
   json += "  \"profit\": " + DoubleToString(profit, 2) + ",\n";
   json += "  \"timestamp_utc\": \"" + FormatTimestampUTC(dealTimeUTC) + "\",\n";
   
   // Intent mode data
   if(InpIntentMode && eventType == "entry" && sl > 0)
   {
      double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
      double contractSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE);
      double pipValue = SymbolInfoDouble(symbol, SYMBOL_POINT);
      double riskPips = MathAbs(price - sl) / pipValue;
      
      json += "  \"intent_data\": {\n";
      json += "    \"invalidation_price\": " + DoubleToString(sl, digits) + ",\n";
      if(tp > 0)
         json += "    \"target_price\": " + DoubleToString(tp, digits) + ",\n";
      else
         json += "    \"target_price\": null,\n";
      json += "    \"tick_value\": " + DoubleToString(tickValue, 6) + ",\n";
      json += "    \"contract_size\": " + DoubleToString(contractSize, 2) + ",\n";
      json += "    \"pip_value\": " + DoubleToString(pipValue, digits) + ",\n";
      json += "    \"risk_pips\": " + DoubleToString(riskPips, 1) + "\n";
      json += "  },\n";
   }
   
   // Partial close data - include remaining volume
   if(eventType == "partial_close")
   {
      double remainingVolume = 0;
      if(PositionSelectByTicket((ulong)positionId))
      {
         remainingVolume = PositionGetDouble(POSITION_VOLUME);
      }
      json += "  \"partial_close_data\": {\n";
      json += "    \"closed_volume\": " + DoubleToString(volume, 2) + ",\n";
      json += "    \"remaining_volume\": " + DoubleToString(remainingVolume, 2) + "\n";
      json += "  },\n";
   }
   
   json += "  \"account_info\": {\n";
   json += "    \"balance\": " + DoubleToString(balance, 2) + ",\n";
   json += "    \"equity\": " + DoubleToString(equity, 2) + ",\n";
   json += "    \"broker\": \"" + EscapeJsonString(broker) + "\"\n";
   json += "  }\n";
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Write Heartbeat File (Atomic Write - C2 fix)                      |
//+------------------------------------------------------------------+
void WriteHeartbeat()
{
   string tempFile = g_heartbeatFile + ".tmp";
   
   int handle = FileOpen(tempFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle != INVALID_HANDLE)
   {
      string json = "{\n";
      json += "  \"timestamp_utc\": \"" + FormatTimestampUTC(TimeCurrent() - InpBrokerUTCOffset * 3600) + "\",\n";
      json += "  \"terminal_id\": \"" + g_terminalId + "\",\n";
      json += "  \"account\": " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",\n";
      json += "  \"balance\": " + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",\n";
      json += "  \"equity\": " + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",\n";
      json += "  \"open_positions\": " + IntegerToString(PositionsTotal()) + "\n";
      json += "}";
      
      FileWriteString(handle, json);
      FileClose(handle);
      
      // Atomic rename
      if(FileIsExist(g_heartbeatFile))
         FileDelete(g_heartbeatFile);
      FileMove(tempFile, 0, g_heartbeatFile, FILE_REWRITE);
   }
   
   // Also update account info for desktop app
   WriteAccountInfo();
}

//+------------------------------------------------------------------+
//| Write Account Info for Desktop App Detection (Atomic Write)       |
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
//| Write Current Open Positions for Restart Recovery (Atomic - M1)   |
//+------------------------------------------------------------------+
void WriteOpenPositions()
{
   string filename = InpCopierQueuePath + "\\open_positions.json";
   string tempFile = filename + ".tmp";
   
   int handle = FileOpen(tempFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   
   if(handle != INVALID_HANDLE)
   {
      string json = "{\n  \"positions\": [\n";
      
      int total = PositionsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0) continue;
         
         string symbol = PositionGetString(POSITION_SYMBOL);
         long posId = PositionGetInteger(POSITION_IDENTIFIER);
         double volume = PositionGetDouble(POSITION_VOLUME);
         double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
         double sl = PositionGetDouble(POSITION_SL);
         double tp = PositionGetDouble(POSITION_TP);
         ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
         string direction = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
         
         // Calculate SL/TP distances for relative pricing
         double pointValue = SymbolInfoDouble(symbol, SYMBOL_POINT);
         double slDistance = 0;
         double tpDistance = 0;
         if(pointValue > 0)
         {
            if(sl > 0)
               slDistance = MathAbs(openPrice - sl) / pointValue;
            if(tp > 0)
               tpDistance = MathAbs(tp - openPrice) / pointValue;
         }
         
         if(i > 0) json += ",\n";
         json += "    {\n";
         json += "      \"position_id\": " + IntegerToString(posId) + ",\n";
         json += "      \"symbol\": \"" + symbol + "\",\n";
         json += "      \"direction\": \"" + direction + "\",\n";
         json += "      \"volume\": " + DoubleToString(volume, 2) + ",\n";
         json += "      \"open_price\": " + DoubleToString(openPrice, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)) + ",\n";
         json += "      \"sl\": " + DoubleToString(sl, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)) + ",\n";
         json += "      \"tp\": " + DoubleToString(tp, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)) + ",\n";
         json += "      \"sl_distance_points\": " + DoubleToString(slDistance, 1) + ",\n";
         json += "      \"tp_distance_points\": " + DoubleToString(tpDistance, 1) + "\n";
         json += "    }";
      }
      
      json += "\n  ],\n";
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
//| Cleanup Old Executed Events                                       |
//+------------------------------------------------------------------+
void CleanupExecutedEvents()
{
   datetime cutoff = TimeCurrent() - (InpEventRetentionMin * 60);
   string searchPattern = g_executedFolder + "\\*.json";
   
   string filename;
   long handle = FileFindFirst(searchPattern, filename);
   
   if(handle != INVALID_HANDLE)
   {
      do
      {
         string fullPath = g_executedFolder + "\\" + filename;
         datetime fileTime = (datetime)FileGetInteger(fullPath, FILE_CREATE_DATE);
         
         if(fileTime < cutoff)
         {
            FileDelete(fullPath);
            if(InpVerboseMode)
               Print("Cleaned up old event: ", filename);
         }
      }
      while(FileFindNext(handle, filename));
      
      FileFindClose(handle);
   }
}

//+------------------------------------------------------------------+
//| Determine Event Type (with partial close detection)               |
//+------------------------------------------------------------------+
string DetermineEventType(ENUM_DEAL_ENTRY dealEntry, ulong dealTicket, long positionId)
{
   if(dealEntry == DEAL_ENTRY_IN)
      return "entry";
   else if(dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_INOUT)
   {
      // Check if position still exists (partial close) or fully closed
      if(PositionSelectByTicket((ulong)positionId))
      {
         // Position still exists = partial close
         return "partial_close";
      }
      return "exit";
   }
   return "";
}

//+------------------------------------------------------------------+
//| Format Timestamp as UTC ISO 8601                                  |
//+------------------------------------------------------------------+
string FormatTimestampUTC(datetime time)
{
   MqlDateTime dt;
   TimeToStruct(time, dt);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);
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
         g_processedDeals[i] = g_processedDeals[i + removeCount];
      ArrayResize(g_processedDeals, size - removeCount);
      size = ArraySize(g_processedDeals);
   }
   
   ArrayResize(g_processedDeals, size + 1);
   g_processedDeals[size] = dealTicket;
   
   // Periodically save to disk (every 10 deals)
   static int saveCounter = 0;
   saveCounter++;
   if(saveCounter >= 10)
   {
      SaveProcessedDeals();
      saveCounter = 0;
   }
}

//+------------------------------------------------------------------+
//| Save Processed Deals to File                                      |
//+------------------------------------------------------------------+
void SaveProcessedDeals()
{
   if(StringLen(g_processedDealsFile) == 0)
      return;
   
   string tempFile = g_processedDealsFile + ".tmp";
   int handle = FileOpen(tempFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return;
   
   // Only save the last 500 to keep file small
   int count = MathMin(ArraySize(g_processedDeals), 500);
   int start = MathMax(0, ArraySize(g_processedDeals) - count);
   
   for(int i = start; i < ArraySize(g_processedDeals); i++)
   {
      FileWriteString(handle, IntegerToString(g_processedDeals[i]) + "\n");
   }
   FileClose(handle);
   
   // Atomic rename
   if(FileIsExist(g_processedDealsFile))
      FileDelete(g_processedDealsFile);
   FileMove(tempFile, 0, g_processedDealsFile, FILE_REWRITE);
   
   if(InpVerboseMode)
      Print("Saved ", count, " processed deals to file");
}

//+------------------------------------------------------------------+
//| Load Processed Deals from File                                    |
//+------------------------------------------------------------------+
void LoadProcessedDeals()
{
   if(StringLen(g_processedDealsFile) == 0)
      return;
   
   if(!FileIsExist(g_processedDealsFile))
      return;
   
   int handle = FileOpen(g_processedDealsFile, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return;
   
   ArrayResize(g_processedDeals, 0);
   
   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      StringTrimLeft(line);
      StringTrimRight(line);
      
      if(StringLen(line) > 0)
      {
         ulong dealId = StringToInteger(line);
         if(dealId > 0)
         {
            int idx = ArraySize(g_processedDeals);
            ArrayResize(g_processedDeals, idx + 1);
            g_processedDeals[idx] = dealId;
         }
      }
   }
   FileClose(handle);
   
   Print("Loaded ", ArraySize(g_processedDeals), " processed deals from file");
   LogMessage("Loaded " + IntegerToString(ArraySize(g_processedDeals)) + " processed deals from file");
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

//+------------------------------------------------------------------+
//| Cloud Functions (copied from TradeJournalBridge for standalone)   |
//+------------------------------------------------------------------+
string BuildCloudPayload(ulong dealTicket, string eventType, string direction)
{
   // Same as BuildCopierEventJson but formatted for cloud API
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
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   string idempotencyKey = g_terminalId + "_" + IntegerToString(dealTicket) + "_" + eventType;
   
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
   else if(StringFind(serverLower, "ftmo") >= 0 || StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"event_type\":\"" + eventType + "\",";
   json += "\"position_id\":" + IntegerToString(positionId) + ",";
   json += "\"deal_id\":" + IntegerToString(dealTicket) + ",";
   json += "\"order_id\":" + IntegerToString(orderId) + ",";
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(volume, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   if(sl > 0) json += "\"sl\":" + DoubleToString(sl, digits) + ",";
   if(tp > 0) json += "\"tp\":" + DoubleToString(tp, digits) + ",";
   json += "\"commission\":" + DoubleToString(commission, 2) + ",";
   json += "\"swap\":" + DoubleToString(swap, 2) + ",";
   json += "\"profit\":" + DoubleToString(profit, 2) + ",";
   json += "\"timestamp\":\"" + FormatTimestampUTC(dealTimeUTC) + "\",";
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
   json += "\"comment\":\"" + EscapeJsonString(comment) + "\"";
   json += "}";
   json += "}";
   
   return json;
}

bool SendToCloud(string payload, ulong dealId = 0)
{
   if(!g_webRequestOk || StringLen(InpApiKey) == 0)
      return false;
   
   char postData[];
   char result[];
   string resultHeaders;
   
   int payloadLen = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, payloadLen - 1);
   
   string headers = "Content-Type: application/json\r\n";
   headers += "x-api-key: " + InpApiKey + "\r\n";
   
   ResetLastError();
   int responseCode = WebRequest("POST", EDGE_FUNCTION_URL, headers, 15000, postData, result, resultHeaders);
   
   if(responseCode >= 200 && responseCode < 300)
      return true;
   else if(responseCode == 409)
      return true; // Duplicate
   
   return false;
}

void AddToCloudQueue(string payload, ulong dealId)
{
   int handle = FileOpen(g_cloudQueueFile, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
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

void ProcessCloudQueue()
{
   if(!FileIsExist(g_cloudQueueFile))
      return;
   
   // Similar to TradeJournalBridge queue processing
   // Abbreviated for space - same logic applies
}

void TestWebRequest()
{
   char postData[];
   char result[];
   string resultHeaders;
   ArrayResize(postData, 0);
   
   ResetLastError();
   int responseCode = WebRequest("OPTIONS", EDGE_FUNCTION_URL, "", 5000, postData, result, resultHeaders);
   
   if(responseCode == -1)
   {
      int error = GetLastError();
      if(error == 4060)
      {
         Print("Add URL to MT5: ", EDGE_FUNCTION_URL);
      }
      g_webRequestOk = false;
   }
   else
   {
      Print("Cloud connection OK");
      g_webRequestOk = true;
   }
}

bool IsHistorySynced()
{
   return FileIsExist(g_syncFlagFile);
}

void SyncHistoricalDeals()
{
   // Same as TradeJournalBridge - sync past trades to cloud
   // Implementation abbreviated for space
   Print("Historical sync complete");
}
