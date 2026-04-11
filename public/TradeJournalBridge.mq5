//+------------------------------------------------------------------+
//|                                         TradeJournalBridge.mq5   |
//|                        Trade Journal Bridge - Production Grade   |
//|                             Read-Only Trade Event Observer       |
//+------------------------------------------------------------------+
#property copyright "Trade Journal Bridge"
#property link      ""
#property version   "2.20"
#property description "Captures trade lifecycle events and sends to journal backend"
#property description "SAFE: Read-only, no trading operations, prop-firm compliant"
#property description "Connects directly to cloud - no relay server needed!"
#property description "v2.20: Gap detection + position reconciliation"

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

input group "=== Reconciliation ==="
input int      InpReconcileIntervalTicks = 10;                 // Reconcile every N timer ticks (~5 min at 30s)
input int      InpSnapshotIntervalTicks  = 20;                 // Position snapshot every N ticks (~10 min)

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
string         g_lastActiveFile  = "";                         // Tracks when EA was last running
int            g_logHandle       = INVALID_HANDLE;
datetime       g_lastQueueCheck  = 0;
bool           g_webRequestOk    = false;
string         g_terminalId      = "";

// Track processed deals to avoid duplicates
ulong          g_processedDeals[];
int            g_maxProcessedDeals = 1000;

