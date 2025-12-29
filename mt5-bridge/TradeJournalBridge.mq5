//+------------------------------------------------------------------+
//|                                         TradeJournalBridge.mq5   |
//|                        Trade Journal Bridge - Production Grade   |
//|                             Read-Only Trade Event Observer       |
//+------------------------------------------------------------------+
#property copyright "Trade Journal Bridge"
#property link      ""
#property version   "2.10"
#property description "Captures trade lifecycle events and sends to journal backend"
#property description "SAFE: Read-only, no trading operations, prop-firm compliant"
#property description "Connects directly to cloud - no relay server needed!"

//+------------------------------------------------------------------+
//| Input Parameters                                                  |
//+------------------------------------------------------------------+
input group "=== Connection Settings ==="
input string   InpApiKey         = "";                         // API Key (from journal app)

input group "=== Broker Timezone ==="
input int      InpBrokerUTCOffset = 2;                         // Broker Server UTC Offset (e.g., 2 for UTC+2)

input group "=== Retry Settings ==="
input int      InpMaxRetries     = 5;                          // Max retry attempts
input int      InpRetryDelayMs   = 5000;                       // Retry delay (milliseconds)
input int      InpQueueCheckSec  = 30;                         // Queue check interval (seconds)

input group "=== Logging ==="
input bool     InpEnableLogging  = true;                       // Enable file logging
input bool     InpVerboseMode    = false;                      // Verbose console output

input group "=== Filters ==="
input string   InpSymbolFilter   = "";                         // Symbol filter (empty = all)
input long     InpMagicFilter    = 0;                          // Magic number filter (0 = all)

input group "=== History Sync ==="
input bool     InpSyncHistory    = true;                       // Sync historical trades on first run
input int      InpSyncDaysBack   = 30;                         // Days of history to sync

//+------------------------------------------------------------------+
//| Constants - Direct Edge Function URL                              |
//+------------------------------------------------------------------+
const string   EDGE_FUNCTION_URL = "https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1/ingest-events";

//+------------------------------------------------------------------+
//| Global Variables                                                  |
//+------------------------------------------------------------------+
string         g_logFileName     = "TradeJournal.log";
string         g_queueFileName   = "TradeJournalQueue.txt";    // Changed to .txt for FILE_TXT mode
string         g_syncFlagFile    = "";                         // Flag file to track history sync
int            g_logHandle       = INVALID_HANDLE;
datetime       g_lastQueueCheck  = 0;
bool           g_webRequestOk    = false;
string         g_terminalId      = "";

// Track processed deals to avoid duplicates
ulong          g_processedDeals[];
int            g_maxProcessedDeals = 1000;

