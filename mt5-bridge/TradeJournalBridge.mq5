//+------------------------------------------------------------------+
//|                                         TradeJournalBridge.mq5   |
//|                        Trade Journal Bridge - Production Grade   |
//|                             Read-Only Trade Event Observer       |
//+------------------------------------------------------------------+
#property copyright "Trade Journal Bridge"
#property link      ""
#property version   "1.00"
#property description "Captures trade lifecycle events and sends to journal backend"
#property description "SAFE: Read-only, no trading operations, prop-firm compliant"

//+------------------------------------------------------------------+
//| Input Parameters                                                  |
//+------------------------------------------------------------------+
input group "=== Connection Settings ==="
input string   InpTerminalID     = "TERMINAL_01";              // Terminal ID (unique identifier)
input string   InpApiKey         = "";                         // API Key (from journal account)
input string   InpServerUrl      = "http://127.0.0.1:8080";    // Relay Server URL

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

//+------------------------------------------------------------------+
//| Global Variables                                                  |
//+------------------------------------------------------------------+
string         g_logFileName     = "TradeJournal.log";
string         g_queueFileName   = "TradeJournalQueue.csv";
int            g_logHandle       = INVALID_HANDLE;
datetime       g_lastQueueCheck  = 0;
bool           g_webRequestOk    = false;

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
      Print("ERROR: API Key is required. Get it from your journal account settings.");
      return INIT_PARAMETERS_INCORRECT;
   }
   
   if(StringLen(InpTerminalID) == 0)
   {
      Print("ERROR: Terminal ID is required.");
      return INIT_PARAMETERS_INCORRECT;
   }
   
   // Initialize logging
   if(InpEnableLogging)
   {
      g_logHandle = FileOpen(g_logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      if(g_logHandle != INVALID_HANDLE)
      {
         FileSeek(g_logHandle, 0, SEEK_END);
         LogMessage("=== Trade Journal Bridge Started ===");
         LogMessage("Terminal ID: " + InpTerminalID);
         LogMessage("Account: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
         LogMessage("Broker: " + AccountInfoString(ACCOUNT_COMPANY));
         LogMessage("Server: " + AccountInfoString(ACCOUNT_SERVER));
      }
   }
   
   // Test WebRequest availability
   TestWebRequest();
   
   // Set timer for queue processing
   EventSetTimer(InpQueueCheckSec);
   
   // Initialize processed deals array
   ArrayResize(g_processedDeals, 0);
   
   Print("Trade Journal Bridge initialized successfully");
   Print("Terminal ID: ", InpTerminalID);
   Print("Server URL: ", InpServerUrl);
   
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
   
   // Determine event type
   ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   
   // Skip balance/credit/commission deals
   if(dealType == DEAL_TYPE_BALANCE || 
      dealType == DEAL_TYPE_CREDIT ||
      dealType == DEAL_TYPE_COMMISSION ||
      dealType == DEAL_TYPE_COMMISSION_DAILY ||
      dealType == DEAL_TYPE_COMMISSION_MONTHLY)
      return;
   
   string eventType = DetermineEventType(dealTicket, dealEntry);
   if(eventType == "")
      return;
   
   // Build and send event
   string payload = BuildEventPayload(dealTicket, eventType);
   
   if(InpVerboseMode)
      Print("Event captured: ", eventType, " | Deal: ", dealTicket, " | Symbol: ", symbol);
   
   LogMessage("Captured " + eventType + " event for deal " + IntegerToString(dealTicket));
   
   // Attempt to send
   if(!SendEvent(payload))
   {
      // Add to queue for retry
      AddToQueue(payload);
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
//| Determine Event Type from Deal Entry                              |
//+------------------------------------------------------------------+
string DetermineEventType(ulong dealTicket, ENUM_DEAL_ENTRY dealEntry)
{
   if(dealEntry == DEAL_ENTRY_IN)
   {
      return "open";
   }
   else if(dealEntry == DEAL_ENTRY_OUT)
   {
      // Check if position still exists (partial close) or fully closed
      long positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      
      // Check if position is still open
      if(PositionSelectByTicket(positionId))
      {
         return "partial_close";
      }
      else
      {
         return "close";
      }
   }
   else if(dealEntry == DEAL_ENTRY_INOUT)
   {
      // Reverse position = close
      return "close";
   }
   
   return "";
}

//+------------------------------------------------------------------+
//| Build JSON Payload for Event                                      |
//+------------------------------------------------------------------+
string BuildEventPayload(ulong dealTicket, string eventType)
{
   // Get all deal information
   string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   long positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
   long orderId = HistoryDealGetInteger(dealTicket, DEAL_ORDER);
   ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
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
   
   // Determine direction
   string direction = (dealType == DEAL_TYPE_BUY) ? "buy" : "sell";
   
   // Build idempotency key
   string idempotencyKey = InpTerminalID + "_" + IntegerToString(dealTicket) + "_" + eventType;
   
   // Format timestamp as ISO 8601
   string timestamp = FormatTimestamp(dealTime);
   
   // Get symbol digits for price formatting
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   // Build JSON payload
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + InpTerminalID + "\",";
   json += "\"event_type\":\"" + eventType + "\",";
   json += "\"ticket\":" + IntegerToString(positionId) + ",";
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
   json += "\"timestamp\":\"" + timestamp + "\",";
   
   // Optional metadata
   json += "\"raw_payload\":{";
   json += "\"deal_id\":" + IntegerToString(dealTicket) + ",";
   json += "\"order_id\":" + IntegerToString(orderId) + ",";
   json += "\"magic\":" + IntegerToString(magic) + ",";
   json += "\"comment\":\"" + EscapeJsonString(comment) + "\",";
   json += "\"account_login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   json += "\"broker\":\"" + EscapeJsonString(AccountInfoString(ACCOUNT_COMPANY)) + "\",";
   json += "\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\",";
   json += "\"local_time\":\"" + FormatTimestamp(TimeLocal()) + "\"";
   json += "}";
   
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Send Event to Relay Server                                        |
//+------------------------------------------------------------------+
bool SendEvent(string payload)
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
   
   // Build headers
   string headers = "Content-Type: application/json\r\n";
   headers += "x-api-key: " + InpApiKey + "\r\n";
   
   // Send request
   string url = InpServerUrl + "/api/trades";
   int timeout = 10000; // 10 seconds
   
   ResetLastError();
   int responseCode = WebRequest("POST", url, headers, timeout, postData, result, resultHeaders);
   
   if(responseCode == -1)
   {
      int error = GetLastError();
      string errorMsg = "WebRequest failed. Error: " + IntegerToString(error);
      
      if(error == 4060)
         errorMsg += " - URL not allowed. Add " + InpServerUrl + " to MT5 Options > Expert Advisors > Allow WebRequest";
      else if(error == 4014)
         errorMsg += " - WebRequest not allowed for this EA";
      else if(error == 5203)
         errorMsg += " - Connection failed. Is relay server running?";
      
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
//+------------------------------------------------------------------+
void AddToQueue(string payload)
{
   int handle = FileOpen(g_queueFileName, FILE_WRITE|FILE_READ|FILE_CSV|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE, '|');
   
   if(handle != INVALID_HANDLE)
   {
      FileSeek(handle, 0, SEEK_END);
      
      // Format: timestamp|retry_count|payload
      string line = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "|0|" + EncodeBase64(payload);
      FileWrite(handle, line);
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
//+------------------------------------------------------------------+
void ProcessQueue()
{
   if(!FileIsExist(g_queueFileName))
      return;
   
   int handle = FileOpen(g_queueFileName, FILE_READ|FILE_CSV|FILE_ANSI|FILE_SHARE_READ, '|');
   
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
      
      if(partCount < 3)
         continue;
      
      string timestamp = parts[0];
      int retryCount = (int)StringToInteger(parts[1]);
      string encodedPayload = parts[2];
      
      // Decode payload
      string payload = DecodeBase64(encodedPayload);
      
      // Check retry limit
      if(retryCount >= InpMaxRetries)
      {
         LogMessage("Max retries exceeded for event, discarding");
         Print("Event discarded after ", InpMaxRetries, " retries");
         continue;
      }
      
      // Attempt to send
      if(SendEvent(payload))
      {
         if(InpVerboseMode)
            Print("Queued event sent successfully");
         LogMessage("Queued event sent successfully after " + IntegerToString(retryCount) + " retries");
      }
      else
      {
         // Re-queue with incremented retry count
         ArrayResize(remainingEntries, remainingCount + 1);
         remainingEntries[remainingCount] = timestamp + "|" + IntegerToString(retryCount + 1) + "|" + encodedPayload;
         remainingCount++;
      }
   }
   
   // Rewrite queue file with remaining entries
   if(remainingCount > 0)
   {
      handle = FileOpen(g_queueFileName, FILE_WRITE|FILE_CSV|FILE_ANSI, '|');
      if(handle != INVALID_HANDLE)
      {
         for(int i = 0; i < remainingCount; i++)
         {
            FileWrite(handle, remainingEntries[i]);
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
//+------------------------------------------------------------------+
void TestWebRequest()
{
   char postData[];
   char result[];
   string resultHeaders;
   
   // Simple test request
   string testPayload = "{\"test\":true}";
   int len = StringToCharArray(testPayload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, len - 1);
   
   string headers = "Content-Type: application/json\r\n";
   string url = InpServerUrl + "/health";
   
   ResetLastError();
   int responseCode = WebRequest("GET", url, headers, 5000, postData, result, resultHeaders);
   
   if(responseCode == -1)
   {
      int error = GetLastError();
      if(error == 4060)
      {
         Print("WARNING: WebRequest not allowed for ", InpServerUrl);
         Print("Go to: Tools > Options > Expert Advisors > Allow WebRequest for listed URL");
         Print("Add: ", InpServerUrl);
         LogMessage("WebRequest not allowed - add URL to MT5 settings");
      }
      else if(error == 5203)
      {
         Print("INFO: Relay server not responding. Make sure it's running on ", InpServerUrl);
         LogMessage("Relay server not responding");
      }
      g_webRequestOk = false;
   }
   else
   {
      Print("WebRequest OK. Relay server responding.");
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
//| Format Timestamp as ISO 8601                                      |
//+------------------------------------------------------------------+
string FormatTimestamp(datetime time)
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
//| Simple Base64 Encoding (for queue persistence)                    |
//+------------------------------------------------------------------+
string EncodeBase64(string str)
{
   uchar src[];
   uchar dst[];
   StringToCharArray(str, src, 0, WHOLE_ARRAY, CP_UTF8);
   int srcLen = ArraySize(src) - 1; // Exclude null terminator
   ArrayResize(src, srcLen);
   
   CryptEncode(CRYPT_BASE64, src, dst, dst);
   
   return CharArrayToString(dst, 0, WHOLE_ARRAY, CP_UTF8);
}

//+------------------------------------------------------------------+
//| Simple Base64 Decoding                                            |
//+------------------------------------------------------------------+
string DecodeBase64(string str)
{
   uchar src[];
   uchar dst[];
   StringToCharArray(str, src, 0, WHOLE_ARRAY, CP_UTF8);
   int srcLen = ArraySize(src) - 1;
   ArrayResize(src, srcLen);
   
   CryptDecode(CRYPT_BASE64, src, dst, dst);
   
   return CharArrayToString(dst, 0, WHOLE_ARRAY, CP_UTF8);
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