// Reconciliation state
ulong          g_knownOpenPositions[];                         // Cached list of open position tickets
int            g_reconcileCounter = 0;                         // Timer counter for periodic reconciliation
int            g_snapshotCounter  = 0;                         // Timer counter for position snapshots

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
   g_lastActiveFile = "TradeJournalLastActive_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".dat";
   
   // Initialize logging
   if(InpEnableLogging)
   {
      g_logHandle = FileOpen(g_logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      if(g_logHandle != INVALID_HANDLE)
      {
         FileSeek(g_logHandle, 0, SEEK_END);
         LogMessage("=== Trade Journal Bridge v2.20 Started ===");
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
   Print("Trade Journal Bridge v2.20 - Direct Cloud Connection");
   Print("=================================================");
   Print("Account: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("Broker: ", AccountInfoString(ACCOUNT_COMPANY));
   Print("Server: ", AccountInfoString(ACCOUNT_SERVER));
   Print("");
   Print("Your account will be created automatically");
   Print("after your first trade!");
   Print("=================================================");
   
   // Always attempt to sync historical trades on startup (server controls what's accepted)
   if(g_webRequestOk && ShouldSyncHistory())
   {
      Print("");
      Print("Syncing historical trades (90 days)...");
      Print("Server will accept trades based on your app settings.");
      SyncHistoricalDeals();
   }
   
   // Always sync currently open positions on startup
   if(g_webRequestOk)
   {
      SyncOpenPositions();
   }
   
   // NEW: Reconcile positions that closed while EA was offline
   if(g_webRequestOk)
   {
      ReconcileClosedPositions();
   }
   
   // NEW: Cache currently open positions for periodic reconciliation
   CacheOpenPositions();
   
   // NEW: Update last active time
   UpdateLastActiveTime();
   
   // NEW: Send initial position snapshot
   if(g_webRequestOk)
   {
      SendPositionSnapshot();
   }
   
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   // Save last active time before shutting down
   UpdateLastActiveTime();
   
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
   
   // Update known positions cache after any trade event
   CacheOpenPositions();
}

//+------------------------------------------------------------------+
//| Timer Handler - Process Retry Queue + Reconciliation              |
//+------------------------------------------------------------------+
void OnTimer()
{
   // Always update last active time
   UpdateLastActiveTime();
   
   // Process retry queue
   ProcessQueue();
   
   // Periodic position reconciliation
   g_reconcileCounter++;
   if(g_reconcileCounter >= InpReconcileIntervalTicks)
   {
      g_reconcileCounter = 0;
      CheckForClosedPositions();
   }
   
   // Periodic position snapshot to backend
   g_snapshotCounter++;
   if(g_snapshotCounter >= InpSnapshotIntervalTicks)
   {
      g_snapshotCounter = 0;
      if(g_webRequestOk)
         SendPositionSnapshot();
   }
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
//| RECONCILIATION: Detect positions closed while EA was offline      |
//| Reads last_active_time, scans deal history for the gap period,    |
//| and sends exit events for any deals that closed while offline.    |
//+------------------------------------------------------------------+
void ReconcileClosedPositions()
{
   datetime lastActive = ReadLastActiveTime();
   if(lastActive == 0)
   {
      Print("No previous active time found - skipping gap reconciliation");
      LogMessage("Gap reconciliation skipped - no previous active time");
      return;
   }
   
   datetime now = TimeCurrent();
   long gapSeconds = (long)(now - lastActive);
   
   // Only reconcile if gap > 60 seconds (avoid reconciling during normal operation)
   if(gapSeconds < 60)
   {
      if(InpVerboseMode)
         Print("Gap too small (", gapSeconds, "s) - skipping reconciliation");
      return;
   }
   
   Print("=================================================");
   Print("Gap Detection: EA was offline for ", gapSeconds / 60, " minutes");
   Print("Scanning for trades closed between:");
   Print("  From: ", TimeToString(lastActive, TIME_DATE|TIME_SECONDS));
   Print("  To:   ", TimeToString(now, TIME_DATE|TIME_SECONDS));
   Print("=================================================");
   
   LogMessage("Gap reconciliation: offline for " + IntegerToString(gapSeconds / 60) + " minutes");
   
   // Request deal history for the gap period (with some buffer)
   datetime fromTime = lastActive - 60;  // 1 minute buffer before
   datetime toTime = now + 60;           // 1 minute buffer after
   
   if(!HistorySelect(fromTime, toTime))
   {
      Print("ERROR: Could not load deal history for gap period");
      LogMessage("Gap reconciliation failed - could not load history");
      return;
   }
   
   int totalDeals = HistoryDealsTotal();
   int exitsSent = 0;
   int skipped = 0;
   
   for(int i = 0; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0)
         continue;
      
      // Only look at exit deals
      ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(dealEntry != DEAL_ENTRY_OUT && dealEntry != DEAL_ENTRY_INOUT)
      {
         skipped++;
         continue;
      }
      
      // Check if deal occurred during the gap
      datetime dealTime = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
      if(dealTime < lastActive || dealTime > now)
      {
         skipped++;
         continue;
      }
      
      // Skip non-trading deals
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL)
      {
         skipped++;
         continue;
      }
      
      // Apply filters
      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      
      if(StringLen(InpSymbolFilter) > 0 && symbol != InpSymbolFilter)
      {
         skipped++;
         continue;
      }
      if(InpMagicFilter != 0 && magic != InpMagicFilter)
      {
         skipped++;
         continue;
      }
      
      // Skip if already processed
      if(IsDealProcessed(dealTicket))
      {
         skipped++;
         continue;
      }
      
      // Determine direction
      string direction = (dealType == DEAL_TYPE_BUY) ? "buy" : "sell";
      
      // Build and send exit event (normal event, idempotency handles duplicates)
      string payload = BuildEventPayload(dealTicket, "exit", direction);
      
      Print("Gap reconciliation: sending exit for deal ", dealTicket, " (", symbol, ") at ", TimeToString(dealTime));
      
      if(SendEvent(payload, dealTicket))
      {
         MarkDealProcessed(dealTicket);
         exitsSent++;
      }
      else
      {
         AddToQueue(payload, dealTicket);
         exitsSent++;  // Still count, will be retried
      }
      
      Sleep(50);  // Small delay between sends
   }
   
   Print("=================================================");
   Print("Gap reconciliation complete!");
   Print("  Exit events sent: ", exitsSent);
   Print("  Skipped: ", skipped);
   Print("=================================================");
   
   LogMessage("Gap reconciliation complete - exits sent: " + IntegerToString(exitsSent));
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Cache currently open positions                    |
//+------------------------------------------------------------------+
void CacheOpenPositions()
{
   int total = PositionsTotal();
   ArrayResize(g_knownOpenPositions, total);
   
   for(int i = 0; i < total; i++)
   {
      g_knownOpenPositions[i] = PositionGetTicket(i);
   }
   
   if(InpVerboseMode)
      Print("Cached ", total, " open positions for reconciliation");
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Check if any known positions have been closed     |
//| Compares cached positions against MT5's current open positions    |
//+------------------------------------------------------------------+
void CheckForClosedPositions()
{
   int cachedCount = ArraySize(g_knownOpenPositions);
   if(cachedCount == 0)
      return;
   
   // Build set of currently open position tickets
   int currentTotal = PositionsTotal();
   ulong currentPositions[];
   ArrayResize(currentPositions, currentTotal);
   for(int i = 0; i < currentTotal; i++)
   {
      currentPositions[i] = PositionGetTicket(i);
   }
   
   // Check each cached position
   int closedFound = 0;
   for(int i = 0; i < cachedCount; i++)
   {
      ulong cachedTicket = g_knownOpenPositions[i];
      if(cachedTicket == 0) continue;
      
      // Check if this position is still open
      bool stillOpen = false;
      for(int j = 0; j < currentTotal; j++)
      {
         if(currentPositions[j] == cachedTicket)
         {
            stillOpen = true;
            break;
         }
      }
      
      if(!stillOpen)
      {
         // Position closed! Find the exit deal and send it
         Print("Position ", cachedTicket, " no longer open - finding exit deal...");
         LogMessage("Periodic reconciliation: position " + IntegerToString(cachedTicket) + " closed");
         
         if(SendExitForClosedPosition(cachedTicket))
            closedFound++;
      }
   }
   
   // Update cache
   CacheOpenPositions();
   
   if(closedFound > 0)
   {
      Print("Periodic reconciliation found ", closedFound, " closed position(s)");
      LogMessage("Periodic reconciliation sent " + IntegerToString(closedFound) + " exit events");
   }
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Find and send exit deal for a closed position     |
//+------------------------------------------------------------------+
bool SendExitForClosedPosition(ulong positionTicket)
{
   // Search for the exit deal in recent history
   if(!HistorySelectByPosition(positionTicket))
   {
      // Fallback: try last 7 days of history
      if(!HistorySelect(TimeCurrent() - 7 * 86400, TimeCurrent() + 3600))
      {
         Print("Could not load history for position ", positionTicket);
         return false;
      }
   }
   
   int totalDeals = HistoryDealsTotal();
   
   // Find the exit deal for this position
   for(int i = totalDeals - 1; i >= 0; i--)  // Reverse order to find most recent first
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;
      
      long dealPosId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      if(dealPosId != (long)positionTicket) continue;
      
      ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(dealEntry != DEAL_ENTRY_OUT && dealEntry != DEAL_ENTRY_INOUT) continue;
      
      // Skip if already processed
      if(IsDealProcessed(dealTicket)) 
      {
         if(InpVerboseMode)
            Print("Exit deal ", dealTicket, " already processed");
         return false;
      }
      
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;
      
      string direction = (dealType == DEAL_TYPE_BUY) ? "buy" : "sell";
      string payload = BuildEventPayload(dealTicket, "exit", direction);
      
      if(SendEvent(payload, dealTicket))
      {
         MarkDealProcessed(dealTicket);
         Print("Sent exit event for position ", positionTicket, " (deal ", dealTicket, ")");
         return true;
      }
      else
      {
         AddToQueue(payload, dealTicket);
         Print("Queued exit event for position ", positionTicket, " (deal ", dealTicket, ")");
         return true;
      }
   }
   
   Print("WARNING: Could not find exit deal for position ", positionTicket);
   LogMessage("WARNING: No exit deal found for position " + IntegerToString(positionTicket));
   return false;
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Send position snapshot to backend                 |
//| Sends list of currently open position IDs so backend can          |
//| close any trades that are no longer open in MT5                   |
//+------------------------------------------------------------------+
void SendPositionSnapshot()
{
   int totalPositions = PositionsTotal();
   
   // Build JSON array of open position tickets
   string positionsJson = "[";
   for(int i = 0; i < totalPositions; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      
      // Apply filters
      if(!PositionSelectByTicket(ticket)) continue;
      string symbol = PositionGetString(POSITION_SYMBOL);
      long magic = PositionGetInteger(POSITION_MAGIC);
      
      if(StringLen(InpSymbolFilter) > 0 && symbol != InpSymbolFilter) continue;
      if(InpMagicFilter != 0 && magic != InpMagicFilter) continue;
      
      if(StringLen(positionsJson) > 1)
         positionsJson += ",";
      positionsJson += IntegerToString(ticket);
   }
   positionsJson += "]";
   
   // Build snapshot payload
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
   else if(StringFind(serverLower, "ftmo") >= 0 || 
           StringFind(serverLower, "fundednext") >= 0 ||
           StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   string json = "{";
   json += "\"idempotency_key\":\"" + g_terminalId + "_snapshot_" + IntegerToString(TimeCurrent()) + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"ea_type\":\"journal\",";
   json += "\"event_type\":\"position_snapshot\",";
   json += "\"position_id\":0,";
   json += "\"deal_id\":0,";
   json += "\"order_id\":0,";
   json += "\"symbol\":\"SNAPSHOT\",";
   json += "\"direction\":\"buy\",";
   json += "\"lot_size\":0,";
   json += "\"price\":0,";
   json += "\"timestamp\":\"" + FormatTimestampUTC(TimeCurrent() - InpBrokerUTCOffset * 3600) + "\",";
   json += "\"open_position_tickets\":" + positionsJson + ",";
   json += "\"account_info\":{";
   json += "\"login\":" + IntegerToString(accountLogin) + ",";
   json += "\"broker\":\"" + EscapeJsonString(broker) + "\",";
   json += "\"server\":\"" + server + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"account_type\":\"" + accountType + "\"";
   json += "}";
   json += "}";
   
   if(SendEvent(json, 0))
   {
      if(InpVerboseMode)
         Print("Position snapshot sent: ", totalPositions, " open positions");
   }
   else
   {
      if(InpVerboseMode)
         Print("Failed to send position snapshot");
   }
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Read last active time from file                   |
//+------------------------------------------------------------------+
datetime ReadLastActiveTime()
{
   if(!FileIsExist(g_lastActiveFile))
      return 0;
   
   int handle = FileOpen(g_lastActiveFile, FILE_READ|FILE_BIN);
   if(handle == INVALID_HANDLE)
      return 0;
   
   datetime lastActive = 0;
   if(FileReadInteger(handle, INT_VALUE) > 0)  // Check file has data
   {
      FileSeek(handle, 0, SEEK_SET);
      long val = FileReadLong(handle);
      lastActive = (datetime)val;
   }
   FileClose(handle);
   
   return lastActive;
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Update last active time to file                   |
//+------------------------------------------------------------------+
void UpdateLastActiveTime()
{
   int handle = FileOpen(g_lastActiveFile, FILE_WRITE|FILE_BIN);
   if(handle != INVALID_HANDLE)
   {
      FileWriteLong(handle, (long)TimeCurrent());
      FileClose(handle);
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
   
   // For exit events, try to get original entry price/time from position history
   double entryPrice = 0;
   datetime entryTime = 0;
   if(eventType == "exit" && positionId > 0)
   {
      // Search for the entry deal of this position to get original entry info
      if(HistorySelectByPosition(positionId))
      {
         int totalDeals = HistoryDealsTotal();
         for(int i = 0; i < totalDeals; i++)
         {
            ulong histDeal = HistoryDealGetTicket(i);
            if(histDeal == 0) continue;
            
            ENUM_DEAL_ENTRY histEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(histDeal, DEAL_ENTRY);
            if(histEntry == DEAL_ENTRY_IN)
            {
               entryPrice = HistoryDealGetDouble(histDeal, DEAL_PRICE);
               entryTime = (datetime)HistoryDealGetInteger(histDeal, DEAL_TIME);
               break;
            }
         }
      }
   }
   
   // Build JSON payload
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"ea_type\":\"journal\",";  // Identify this as the journal EA
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
   
   // For exit events, include original entry price/time if found
   if(eventType == "exit" && entryPrice > 0)
   {
      datetime entryTimeUTC = entryTime - (InpBrokerUTCOffset * 3600);
      json += "\"entry_price\":" + DoubleToString(entryPrice, digits) + ",";
      json += "\"entry_time\":\"" + FormatTimestampUTC(entryTimeUTC) + "\",";
   }
   
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
//+------------------------------------------------------------------+
void AddToQueue(string payload, ulong dealId)
{
   int handle = FileOpen(g_queueFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   
   if(handle != INVALID_HANDLE)
   {
      FileSeek(handle, 0, SEEK_END);
      
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
      
      // Reconstruct payload
      string escapedPayload = parts[3];
      for(int j = 4; j < partCount; j++)
      {
         escapedPayload += "|" + parts[j];
      }
      
      StringReplace(escapedPayload, "{{PIPE}}", "|");
      string payload = escapedPayload;
      
      if(retryCount >= InpMaxRetries)
      {
         LogMessage("Max retries exceeded for deal " + IntegerToString(dealId) + ", discarding");
         Print("Event discarded after ", InpMaxRetries, " retries");
         continue;
      }
      
      if(SendEvent(payload, dealId))
      {
         MarkDealProcessed(dealId);
         if(InpVerboseMode)
            Print("Queued event sent successfully");
         LogMessage("Queued event sent successfully after " + IntegerToString(retryCount) + " retries");
      }
      else
      {
         Sleep(InpRetryDelayMs);
         
         string escapedForRequeue = payload;
         StringReplace(escapedForRequeue, "|", "{{PIPE}}");
         ArrayResize(remainingEntries, remainingCount + 1);
         remainingEntries[remainingCount] = timestamp + "|" + IntegerToString(retryCount + 1) + "|" + 
                                            IntegerToString(dealId) + "|" + escapedForRequeue;
         remainingCount++;
      }
   }
   
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
//| Format Timestamp as ISO 8601 (without Z - for non-UTC times)      |
//+------------------------------------------------------------------+
string FormatTimestamp(datetime time)
{
   MqlDateTime dt;
   TimeToStruct(time, dt);
   
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d",
                       dt.year, dt.mon, dt.day,
                       dt.hour, dt.min, dt.sec);
}

//+------------------------------------------------------------------+
//| Format Timestamp as ISO 8601 UTC (with Z suffix)                  |
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
//| Check if History Sync Should Run (time-based)                     |
//+------------------------------------------------------------------+
bool ShouldSyncHistory()
{
   if(!FileIsExist(g_syncFlagFile))
      return true;
   
   int handle = FileOpen(g_syncFlagFile, FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return true;
   
   datetime lastSyncTime = 0;
   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      if(StringFind(line, "sync_time=") == 0)
      {
         string timeStr = StringSubstr(line, 10);
         lastSyncTime = StringToTime(timeStr);
         break;
      }
   }
   FileClose(handle);
   
   if(lastSyncTime == 0)
      return true;
   
   datetime now = TimeCurrent();
   long hoursSinceSync = (now - lastSyncTime) / 3600;
   
   if(hoursSinceSync >= 24)
   {
      Print("Last sync was ", hoursSinceSync, " hours ago - will re-sync");
      return true;
   }
   
   Print("Last sync was ", hoursSinceSync, " hours ago - skipping (will sync again after 24h)");
   return false;
}

//+------------------------------------------------------------------+
//| Mark History as Synced                                            |
//+------------------------------------------------------------------+
void MarkHistorySynced(int dealCount)
{
   int handle = FileOpen(g_syncFlagFile, FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle != INVALID_HANDLE)
   {
      string info = "sync_time=" + TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "\n";
      info += "deals_synced=" + IntegerToString(dealCount) + "\n";
      info += "sync_days=90\n";
      FileWriteString(handle, info);
      FileClose(handle);
   }
}

//+------------------------------------------------------------------+
//| Sync Historical Deals                                             |
//+------------------------------------------------------------------+
void SyncHistoricalDeals()
{
   const int SYNC_DAYS = 90;
   datetime fromTime = TimeCurrent() - (SYNC_DAYS * 86400);
   datetime toTime = TimeCurrent();
   
   if(!HistorySelect(fromTime, toTime))
   {
      Print("ERROR: Could not load deal history");
      LogMessage("History sync failed - could not load history");
      return;
   }
   
   int totalDeals = HistoryDealsTotal();
   Print("Scanning ", totalDeals, " deals from the last ", SYNC_DAYS, " days...");
   LogMessage("History sync started - scanning " + IntegerToString(totalDeals) + " deals");
   
   int sentCount = 0;
   int skippedCount = 0;
   int errorCount = 0;
   
   for(int i = 0; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0)
         continue;
      
      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      
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
      
      if(dealType == DEAL_TYPE_BALANCE || 
         dealType == DEAL_TYPE_CREDIT ||
         dealType == DEAL_TYPE_COMMISSION ||
         dealType == DEAL_TYPE_COMMISSION_DAILY ||
         dealType == DEAL_TYPE_COMMISSION_MONTHLY)
      {
         skippedCount++;
         continue;
      }
      
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
      
      string payload = BuildHistorySyncPayload(dealTicket, eventType, direction);
      
      if(sentCount > 0 && sentCount % 10 == 0)
      {
         Print("Syncing history... ", sentCount, "/", totalDeals - skippedCount, " deals sent");
      }
      
      if(SendEvent(payload, dealTicket))
      {
         MarkDealProcessed(dealTicket);
         sentCount++;
      }
      else
      {
         AddToQueue(payload, dealTicket);
         errorCount++;
      }
      
      Sleep(50);
   }
   
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
//+------------------------------------------------------------------+
string BuildHistorySyncPayload(ulong dealTicket, string eventType, string direction)
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
   
   string idempotencyKey = g_terminalId + "_history_" + IntegerToString(dealTicket) + "_" + eventType;
   
   datetime dealTimeUTC = dealTime - (InpBrokerUTCOffset * 3600);
   string utcTimestamp = FormatTimestampUTC(dealTimeUTC);
   string serverTimestamp = FormatTimestamp(dealTime);
   
   long brokerOffsetSeconds = InpBrokerUTCOffset * 3600;
   
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
   else if(StringFind(serverLower, "ftmo") >= 0 || 
           StringFind(serverLower, "fundednext") >= 0 ||
           StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"event_type\":\"history_sync\",";
   json += "\"original_event_type\":\"" + eventType + "\",";
   
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
   json += "\"server_time\":\"" + serverTimestamp + "\",";
   json += "\"broker_utc_offset\":" + IntegerToString(InpBrokerUTCOffset) + ",";
   json += "\"timezone_offset_seconds\":" + IntegerToString(brokerOffsetSeconds) + ",";
   
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
   json += "\"is_history_sync\":true";
   json += "}";
   
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Sync Currently Open Positions on Startup                          |
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
      
      string direction = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
      
      string payload = BuildOpenPositionPayload(ticket, symbol, direction, lots, openPrice, sl, tp, openTime, swap, profit, magic, comment);
      
      if(InpVerboseMode)
         Print("Syncing open position: ", ticket, " | ", symbol, " | ", direction, " | ", lots, " lots");
      
      if(SendEvent(payload, ticket))
      {
         sentCount++;
      }
      else
      {
         AddToQueue(payload, ticket);
         errorCount++;
      }
      
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
//+------------------------------------------------------------------+
string BuildOpenPositionPayload(ulong ticket, string symbol, string direction, 
                                 double lots, double price, double sl, double tp,
                                 datetime openTime, double swap, double profit,
                                 long magic, string comment)
{
   string idempotencyKey = g_terminalId + "_openpos_" + IntegerToString(ticket) + "_entry";
   
   datetime openTimeUTC = openTime - (InpBrokerUTCOffset * 3600);
   string utcTimestamp = FormatTimestampUTC(openTimeUTC);
   string serverTimestamp = FormatTimestamp(openTime);
   
   long brokerOffsetSeconds = InpBrokerUTCOffset * 3600;
   
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
   else if(StringFind(serverLower, "ftmo") >= 0 || 
           StringFind(serverLower, "fundednext") >= 0 ||
           StringFind(serverLower, "prop") >= 0)
      accountType = "prop";
   
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"event_type\":\"history_sync\",";
   json += "\"original_event_type\":\"entry\",";
   
   json += "\"position_id\":" + IntegerToString(ticket) + ",";
   json += "\"deal_id\":0,";
   json += "\"order_id\":0,";
   
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(lots, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   
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
   json += "\"is_open_position_sync\":true";
   json += "}";
   
   json += "}";
   
   return json;
}
//+------------------------------------------------------------------+