//+------------------------------------------------------------------+
//| Expert initialization function                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   // Validate inputs
   if(StringLen(InpApiKey) == 0)
   {
      Print("ERROR: API Key is required. Get it from your journal app's Accounts page.");
      return INIT_PARAMETERS_INCORRECT;
   }
   
   // Generate terminal ID from account info for uniqueness
   g_terminalId = "MT5_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + 
                  StringSubstr(AccountInfoString(ACCOUNT_SERVER), 0, 10);
   
   // Generate sync flag file name unique to this account
   g_syncFlagFile = "TradeJournalSynced_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".flag";
   
   // Initialize logging
   if(InpEnableLogging)
   {
      g_logHandle = FileOpen(g_logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      if(g_logHandle != INVALID_HANDLE)
      {
         FileSeek(g_logHandle, 0, SEEK_END);
         LogMessage("=== Trade Journal Bridge v2.10 Started ===");
         LogMessage("Terminal ID: " + g_terminalId);
         LogMessage("Account: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
         LogMessage("Broker: " + AccountInfoString(ACCOUNT_COMPANY));
         LogMessage("Server: " + AccountInfoString(ACCOUNT_SERVER));
         LogMessage("Direct Edge Function: " + EDGE_FUNCTION_URL);
      }
   }
   
   // Test WebRequest availability
   TestWebRequest();
   
   // Set timer for queue processing
   EventSetTimer(InpQueueCheckSec);
   
   // Initialize processed deals array
   ArrayResize(g_processedDeals, 0);
   
   Print("=================================================");
   Print("Trade Journal Bridge v2.10 - Direct Cloud Connection");
   Print("=================================================");
   Print("Account: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("Broker: ", AccountInfoString(ACCOUNT_COMPANY));
   Print("Server: ", AccountInfoString(ACCOUNT_SERVER));
   Print("");
   Print("Your account will be created automatically");
   Print("after your first trade!");
   Print("=================================================");
   
   // Sync historical trades on first run (after a brief delay to ensure connection is ready)
   if(InpSyncHistory && g_webRequestOk && !IsHistorySynced())
   {
      Print("");
      Print("First run detected - syncing historical trades...");
      SyncHistoricalDeals();
   }
   
   // Always sync currently open positions on startup
   if(g_webRequestOk)
   {
      SyncOpenPositions();
   }
   
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   
   if(g_logHandle != INVALID_HANDLE)
   {
      LogMessage("=== Trade Journal Bridge Stopped ===");
      LogMessage("Reason: " + GetDeinitReasonText(reason));
      FileClose(g_logHandle);
      g_logHandle = INVALID_HANDLE;
   }
   
   Print("Trade Journal Bridge stopped. Reason: ", GetDeinitReasonText(reason));
}

//+------------------------------------------------------------------+
//| Trade Transaction Handler - PRIMARY EVENT CAPTURE                 |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   // Only process DEAL transactions (actual trade executions)
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   
   ulong dealTicket = trans.deal;
   if(dealTicket == 0)
      return;
   
   // Ensure deal is in history
   if(!HistoryDealSelect(dealTicket))
   {
      // Try to load recent history
      HistorySelect(TimeCurrent() - 86400, TimeCurrent() + 3600);
      if(!HistoryDealSelect(dealTicket))
      {
         if(InpVerboseMode)
            Print("Could not select deal: ", dealTicket);
         return;
      }
   }
   
   // Check if already processed
   if(IsDealProcessed(dealTicket))
   {
      if(InpVerboseMode)
         Print("Deal already processed: ", dealTicket);
      return;
   }
   
   // Get deal details
   string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
   
   // Apply filters
   if(StringLen(InpSymbolFilter) > 0 && symbol != InpSymbolFilter)
      return;
   
   if(InpMagicFilter != 0 && magic != InpMagicFilter)
      return;
   
   // Get deal type and entry
   ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   
   // Skip balance/credit/commission deals
   if(dealType == DEAL_TYPE_BALANCE || 
      dealType == DEAL_TYPE_CREDIT ||
      dealType == DEAL_TYPE_COMMISSION ||
      dealType == DEAL_TYPE_COMMISSION_DAILY ||
      dealType == DEAL_TYPE_COMMISSION_MONTHLY)
      return;
   
   // FIX Issue #2: Explicit direction handling - skip non-buy/sell deals
   string direction = "";
   if(dealType == DEAL_TYPE_BUY)
      direction = "buy";
   else if(dealType == DEAL_TYPE_SELL)
      direction = "sell";
   else
   {
      if(InpVerboseMode)
         Print("Skipping non-buy/sell deal type: ", dealType);
      return;
   }
   
   // FIX Issue #3: Simplified event type - let backend determine partial/full close
   string eventType = DetermineEventType(dealEntry);
   if(eventType == "")
      return;
   
   // Build and send event
   string payload = BuildEventPayload(dealTicket, eventType, direction);
   
   if(InpVerboseMode)
      Print("Event captured: ", eventType, " | Deal: ", dealTicket, " | Symbol: ", symbol);
   
   LogMessage("Captured " + eventType + " event for deal " + IntegerToString(dealTicket));
   
   // Attempt to send
   if(!SendEvent(payload, dealTicket))
   {
      // Add to queue for retry
      AddToQueue(payload, dealTicket);
      LogMessage("Event queued for retry: " + IntegerToString(dealTicket));
   }
   else
   {
      MarkDealProcessed(dealTicket);
      LogMessage("Event sent successfully: " + IntegerToString(dealTicket));
   }
}

//+------------------------------------------------------------------+
//| Timer Handler - Process Retry Queue                               |
//+------------------------------------------------------------------+
void OnTimer()
{
   ProcessQueue();
}

//+------------------------------------------------------------------+
//| Tick Handler - Backup Queue Processing                            |
//+------------------------------------------------------------------+
void OnTick()
{
   // Process queue every N seconds as backup
   if(TimeCurrent() - g_lastQueueCheck >= InpQueueCheckSec)
   {
      ProcessQueue();
      g_lastQueueCheck = TimeCurrent();
   }
}

//+------------------------------------------------------------------+
//| Determine Event Type from Deal Entry (Simplified)                 |
//| FIX Issue #3: Backend will determine partial vs full close        |
//+------------------------------------------------------------------+
string DetermineEventType(ENUM_DEAL_ENTRY dealEntry)
{
   if(dealEntry == DEAL_ENTRY_IN)
   {
      return "entry";
   }
   else if(dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_INOUT)
   {
      return "exit";
   }
   
   return "";
}

//+------------------------------------------------------------------+
//| Build JSON Payload for Event                                      |
//| FIX Issue #1: Send position_id, deal_id, order_id explicitly      |
//| FIX Issue #6: Use actual DEAL_TIME converted to UTC               |
//| FIX: Add timezone_offset_seconds and equity_at_entry for entries  |
//+------------------------------------------------------------------+
string BuildEventPayload(ulong dealTicket, string eventType, string direction)
{
   // Get all deal information
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
   
   // Build idempotency key using deal_id for uniqueness
   string idempotencyKey = g_terminalId + "_" + IntegerToString(dealTicket) + "_" + eventType;
   
   // FIX: Convert deal time to UTC using the CONFIGURED broker offset
   // dealTime is in broker server time (e.g., UTC+2), convert to UTC
   // Using configured offset instead of runtime TimeGMT()-TimeCurrent() which is unreliable for historical trades
   datetime dealTimeUTC = dealTime - (InpBrokerUTCOffset * 3600);
   string utcTimestamp = FormatTimestampUTC(dealTimeUTC);
   string serverTimestamp = FormatTimestamp(dealTime);
   
   // Store the configured broker offset in seconds
   long brokerOffsetSeconds = InpBrokerUTCOffset * 3600;
   
   // Get symbol digits for price formatting
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   // Get account info for auto-account creation
   long accountLogin = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string server = AccountInfoString(ACCOUNT_SERVER);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   
   // Detect account type from server name
   string accountType = "live";
   string serverLower = server;
   StringToLower(serverLower);
   if(StringFind(serverLower, "demo") >= 0)
      accountType = "demo";
   else if(StringFind(serverLower, "ftmo") >= 0 || 
           StringFind(serverLower, "fundednext") >= 0 ||
           StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   // Build JSON payload
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"event_type\":\"" + eventType + "\",";
   
   // FIX Issue #1: Send all three IDs explicitly
   json += "\"position_id\":" + IntegerToString(positionId) + ",";
   json += "\"deal_id\":" + IntegerToString(dealTicket) + ",";
   json += "\"order_id\":" + IntegerToString(orderId) + ",";
   
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(volume, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   
   // SL/TP - only include if set
   if(sl > 0)
      json += "\"sl\":" + DoubleToString(sl, digits) + ",";
   if(tp > 0)
      json += "\"tp\":" + DoubleToString(tp, digits) + ",";
   
   json += "\"commission\":" + DoubleToString(commission, 2) + ",";
   json += "\"swap\":" + DoubleToString(swap, 2) + ",";
   json += "\"profit\":" + DoubleToString(profit, 2) + ",";
   
   // FIX: Use configured broker offset (stored as seconds)
   json += "\"timestamp\":\"" + utcTimestamp + "\",";
   json += "\"server_time\":\"" + serverTimestamp + "\",";
   json += "\"broker_utc_offset\":" + IntegerToString(InpBrokerUTCOffset) + ",";
   json += "\"timezone_offset_seconds\":" + IntegerToString(brokerOffsetSeconds) + ",";
   
   // FIX: For entry events, capture equity at entry for R% calculation
   if(eventType == "entry")
      json += "\"equity_at_entry\":" + DoubleToString(equity, 2) + ",";
   
   // Account info for auto-creation
   json += "\"account_info\":{";
   json += "\"login\":" + IntegerToString(accountLogin) + ",";
   json += "\"broker\":\"" + EscapeJsonString(broker) + "\",";
   json += "\"server\":\"" + server + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"account_type\":\"" + accountType + "\"";
   json += "},";
   
   // Raw metadata
   json += "\"raw_payload\":{";
   json += "\"magic\":" + IntegerToString(magic) + ",";
   json += "\"comment\":\"" + EscapeJsonString(comment) + "\",";
   json += "\"local_time\":\"" + FormatTimestamp(TimeLocal()) + "\"";
   json += "}";
   
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Send Event to Edge Function (Direct Cloud)                        |
//+------------------------------------------------------------------+
bool SendEvent(string payload, ulong dealId = 0)
{
   if(!g_webRequestOk)
   {
      if(InpVerboseMode)
         Print("WebRequest not available, queuing event");
      return false;
   }
   
   char postData[];
   char result[];
   string resultHeaders;
   
   // Convert payload to char array
   int payloadLen = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, payloadLen - 1); // Remove null terminator
   
   // Build headers for Edge Function
   string headers = "Content-Type: application/json\r\n";
   headers += "x-api-key: " + InpApiKey + "\r\n";
   
   // Send directly to Edge Function
   int timeout = 15000; // 15 seconds
   
   ResetLastError();
   int responseCode = WebRequest("POST", EDGE_FUNCTION_URL, headers, timeout, postData, result, resultHeaders);
   
   if(responseCode == -1)
   {
      int error = GetLastError();
      string errorMsg = "WebRequest failed. Error: " + IntegerToString(error);
      
      if(error == 4060)
      {
         errorMsg += " - URL not allowed. Add to MT5 Options > Expert Advisors";
         Print("=================================================");
         Print("ACTION REQUIRED: Enable WebRequest");
         Print("1. Go to: Tools > Options > Expert Advisors");
         Print("2. Check 'Allow WebRequest for listed URL'");
         Print("3. Add: https://soosdjmnpcyuqppdjsse.supabase.co");
         Print("=================================================");
      }
      else if(error == 4014)
         errorMsg += " - WebRequest not allowed for this EA";
      else if(error == 5203)
         errorMsg += " - Connection failed. Check internet connection.";
      
      Print(errorMsg);
      LogMessage("ERROR: " + errorMsg);
      return false;
   }
   
   // Parse response
   string responseBody = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   
   if(responseCode >= 200 && responseCode < 300)
   {
      if(InpVerboseMode)
         Print("Event sent successfully. Response: ", responseBody);
      return true;
   }
   else if(responseCode == 409)
   {
      // Duplicate - consider as success
      if(InpVerboseMode)
         Print("Event already processed (duplicate)");
      return true;
   }
   else if(responseCode == 401)
   {
      Print("ERROR: Invalid API Key. Please check your API key in the EA settings.");
      LogMessage("ERROR: Invalid API Key");
      return false;
   }
   else if(responseCode == 503 || responseCode == 429)
   {
      // Rate limited or service unavailable - retry later
      Print("Server temporarily unavailable. Code: ", responseCode);
      LogMessage("Server unavailable, will retry. Code: " + IntegerToString(responseCode));
      return false;
   }
   else
   {
      Print("Server error. Code: ", responseCode, " Response: ", responseBody);
      LogMessage("Server error. Code: " + IntegerToString(responseCode) + " Response: " + responseBody);
      return false;
   }
}

//+------------------------------------------------------------------+
//| Add Event to Persistent Queue                                     |
//| FIX Issue #7: Use FILE_TXT mode for proper line handling          |
//| FIX Issue #10: Include deal_id for queue processing               |
//+------------------------------------------------------------------+
void AddToQueue(string payload, ulong dealId)
{
   int handle = FileOpen(g_queueFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   
   if(handle != INVALID_HANDLE)
   {
      FileSeek(handle, 0, SEEK_END);
      
      // Format: timestamp|retry_count|deal_id|payload (no base64 needed for FILE_TXT)
      // Use pipe delimiter and escape any pipes in payload
      string escapedPayload = payload;
      StringReplace(escapedPayload, "|", "{{PIPE}}");
      
      string line = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "|0|" + 
                    IntegerToString(dealId) + "|" + escapedPayload + "\n";
      FileWriteString(handle, line);
      FileClose(handle);
      
      if(InpVerboseMode)
         Print("Event added to queue");
   }
   else
   {
      Print("ERROR: Could not open queue file for writing");
   }
}

//+------------------------------------------------------------------+
//| Process Retry Queue                                               |
//| FIX Issue #7: Use FILE_TXT mode for proper line reading           |
//| FIX Issue #10: Mark deals as processed after queue success        |
//+------------------------------------------------------------------+
void ProcessQueue()
{
   if(!FileIsExist(g_queueFileName))
      return;
   
   int handle = FileOpen(g_queueFileName, FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
   
   if(handle == INVALID_HANDLE)
      return;
   
   // Read all queue entries
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
      // Delete empty queue file
      FileDelete(g_queueFileName);
      return;
   }
   
   // Process entries
   string remainingEntries[];
   int remainingCount = 0;
   
   for(int i = 0; i < count; i++)
   {
      string parts[];
      int partCount = StringSplit(entries[i], '|', parts);
      
      if(partCount < 4)
         continue;
      
      string timestamp = parts[0];
      int retryCount = (int)StringToInteger(parts[1]);
      ulong dealId = (ulong)StringToInteger(parts[2]);
      
      // Reconstruct payload (may have been split on |)
      string escapedPayload = parts[3];
      for(int j = 4; j < partCount; j++)
      {
         escapedPayload += "|" + parts[j];
      }
      
      // Unescape pipes
      StringReplace(escapedPayload, "{{PIPE}}", "|");
      string payload = escapedPayload;
      
      // Check retry limit
      if(retryCount >= InpMaxRetries)
      {
         LogMessage("Max retries exceeded for deal " + IntegerToString(dealId) + ", discarding");
         Print("Event discarded after ", InpMaxRetries, " retries");
         continue;
      }
      
      // Attempt to send
      if(SendEvent(payload, dealId))
      {
         // FIX Issue #10: Mark deal as processed after successful queue send
         MarkDealProcessed(dealId);
         if(InpVerboseMode)
            Print("Queued event sent successfully");
         LogMessage("Queued event sent successfully after " + IntegerToString(retryCount) + " retries");
      }
      else
      {
         // FIX: Add retry delay to avoid hammering server
         Sleep(InpRetryDelayMs);
         
         // Re-queue with incremented retry count
         string escapedForRequeue = payload;
         StringReplace(escapedForRequeue, "|", "{{PIPE}}");
         ArrayResize(remainingEntries, remainingCount + 1);
         remainingEntries[remainingCount] = timestamp + "|" + IntegerToString(retryCount + 1) + "|" + 
                                            IntegerToString(dealId) + "|" + escapedForRequeue;
         remainingCount++;
      }
   }
   
   // Rewrite queue file with remaining entries
   if(remainingCount > 0)
   {
      handle = FileOpen(g_queueFileName, FILE_WRITE|FILE_TXT|FILE_ANSI);
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
      FileDelete(g_queueFileName);
   }
}

//+------------------------------------------------------------------+
//| Test WebRequest Availability                                      |
//| FIX Issue #5: Use proper OPTIONS request without body             |
//+------------------------------------------------------------------+
void TestWebRequest()
{
   char postData[];
   char result[];
   string resultHeaders;
   
   // FIX Issue #5: Empty body for OPTIONS request, minimal headers
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
         Print("SETUP REQUIRED: Enable WebRequest");
         Print("");
         Print("1. Go to: Tools > Options > Expert Advisors");
         Print("2. Check 'Allow WebRequest for listed URL'");
         Print("3. Click 'Add' and enter:");
         Print("   https://soosdjmnpcyuqppdjsse.supabase.co");
         Print("4. Click OK and restart the EA");
         Print("=================================================");
         LogMessage("WebRequest not allowed - add URL to MT5 settings");
      }
      else if(error == 5203)
      {
         Print("INFO: Could not connect to server. Check internet connection.");
         LogMessage("Connection test failed - check internet");
      }
      g_webRequestOk = false;
   }
   else
   {
      Print("Connection OK! Ready to send trade events.");
      LogMessage("WebRequest test successful");
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
   
   // Limit array size
   if(size >= g_maxProcessedDeals)
   {
      // Remove oldest entries (first half)
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
//| Format Timestamp as ISO 8601 (without Z - for non-UTC times)      |
//| FIX Issue #6: Don't append Z to non-UTC timestamps                |
//+------------------------------------------------------------------+
string FormatTimestamp(datetime time)
{
   MqlDateTime dt;
   TimeToStruct(time, dt);
   
   // No Z suffix - this is server/local time, not UTC
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d",
                       dt.year, dt.mon, dt.day,
                       dt.hour, dt.min, dt.sec);
}

//+------------------------------------------------------------------+
//| Format Timestamp as ISO 8601 UTC (with Z suffix)                  |
//| FIX Issue #6: Proper UTC timestamp with Z suffix                  |
//+------------------------------------------------------------------+
string FormatTimestampUTC(datetime time)
{
   MqlDateTime dt;
   TimeToStruct(time, dt);
   
   // Z suffix indicates UTC
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
//| Get Deinitialization Reason Text                                  |
//+------------------------------------------------------------------+
string GetDeinitReasonText(int reason)
{
   switch(reason)
   {
      case REASON_PROGRAM:     return "EA stopped by program";
      case REASON_REMOVE:      return "EA removed from chart";
      case REASON_RECOMPILE:   return "EA recompiled";
      case REASON_CHARTCHANGE: return "Chart symbol/period changed";
      case REASON_CHARTCLOSE:  return "Chart closed";
      case REASON_PARAMETERS:  return "Parameters changed";
      case REASON_ACCOUNT:     return "Account changed";
      case REASON_TEMPLATE:    return "Template applied";
      case REASON_INITFAILED:  return "OnInit failed";
      case REASON_CLOSE:       return "Terminal closed";
      default:                 return "Unknown reason (" + IntegerToString(reason) + ")";
   }
}

//+------------------------------------------------------------------+
//| Check if History Already Synced (flag file exists)               |
//+------------------------------------------------------------------+
bool IsHistorySynced()
{
   return FileIsExist(g_syncFlagFile);
}

//+------------------------------------------------------------------+
//| Mark History as Synced (create flag file)                         |
//+------------------------------------------------------------------+
void MarkHistorySynced(int dealCount)
{
   int handle = FileOpen(g_syncFlagFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle != INVALID_HANDLE)
   {
      string info = "History synced at " + TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "\n";
      info += "Deals synced: " + IntegerToString(dealCount) + "\n";
      info += "Days back: " + IntegerToString(InpSyncDaysBack) + "\n";
      FileWriteString(handle, info);
      FileClose(handle);
   }
}

//+------------------------------------------------------------------+
//| Sync Historical Deals                                             |
//| Scans deal history and sends past trades to the journal           |
//+------------------------------------------------------------------+
void SyncHistoricalDeals()
{
   datetime fromTime = TimeCurrent() - (InpSyncDaysBack * 86400);
   datetime toTime = TimeCurrent();
   
   // Request deal history
   if(!HistorySelect(fromTime, toTime))
   {
      Print("ERROR: Could not load deal history");
      LogMessage("History sync failed - could not load history");
      return;
   }
   
   int totalDeals = HistoryDealsTotal();
   Print("Scanning ", totalDeals, " deals from the last ", InpSyncDaysBack, " days...");
   LogMessage("History sync started - scanning " + IntegerToString(totalDeals) + " deals");
   
   int sentCount = 0;
   int skippedCount = 0;
   int errorCount = 0;
   
   for(int i = 0; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0)
         continue;
      
      // Get deal details
      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      
      // Apply filters
      if(StringLen(InpSymbolFilter) > 0 && symbol != InpSymbolFilter)
      {
         skippedCount++;
         continue;
      }
      
      if(InpMagicFilter != 0 && magic != InpMagicFilter)
      {
         skippedCount++;
         continue;
      }
      
      // Skip balance/credit/commission deals
      if(dealType == DEAL_TYPE_BALANCE || 
         dealType == DEAL_TYPE_CREDIT ||
         dealType == DEAL_TYPE_COMMISSION ||
         dealType == DEAL_TYPE_COMMISSION_DAILY ||
         dealType == DEAL_TYPE_COMMISSION_MONTHLY)
      {
         skippedCount++;
         continue;
      }
      
      // Explicit direction handling - skip non-buy/sell deals
      string direction = "";
      if(dealType == DEAL_TYPE_BUY)
         direction = "buy";
      else if(dealType == DEAL_TYPE_SELL)
         direction = "sell";
      else
      {
         skippedCount++;
         continue;
      }
      
      // Determine event type
      string eventType = "";
      if(dealEntry == DEAL_ENTRY_IN)
         eventType = "entry";
      else if(dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_INOUT)
         eventType = "exit";
      else
      {
         skippedCount++;
         continue;
      }
      
      // Build payload with history_sync event type
      string payload = BuildHistorySyncPayload(dealTicket, eventType, direction);
      
      // Progress update every 10 deals
      if(sentCount > 0 && sentCount % 10 == 0)
      {
         Print("Syncing history... ", sentCount, "/", totalDeals - skippedCount, " deals sent");
      }
      
      // Send event (with small delay to avoid rate limiting)
      if(SendEvent(payload, dealTicket))
      {
         MarkDealProcessed(dealTicket);
         sentCount++;
      }
      else
      {
         // Add to queue for later retry
         AddToQueue(payload, dealTicket);
         errorCount++;
      }
      
      // Small delay between events to avoid overwhelming the server
      Sleep(50);
   }
   
   // Mark history as synced
   MarkHistorySynced(sentCount);
   
   Print("=================================================");
   Print("History sync complete!");
   Print("  Deals sent: ", sentCount);
   Print("  Queued for retry: ", errorCount);
   Print("  Skipped (filtered): ", skippedCount);
   Print("=================================================");
   
   LogMessage("History sync complete - sent: " + IntegerToString(sentCount) + 
              ", queued: " + IntegerToString(errorCount) + 
              ", skipped: " + IntegerToString(skippedCount));
}

//+------------------------------------------------------------------+
//| Build JSON Payload for History Sync Event                         |
//| Similar to BuildEventPayload but with history_sync event type     |
//| FIX: Convert deal time to UTC properly                            |
//+------------------------------------------------------------------+
string BuildHistorySyncPayload(ulong dealTicket, string eventType, string direction)
{
   // Get all deal information
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
   
   // Build idempotency key - use history_sync prefix to differentiate
   string idempotencyKey = g_terminalId + "_history_" + IntegerToString(dealTicket) + "_" + eventType;
   
   // FIX: Convert deal time to UTC using the CONFIGURED broker offset
   // dealTime is in broker server time (e.g., UTC+2), convert to UTC
   datetime dealTimeUTC = dealTime - (InpBrokerUTCOffset * 3600);
   string utcTimestamp = FormatTimestampUTC(dealTimeUTC);
   string serverTimestamp = FormatTimestamp(dealTime);
   
   // Store the configured broker offset in seconds
   long brokerOffsetSeconds = InpBrokerUTCOffset * 3600;
   
   // Get symbol digits for price formatting
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   // Get account info for auto-account creation
   long accountLogin = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string server = AccountInfoString(ACCOUNT_SERVER);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   
   // Detect account type from server name
   string accountType = "live";
   string serverLower = server;
   StringToLower(serverLower);
   if(StringFind(serverLower, "demo") >= 0)
      accountType = "demo";
   else if(StringFind(serverLower, "ftmo") >= 0 || 
           StringFind(serverLower, "fundednext") >= 0 ||
           StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   // Build JSON payload - use history_sync as the wrapper event type
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"event_type\":\"history_sync\",";
   json += "\"original_event_type\":\"" + eventType + "\",";  // entry or exit
   
   // Send all three IDs explicitly
   json += "\"position_id\":" + IntegerToString(positionId) + ",";
   json += "\"deal_id\":" + IntegerToString(dealTicket) + ",";
   json += "\"order_id\":" + IntegerToString(orderId) + ",";
   
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(volume, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   
   // SL/TP - only include if set
   if(sl > 0)
      json += "\"sl\":" + DoubleToString(sl, digits) + ",";
   if(tp > 0)
      json += "\"tp\":" + DoubleToString(tp, digits) + ",";
   
   json += "\"commission\":" + DoubleToString(commission, 2) + ",";
   json += "\"swap\":" + DoubleToString(swap, 2) + ",";
   json += "\"profit\":" + DoubleToString(profit, 2) + ",";
   
   // FIX: Use configured broker offset
   json += "\"timestamp\":\"" + utcTimestamp + "\",";
   json += "\"server_time\":\"" + serverTimestamp + "\",";
   json += "\"broker_utc_offset\":" + IntegerToString(InpBrokerUTCOffset) + ",";
   json += "\"timezone_offset_seconds\":" + IntegerToString(brokerOffsetSeconds) + ",";
   
   // Account info for auto-creation
   json += "\"account_info\":{";
   json += "\"login\":" + IntegerToString(accountLogin) + ",";
   json += "\"broker\":\"" + EscapeJsonString(broker) + "\",";
   json += "\"server\":\"" + server + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"account_type\":\"" + accountType + "\"";
   json += "},";
   
   // Raw metadata
   json += "\"raw_payload\":{";
   json += "\"magic\":" + IntegerToString(magic) + ",";
   json += "\"comment\":\"" + EscapeJsonString(comment) + "\",";
   json += "\"is_history_sync\":true";
   json += "}";
   
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Sync Currently Open Positions on Startup                          |
//| Scans all open positions and sends entry events for any that      |
//| don't already exist in the database (idempotency handles dupes)   |
//+------------------------------------------------------------------+
void SyncOpenPositions()
{
   Print("");
   Print("Scanning currently open positions...");
   
   int totalPositions = PositionsTotal();
   int sentCount = 0;
   int skippedCount = 0;
   int errorCount = 0;
   
   if(totalPositions == 0)
   {
      Print("No open positions found.");
      return;
   }
   
   Print("Found ", totalPositions, " open position(s)");
   
   for(int i = 0; i < totalPositions; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      
      if(!PositionSelectByTicket(ticket))
         continue;
      
      // Get position details
      string symbol = PositionGetString(POSITION_SYMBOL);
      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      long magic = PositionGetInteger(POSITION_MAGIC);
      double lots = PositionGetDouble(POSITION_VOLUME);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);
      double swap = PositionGetDouble(POSITION_SWAP);
      double profit = PositionGetDouble(POSITION_PROFIT);
      string comment = PositionGetString(POSITION_COMMENT);
      
      // Apply symbol filter
      if(StringLen(InpSymbolFilter) > 0 && symbol != InpSymbolFilter)
      {
         skippedCount++;
         continue;
      }
      
      // Apply magic filter
      if(InpMagicFilter != 0 && magic != InpMagicFilter)
      {
         skippedCount++;
         continue;
      }
      
      // Determine direction
      string direction = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
      
      // Build and send entry payload (uses history_sync for idempotency)
      string payload = BuildOpenPositionPayload(ticket, symbol, direction, lots, openPrice, sl, tp, openTime, swap, profit, magic, comment);
      
      if(InpVerboseMode)
         Print("Syncing open position: ", ticket, " | ", symbol, " | ", direction, " | ", lots, " lots");
      
      // Send event
      if(SendEvent(payload, ticket))
      {
         sentCount++;
      }
      else
      {
         // Add to queue for later retry
         AddToQueue(payload, ticket);
         errorCount++;
      }
      
      // Small delay between events
      Sleep(50);
   }
   
   Print("=================================================");
   Print("Open position sync complete!");
   Print("  Positions sent: ", sentCount);
   Print("  Queued for retry: ", errorCount);
   Print("  Skipped (filtered): ", skippedCount);
   Print("=================================================");
   
   LogMessage("Open position sync - sent: " + IntegerToString(sentCount) + 
              ", queued: " + IntegerToString(errorCount) + 
              ", skipped: " + IntegerToString(skippedCount));
}

//+------------------------------------------------------------------+
//| Build JSON Payload for Open Position Sync                         |
//| Uses history_sync event type for idempotency handling             |
//+------------------------------------------------------------------+
string BuildOpenPositionPayload(ulong ticket, string symbol, string direction, 
                                 double lots, double price, double sl, double tp,
                                 datetime openTime, double swap, double profit,
                                 long magic, string comment)
{
   // Build idempotency key using position ticket
   string idempotencyKey = g_terminalId + "_openpos_" + IntegerToString(ticket) + "_entry";
   
   // Convert position open time to UTC using the CONFIGURED broker offset
   datetime openTimeUTC = openTime - (InpBrokerUTCOffset * 3600);
   string utcTimestamp = FormatTimestampUTC(openTimeUTC);
   string serverTimestamp = FormatTimestamp(openTime);
   
   // Store the configured broker offset in seconds
   long brokerOffsetSeconds = InpBrokerUTCOffset * 3600;
   
   // Get symbol digits for price formatting
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   // Get account info for auto-account creation
   long accountLogin = AccountInfoInteger(ACCOUNT_LOGIN);
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string server = AccountInfoString(ACCOUNT_SERVER);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   
   // Detect account type from server name
   string accountType = "live";
   string serverLower = server;
   StringToLower(serverLower);
   if(StringFind(serverLower, "demo") >= 0)
      accountType = "demo";
   else if(StringFind(serverLower, "ftmo") >= 0 || 
           StringFind(serverLower, "fundednext") >= 0 ||
           StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   // Build JSON payload - use history_sync as the wrapper event type
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"event_type\":\"history_sync\",";
   json += "\"original_event_type\":\"entry\",";
   
   // Use position ticket as position_id (for open positions, these are the same)
   json += "\"position_id\":" + IntegerToString(ticket) + ",";
   json += "\"deal_id\":0,";  // No deal ID for open position sync
   json += "\"order_id\":0,";  // No order ID for open position sync
   
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(lots, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   
   // SL/TP - only include if set
   if(sl > 0)
      json += "\"sl\":" + DoubleToString(sl, digits) + ",";
   if(tp > 0)
      json += "\"tp\":" + DoubleToString(tp, digits) + ",";
   
   json += "\"commission\":0,";
   json += "\"swap\":" + DoubleToString(swap, 2) + ",";
   json += "\"profit\":" + DoubleToString(profit, 2) + ",";
   
   json += "\"timestamp\":\"" + utcTimestamp + "\",";
   json += "\"server_time\":\"" + serverTimestamp + "\",";
   json += "\"broker_utc_offset\":" + IntegerToString(InpBrokerUTCOffset) + ",";
   json += "\"timezone_offset_seconds\":" + IntegerToString(brokerOffsetSeconds) + ",";
   
   // Capture equity at entry for R% calculation
   json += "\"equity_at_entry\":" + DoubleToString(equity, 2) + ",";
   
   // Account info for auto-creation
   json += "\"account_info\":{";
   json += "\"login\":" + IntegerToString(accountLogin) + ",";
   json += "\"broker\":\"" + EscapeJsonString(broker) + "\",";
   json += "\"server\":\"" + server + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"account_type\":\"" + accountType + "\"";
   json += "},";
   
   // Raw metadata
   json += "\"raw_payload\":{";
   json += "\"magic\":" + IntegerToString(magic) + ",";
   json += "\"comment\":\"" + EscapeJsonString(comment) + "\",";
   json += "\"is_open_position_sync\":true";
   json += "}";
   
   json += "}";
   
   return json;
}
//+------------------------------------------------------------------+
