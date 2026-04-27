//+------------------------------------------------------------------+
//|                                         TradeJournalBridge.mq5   |
//|                        Trade Journal Bridge - Production Grade   |
//|                             Read-Only Trade Event Observer       |
//+------------------------------------------------------------------+
#property copyright "Trade Journal Bridge"
#property link      ""
#property version   "3.10"
#property description "Captures trade lifecycle events and sends to journal backend"
#property description "SAFE: Read-only, no trading operations, prop-firm compliant"
#property description "Connects directly to cloud - no relay server needed!"
#property description "v3.10: Multi-account safe — same API key can serve multiple broker logins"

//+------------------------------------------------------------------+
//| Input Parameters                                                  |
//+------------------------------------------------------------------+
input group "=== Connection Settings ==="
input string   InpApiKey         = "";                         // API Key (from journal app)

input group "=== Broker Timezone ==="
input int      InpBrokerUTCOffset = -1;                        // Broker UTC Offset (-1 = auto-detect)

input group "=== Retry Settings ==="
input int      InpMaxRetries     = 5;                          // Max retry attempts
input int      InpRetryDelayMs   = 5000;                       // Retry delay (milliseconds)
input int      InpQueueCheckSec  = 30;                         // Queue check interval (seconds)

input group "=== Logging ==="
input bool     InpEnableLogging  = true;                       // Enable file logging
input bool     InpVerboseMode    = false;                      // Verbose console output
input int      InpMaxLogSizeKB   = 1024;                       // Max log file size (KB, 0=unlimited)

input group "=== Filters ==="
input string   InpSymbolFilter   = "";                         // Symbol filter (empty = all)
input long     InpMagicFilter    = 0;                          // Magic number filter (0 = all)

input group "=== Reconciliation ==="
input int      InpReconcileIntervalTicks = 10;                 // Reconcile every N timer ticks (~5 min at 30s)
input int      InpSnapshotIntervalTicks  = 20;                 // Position snapshot every N ticks (~10 min)
input int      InpHeartbeatIntervalTicks = 10;                 // Heartbeat every N ticks (~5 min)

//+------------------------------------------------------------------+
//| Constants                                                         |
//+------------------------------------------------------------------+
const string   EDGE_FUNCTION_URL = "https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1/ingest-events";
const string   EA_VERSION        = "3.10";

//+------------------------------------------------------------------+
//| Global Variables                                                  |
//+------------------------------------------------------------------+
string         g_logFileName     = "TradeJournal.log";
string         g_logFileNameOld  = "TradeJournal.log.1";       // Rotated log
string         g_queueFileName   = "TradeJournalQueue.txt";   // login-scoped in OnInit
string         g_syncFlagFile    = "";
string         g_lastActiveFile  = "";
int            g_logHandle       = INVALID_HANDLE;
bool           g_webRequestOk    = false;
string         g_terminalId      = "";

// Processed deals dedup (sorted for binary search)
ulong          g_processedDeals[];
int            g_maxProcessedDeals = 1000;

// Reconciliation state
ulong          g_knownOpenPositions[];
int            g_reconcileCounter = 0;
int            g_snapshotCounter  = 0;
int            g_heartbeatCounter = 0;

// SL/TP tracking for modification detection
double         g_trackedSL[];
double         g_trackedTP[];
ulong          g_trackedTickets[];

//+------------------------------------------------------------------+
//| HELPER: Get broker UTC offset (auto-detect or manual override)    |
//+------------------------------------------------------------------+
int GetBrokerUTCOffset()
{
   if(InpBrokerUTCOffset >= 0)
      return InpBrokerUTCOffset;
   
   // Auto-detect: TimeCurrent() is broker server time, TimeGMT() is UTC
   long offset = (long)(TimeCurrent() - TimeGMT());
   int offsetHours = (int)MathRound((double)offset / 3600.0);
   return offsetHours;
}

//+------------------------------------------------------------------+
//| HELPER: Check if symbol/magic passes configured filters           |
//+------------------------------------------------------------------+
bool PassesFilter(string symbol, long magic)
{
   if(StringLen(InpSymbolFilter) > 0 && symbol != InpSymbolFilter)
      return false;
   if(InpMagicFilter != 0 && magic != InpMagicFilter)
      return false;
   return true;
}

//+------------------------------------------------------------------+
//| HELPER: Check if deal type is a non-trading type to skip          |
//+------------------------------------------------------------------+
bool IsNonTradingDeal(ENUM_DEAL_TYPE dealType)
{
   return (dealType == DEAL_TYPE_BALANCE || 
           dealType == DEAL_TYPE_CREDIT ||
           dealType == DEAL_TYPE_COMMISSION ||
           dealType == DEAL_TYPE_COMMISSION_DAILY ||
           dealType == DEAL_TYPE_COMMISSION_MONTHLY);
}

//+------------------------------------------------------------------+
//| HELPER: Detect account type from server name                      |
//+------------------------------------------------------------------+
string DetectAccountType()
{
   string server = AccountInfoString(ACCOUNT_SERVER);
   string serverLower = server;
   StringToLower(serverLower);
   
   if(StringFind(serverLower, "demo") >= 0)
      return "demo";
   if(StringFind(serverLower, "ftmo") >= 0 || 
      StringFind(serverLower, "fundednext") >= 0 ||
      StringFind(serverLower, "prop") >= 0)
      return "prop";
   return "live";
}

//+------------------------------------------------------------------+
//| HELPER: Build account_info JSON block                             |
//+------------------------------------------------------------------+
string GetAccountInfoJson()
{
   string json = "\"account_info\":{";
   json += "\"login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   json += "\"broker\":\"" + EscapeJsonString(AccountInfoString(ACCOUNT_COMPANY)) + "\",";
   json += "\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\",";
   json += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   json += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   json += "\"account_type\":\"" + DetectAccountType() + "\"";
   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| HELPER: Get direction string from deal type                       |
//+------------------------------------------------------------------+
string GetDirectionFromDealType(ENUM_DEAL_TYPE dealType)
{
   if(dealType == DEAL_TYPE_BUY)  return "buy";
   if(dealType == DEAL_TYPE_SELL) return "sell";
   return "";
}

//+------------------------------------------------------------------+
//| Expert initialization function                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpApiKey) == 0)
   {
      Print("ERROR: API Key is required. Get it from your journal app's Accounts page.");
      return INIT_PARAMETERS_INCORRECT;
   }
   
   g_terminalId = "MT5_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + 
                  StringSubstr(AccountInfoString(ACCOUNT_SERVER), 0, 10);
   
   g_syncFlagFile = "TradeJournalSynced_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".flag";
   g_lastActiveFile = "TradeJournalLastActive_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".dat";
   
   // Initialize logging (with rotation check)
   if(InpEnableLogging)
   {
      RotateLogIfNeeded();
      g_logHandle = FileOpen(g_logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      if(g_logHandle != INVALID_HANDLE)
      {
         FileSeek(g_logHandle, 0, SEEK_END);
         LogMessage("=== Trade Journal Bridge v" + EA_VERSION + " Started ===");
         LogMessage("Terminal ID: " + g_terminalId);
         LogMessage("Account: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
         LogMessage("Broker: " + AccountInfoString(ACCOUNT_COMPANY));
         LogMessage("Broker UTC Offset: " + IntegerToString(GetBrokerUTCOffset()) + 
                    (InpBrokerUTCOffset < 0 ? " (auto-detected)" : " (manual)"));
      }
   }
   
   TestWebRequest();
   EventSetTimer(InpQueueCheckSec);
   ArrayResize(g_processedDeals, 0);
   
   Print("=================================================");
   Print("Trade Journal Bridge v", EA_VERSION, " - Direct Cloud Connection");
   Print("=================================================");
   Print("Account: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("Broker: ", AccountInfoString(ACCOUNT_COMPANY));
   Print("Broker UTC Offset: ", GetBrokerUTCOffset(), 
         (InpBrokerUTCOffset < 0 ? " (auto-detected)" : " (manual)"));
   Print("");
   Print("Your account will be created automatically");
   Print("after your first trade!");
   Print("=================================================");
   
   if(g_webRequestOk && ShouldSyncHistory())
   {
      Print("");
      Print("Syncing historical trades (90 days)...");
      SyncHistoricalDeals();
   }
   
   if(g_webRequestOk)
      SyncOpenPositions();
   
   if(g_webRequestOk)
      ReconcileClosedPositions();
   
   CacheOpenPositions();
   CacheSLTP();
   UpdateLastActiveTime();
   
   if(g_webRequestOk)
      SendPositionSnapshot();
   
   // Send initial heartbeat
   if(g_webRequestOk)
      SendHeartbeat();
   
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   UpdateLastActiveTime();
   
   // Graceful shutdown: attempt to flush pending queue
   if(g_webRequestOk)
   {
      ProcessQueue();
   }
   
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
   // Handle SL/TP modification events
   if(trans.type == TRADE_TRANSACTION_POSITION)
   {
      HandlePositionModification(trans);
      return;
   }
   
   // Only process DEAL transactions (actual trade executions)
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   
   ulong dealTicket = trans.deal;
   if(dealTicket == 0)
      return;
   
   if(!HistoryDealSelect(dealTicket))
   {
      HistorySelect(TimeCurrent() - 86400, TimeCurrent() + 3600);
      if(!HistoryDealSelect(dealTicket))
      {
         if(InpVerboseMode)
            Print("Could not select deal: ", dealTicket);
         return;
      }
   }
   
   if(IsDealProcessed(dealTicket))
   {
      if(InpVerboseMode)
         Print("Deal already processed: ", dealTicket);
      return;
   }
   
   string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
   
   if(!PassesFilter(symbol, magic))
      return;
   
   ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   
   if(IsNonTradingDeal(dealType))
      return;
   
   string direction = GetDirectionFromDealType(dealType);
   if(direction == "")
   {
      if(InpVerboseMode)
         Print("Skipping non-buy/sell deal type: ", dealType);
      return;
   }
   
   string eventType = DetermineEventType(dealEntry);
   if(eventType == "")
      return;
   
   string payload = BuildPayload(dealTicket, eventType, direction, "live_event");
   
   if(InpVerboseMode)
      Print("Event captured: ", eventType, " | Deal: ", dealTicket, " | Symbol: ", symbol);
   
   LogMessage("Captured " + eventType + " event for deal " + IntegerToString(dealTicket));
   
   if(!SendEvent(payload, dealTicket))
   {
      AddToQueue(payload, dealTicket);
      LogMessage("Event queued for retry: " + IntegerToString(dealTicket));
   }
   else
   {
      MarkDealProcessed(dealTicket);
      LogMessage("Event sent successfully: " + IntegerToString(dealTicket));
   }
   
   CacheOpenPositions();
   CacheSLTP();
}

//+------------------------------------------------------------------+
//| Handle SL/TP modification on an open position                     |
//+------------------------------------------------------------------+
void HandlePositionModification(const MqlTradeTransaction& trans)
{
   ulong posTicket = trans.position;
   if(posTicket == 0) return;
   
   if(!PositionSelectByTicket(posTicket))
      return;
   
   string symbol = PositionGetString(POSITION_SYMBOL);
   long magic = PositionGetInteger(POSITION_MAGIC);
   
   if(!PassesFilter(symbol, magic))
      return;
   
   double currentSL = PositionGetDouble(POSITION_SL);
   double currentTP = PositionGetDouble(POSITION_TP);
   
   // Check if SL or TP actually changed from our cached values
   double cachedSL = 0, cachedTP = 0;
   int idx = FindTrackedPosition(posTicket);
   if(idx >= 0)
   {
      cachedSL = g_trackedSL[idx];
      cachedTP = g_trackedTP[idx];
   }
   
   // Compare with tolerance
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   
   bool slChanged = MathAbs(currentSL - cachedSL) > point * 0.5;
   bool tpChanged = MathAbs(currentTP - cachedTP) > point * 0.5;
   
   if(!slChanged && !tpChanged)
      return;
   
   if(InpVerboseMode)
      Print("SL/TP modified on position ", posTicket, ": SL ", cachedSL, " -> ", currentSL, ", TP ", cachedTP, " -> ", currentTP);
   
   LogMessage("SL/TP modified: position " + IntegerToString(posTicket) + 
              " SL=" + DoubleToString(currentSL, digits) + " TP=" + DoubleToString(currentTP, digits));
   
   // Build modify event payload
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   string direction = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
   double lots = PositionGetDouble(POSITION_VOLUME);
   double price = PositionGetDouble(POSITION_PRICE_OPEN);
   datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);
   
   int brokerOffset = GetBrokerUTCOffset();
   datetime openTimeUTC = openTime - (brokerOffset * 3600);
   datetime nowUTC = TimeCurrent() - (brokerOffset * 3600);
   
   if(digits <= 0) digits = 5;
   
   string idempotencyKey = g_terminalId + "_modify_" + IntegerToString(posTicket) + "_" + IntegerToString(TimeCurrent());
   
   // Capture spread at modification time
   long spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"ea_type\":\"journal\",";
   json += "\"event_type\":\"modify\",";
   json += "\"position_id\":" + IntegerToString(posTicket) + ",";
   json += "\"deal_id\":0,";
   json += "\"order_id\":0,";
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(lots, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   if(currentSL > 0)
      json += "\"sl\":" + DoubleToString(currentSL, digits) + ",";
   if(currentTP > 0)
      json += "\"tp\":" + DoubleToString(currentTP, digits) + ",";
   json += "\"commission\":0,";
   json += "\"swap\":0,";
   json += "\"profit\":0,";
   json += "\"timestamp\":\"" + FormatTimestampUTC(nowUTC) + "\",";
   json += "\"server_time\":\"" + FormatTimestamp(TimeCurrent()) + "\",";
   json += "\"timezone_offset_seconds\":" + IntegerToString(brokerOffset * 3600) + ",";
   json += "\"spread\":" + IntegerToString(spread) + ",";
   json += GetAccountInfoJson() + ",";
   json += "\"raw_payload\":{";
   json += "\"previous_sl\":" + DoubleToString(cachedSL, digits) + ",";
   json += "\"previous_tp\":" + DoubleToString(cachedTP, digits);
   json += "}";
   json += "}";
   
   if(!SendEvent(json, 0))
      AddToQueue(json, 0);
   
   // Update cache
   CacheSLTP();
}

//+------------------------------------------------------------------+
//| Find tracked position index                                       |
//+------------------------------------------------------------------+
int FindTrackedPosition(ulong ticket)
{
   int size = ArraySize(g_trackedTickets);
   for(int i = 0; i < size; i++)
   {
      if(g_trackedTickets[i] == ticket)
         return i;
   }
   return -1;
}

//+------------------------------------------------------------------+
//| Cache SL/TP values for all open positions                         |
//+------------------------------------------------------------------+
void CacheSLTP()
{
   int total = PositionsTotal();
   ArrayResize(g_trackedTickets, total);
   ArrayResize(g_trackedSL, total);
   ArrayResize(g_trackedTP, total);
   
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      g_trackedTickets[i] = ticket;
      if(PositionSelectByTicket(ticket))
      {
         g_trackedSL[i] = PositionGetDouble(POSITION_SL);
         g_trackedTP[i] = PositionGetDouble(POSITION_TP);
      }
      else
      {
         g_trackedSL[i] = 0;
         g_trackedTP[i] = 0;
      }
   }
}

//+------------------------------------------------------------------+
//| Timer Handler - Queue + Reconciliation + Heartbeat                |
//+------------------------------------------------------------------+
void OnTimer()
{
   UpdateLastActiveTime();
   ProcessQueue();
   
   // Periodic position reconciliation
   g_reconcileCounter++;
   if(g_reconcileCounter >= InpReconcileIntervalTicks)
   {
      g_reconcileCounter = 0;
      CheckForClosedPositions();
   }
   
   // Periodic position snapshot
   g_snapshotCounter++;
   if(g_snapshotCounter >= InpSnapshotIntervalTicks)
   {
      g_snapshotCounter = 0;
      if(g_webRequestOk)
         SendPositionSnapshot();
   }
   
   // Periodic heartbeat
   g_heartbeatCounter++;
   if(g_heartbeatCounter >= InpHeartbeatIntervalTicks)
   {
      g_heartbeatCounter = 0;
      if(g_webRequestOk)
         SendHeartbeat();
   }
   
   // Log rotation check
   if(InpEnableLogging && InpMaxLogSizeKB > 0)
   {
      RotateLogIfNeeded();
   }
}

// NOTE: OnTick() removed — timer is sufficient for queue processing

//+------------------------------------------------------------------+
//| RECONCILIATION: Detect positions closed while EA was offline      |
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
   
   datetime fromTime = lastActive - 60;
   datetime toTime = now + 60;
   
   if(!HistorySelect(fromTime, toTime))
   {
      Print("ERROR: Could not load deal history for gap period");
      return;
   }
   
   int totalDeals = HistoryDealsTotal();
   int exitsSent = 0;
   
   for(int i = 0; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;
      
      ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(dealEntry != DEAL_ENTRY_OUT && dealEntry != DEAL_ENTRY_INOUT)
         continue;
      
      datetime dealTime = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
      if(dealTime < lastActive || dealTime > now)
         continue;
      
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      if(IsNonTradingDeal(dealType)) continue;
      
      string direction = GetDirectionFromDealType(dealType);
      if(direction == "") continue;
      
      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      if(!PassesFilter(symbol, magic)) continue;
      if(IsDealProcessed(dealTicket)) continue;
      
      string payload = BuildPayload(dealTicket, "exit", direction, "gap_reconciliation");
      
      Print("Gap reconciliation: sending exit for deal ", dealTicket, " (", symbol, ") at ", TimeToString(dealTime));
      
      if(SendEvent(payload, dealTicket))
         MarkDealProcessed(dealTicket);
      else
         AddToQueue(payload, dealTicket);
      
      exitsSent++;
      Sleep(50);
   }
   
   Print("Gap reconciliation complete! Exit events sent: ", exitsSent);
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
      g_knownOpenPositions[i] = PositionGetTicket(i);
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Check if any known positions have been closed     |
//+------------------------------------------------------------------+
void CheckForClosedPositions()
{
   int cachedCount = ArraySize(g_knownOpenPositions);
   if(cachedCount == 0) return;
   
   int currentTotal = PositionsTotal();
   ulong currentPositions[];
   ArrayResize(currentPositions, currentTotal);
   for(int i = 0; i < currentTotal; i++)
      currentPositions[i] = PositionGetTicket(i);
   
   int closedFound = 0;
   for(int i = 0; i < cachedCount; i++)
   {
      ulong cachedTicket = g_knownOpenPositions[i];
      if(cachedTicket == 0) continue;
      
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
         Print("Position ", cachedTicket, " no longer open - finding exit deal...");
         LogMessage("Periodic reconciliation: position " + IntegerToString(cachedTicket) + " closed");
         if(SendExitForClosedPosition(cachedTicket))
            closedFound++;
      }
   }
   
   CacheOpenPositions();
   CacheSLTP();
   
   if(closedFound > 0)
      Print("Periodic reconciliation found ", closedFound, " closed position(s)");
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Find and send exit deal for a closed position     |
//+------------------------------------------------------------------+
bool SendExitForClosedPosition(ulong positionTicket)
{
   if(!HistorySelectByPosition(positionTicket))
   {
      if(!HistorySelect(TimeCurrent() - 7 * 86400, TimeCurrent() + 3600))
      {
         Print("Could not load history for position ", positionTicket);
         return false;
      }
   }
   
   int totalDeals = HistoryDealsTotal();
   
   for(int i = totalDeals - 1; i >= 0; i--)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;
      
      long dealPosId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      if(dealPosId != (long)positionTicket) continue;
      
      ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(dealEntry != DEAL_ENTRY_OUT && dealEntry != DEAL_ENTRY_INOUT) continue;
      
      if(IsDealProcessed(dealTicket))
      {
         if(InpVerboseMode) Print("Exit deal ", dealTicket, " already processed");
         return false;
      }
      
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      string direction = GetDirectionFromDealType(dealType);
      if(direction == "") continue;
      
      string payload = BuildPayload(dealTicket, "exit", direction, "periodic_reconciliation");
      
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
   return false;
}

//+------------------------------------------------------------------+
//| RECONCILIATION: Send position snapshot to backend                 |
//+------------------------------------------------------------------+
void SendPositionSnapshot()
{
   int totalPositions = PositionsTotal();
   
   string positionsJson = "[";
   for(int i = 0; i < totalPositions; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      
      if(!PositionSelectByTicket(ticket)) continue;
      string symbol = PositionGetString(POSITION_SYMBOL);
      long magic = PositionGetInteger(POSITION_MAGIC);
      if(!PassesFilter(symbol, magic)) continue;
      
      if(StringLen(positionsJson) > 1) positionsJson += ",";
      positionsJson += IntegerToString(ticket);
   }
   positionsJson += "]";
   
   int brokerOffset = GetBrokerUTCOffset();
   
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
   json += "\"timestamp\":\"" + FormatTimestampUTC(TimeCurrent() - brokerOffset * 3600) + "\",";
   json += "\"open_position_tickets\":" + positionsJson + ",";
   json += GetAccountInfoJson();
   json += "}";
   
   if(SendEvent(json, 0))
   {
      if(InpVerboseMode)
         Print("Position snapshot sent: ", totalPositions, " open positions");
   }
}

//+------------------------------------------------------------------+
//| HEARTBEAT: Send periodic health check to backend                  |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   int brokerOffset = GetBrokerUTCOffset();
   int openPositions = PositionsTotal();
   long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);
   double marginFree = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double marginLevel = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   
   string json = "{";
   json += "\"idempotency_key\":\"" + g_terminalId + "_heartbeat_" + IntegerToString(TimeCurrent()) + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"ea_type\":\"journal\",";
   json += "\"event_type\":\"heartbeat\",";
   json += "\"position_id\":0,";
   json += "\"deal_id\":0,";
   json += "\"order_id\":0,";
   json += "\"symbol\":\"HEARTBEAT\",";
   json += "\"direction\":\"buy\",";
   json += "\"lot_size\":0,";
   json += "\"price\":0,";
   json += "\"timestamp\":\"" + FormatTimestampUTC(TimeCurrent() - brokerOffset * 3600) + "\",";
   json += "\"ea_version\":\"" + EA_VERSION + "\",";
   json += "\"open_positions_count\":" + IntegerToString(openPositions) + ",";
   json += "\"leverage\":" + IntegerToString(leverage) + ",";
   json += "\"margin_free\":" + DoubleToString(marginFree, 2) + ",";
   json += "\"margin_level\":" + DoubleToString(marginLevel, 2) + ",";
   json += "\"broker_utc_offset\":" + IntegerToString(brokerOffset) + ",";
   json += GetAccountInfoJson();
   json += "}";
   
   SendEvent(json, 0);
   
   if(InpVerboseMode)
      Print("Heartbeat sent - equity: ", AccountInfoDouble(ACCOUNT_EQUITY), 
            ", positions: ", openPositions, ", leverage: 1:", leverage);
}

//+------------------------------------------------------------------+
//| Read last active time from file                                   |
//+------------------------------------------------------------------+
datetime ReadLastActiveTime()
{
   if(!FileIsExist(g_lastActiveFile)) return 0;
   
   int handle = FileOpen(g_lastActiveFile, FILE_READ|FILE_BIN);
   if(handle == INVALID_HANDLE) return 0;
   
   datetime lastActive = 0;
   if(FileReadInteger(handle, INT_VALUE) > 0)
   {
      FileSeek(handle, 0, SEEK_SET);
      long val = FileReadLong(handle);
      lastActive = (datetime)val;
   }
   FileClose(handle);
   return lastActive;
}

//+------------------------------------------------------------------+
//| Update last active time to file                                   |
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
//| Determine Event Type from Deal Entry                              |
//+------------------------------------------------------------------+
string DetermineEventType(ENUM_DEAL_ENTRY dealEntry)
{
   if(dealEntry == DEAL_ENTRY_IN) return "entry";
   if(dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_INOUT) return "exit";
   return "";
}

//+------------------------------------------------------------------+
//| UNIFIED: Build JSON Payload for any deal-based event              |
//| Replaces BuildEventPayload, BuildHistorySyncPayload,              |
//| BuildOpenPositionPayload — single source of truth                 |
//+------------------------------------------------------------------+
string BuildPayload(ulong dealTicket, string eventType, string direction, string source = "live_event")
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
   
   // Dynamic broker offset
   int brokerOffset = GetBrokerUTCOffset();
   datetime dealTimeUTC = dealTime - (brokerOffset * 3600);
   string utcTimestamp = FormatTimestampUTC(dealTimeUTC);
   string serverTimestamp = FormatTimestamp(dealTime);
   long brokerOffsetSeconds = brokerOffset * 3600;
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   // Capture spread at event time
   long spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   
   // Determine idempotency key prefix based on source
   string idempotencyPrefix = g_terminalId + "_";
   if(source == "history_sync")
      idempotencyPrefix += "history_";
   else if(source == "open_position_sync")
      idempotencyPrefix += "openpos_";
   
   string idempotencyKey = idempotencyPrefix + IntegerToString(dealTicket) + "_" + eventType;
   
   // Determine wrapper event type for backend
   bool isHistorySync = (source == "history_sync" || source == "open_position_sync");
   string wireEventType = isHistorySync ? "history_sync" : eventType;
   
   // For exit events, look up original entry price/time
   double entryPrice = 0;
   datetime entryTime = 0;
   if(eventType == "exit" && positionId > 0)
   {
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
   
   // Build JSON
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"ea_type\":\"journal\",";
   json += "\"event_type\":\"" + wireEventType + "\",";
   
   if(isHistorySync)
      json += "\"original_event_type\":\"" + eventType + "\",";
   
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
   
   json += "\"timestamp\":\"" + utcTimestamp + "\",";
   json += "\"server_time\":\"" + serverTimestamp + "\",";
   json += "\"broker_utc_offset\":" + IntegerToString(brokerOffset) + ",";
   json += "\"timezone_offset_seconds\":" + IntegerToString(brokerOffsetSeconds) + ",";
   json += "\"spread\":" + IntegerToString(spread) + ",";
   
   // For entries: capture equity. For history/open sync: omit (inaccurate)
   if(eventType == "entry" && !isHistorySync)
      json += "\"equity_at_entry\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   
   // For exits: include original entry price/time
   if(eventType == "exit" && entryPrice > 0)
   {
      datetime entryTimeUTC = entryTime - (brokerOffset * 3600);
      json += "\"entry_price\":" + DoubleToString(entryPrice, digits) + ",";
      json += "\"entry_time\":\"" + FormatTimestampUTC(entryTimeUTC) + "\",";
   }
   
   // Account info
   json += GetAccountInfoJson() + ",";
   
   // Raw metadata
   json += "\"raw_payload\":{";
   json += "\"magic\":" + IntegerToString(magic) + ",";
   json += "\"comment\":\"" + EscapeJsonString(comment) + "\",";
   json += "\"source\":\"" + source + "\",";
   json += "\"local_time\":\"" + FormatTimestamp(TimeLocal()) + "\"";
   json += "}";
   
   json += "}";
   
   return json;
}

//+------------------------------------------------------------------+
//| Build Open Position Payload using history deal lookup              |
//| FIX: Looks up real deal_id and commission from entry deal          |
//| FIX: Does NOT send equity_at_entry (inaccurate for synced trades) |
//+------------------------------------------------------------------+
string BuildOpenPositionPayload(ulong ticket, string symbol, string direction, 
                                 double lots, double price, double sl, double tp,
                                 datetime openTime, double swap, double profit,
                                 long magic, string comment)
{
   // Try to look up the real entry deal for this position
   ulong realDealId = 0;
   long realOrderId = 0;
   double realCommission = 0;
   
   if(HistorySelectByPosition(ticket))
   {
      int totalDeals = HistoryDealsTotal();
      for(int i = 0; i < totalDeals; i++)
      {
         ulong histDeal = HistoryDealGetTicket(i);
         if(histDeal == 0) continue;
         ENUM_DEAL_ENTRY histEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(histDeal, DEAL_ENTRY);
         if(histEntry == DEAL_ENTRY_IN)
         {
            realDealId = histDeal;
            realOrderId = HistoryDealGetInteger(histDeal, DEAL_ORDER);
            realCommission = HistoryDealGetDouble(histDeal, DEAL_COMMISSION);
            break;
         }
      }
   }
   
   int brokerOffset = GetBrokerUTCOffset();
   datetime openTimeUTC = openTime - (brokerOffset * 3600);
   long brokerOffsetSeconds = brokerOffset * 3600;
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5;
   
   // Capture spread
   long spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   
   string idempotencyKey = g_terminalId + "_openpos_" + IntegerToString(ticket) + "_entry";
   
   string json = "{";
   json += "\"idempotency_key\":\"" + idempotencyKey + "\",";
   json += "\"terminal_id\":\"" + g_terminalId + "\",";
   json += "\"ea_type\":\"journal\",";
   json += "\"event_type\":\"history_sync\",";
   json += "\"original_event_type\":\"entry\",";
   
   json += "\"position_id\":" + IntegerToString(ticket) + ",";
   json += "\"deal_id\":" + IntegerToString(realDealId) + ",";
   json += "\"order_id\":" + IntegerToString(realOrderId) + ",";
   
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"direction\":\"" + direction + "\",";
   json += "\"lot_size\":" + DoubleToString(lots, 2) + ",";
   json += "\"price\":" + DoubleToString(price, digits) + ",";
   
   if(sl > 0) json += "\"sl\":" + DoubleToString(sl, digits) + ",";
   if(tp > 0) json += "\"tp\":" + DoubleToString(tp, digits) + ",";
   
   json += "\"commission\":" + DoubleToString(realCommission, 2) + ",";
   json += "\"swap\":" + DoubleToString(swap, 2) + ",";
   json += "\"profit\":" + DoubleToString(profit, 2) + ",";
   
   json += "\"timestamp\":\"" + FormatTimestampUTC(openTimeUTC) + "\",";
   json += "\"server_time\":\"" + FormatTimestamp(openTime) + "\",";
   json += "\"broker_utc_offset\":" + IntegerToString(brokerOffset) + ",";
   json += "\"timezone_offset_seconds\":" + IntegerToString(brokerOffsetSeconds) + ",";
   json += "\"spread\":" + IntegerToString(spread) + ",";
   
   // NOTE: equity_at_entry intentionally OMITTED — current equity != entry equity for synced positions
   
   json += GetAccountInfoJson() + ",";
   
   json += "\"raw_payload\":{";
   json += "\"magic\":" + IntegerToString(magic) + ",";
   json += "\"comment\":\"" + EscapeJsonString(comment) + "\",";
   json += "\"source\":\"open_position_sync\"";
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
   
   string responseBody = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   
   if(responseCode >= 200 && responseCode < 300)
   {
      if(InpVerboseMode)
         Print("Event sent successfully. Response: ", responseBody);
      return true;
   }
   else if(responseCode == 409)
   {
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
//| Add Event to Persistent Queue (with integrity line marker)        |
//+------------------------------------------------------------------+
void AddToQueue(string payload, ulong dealId)
{
   int handle = FileOpen(g_queueFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   
   if(handle != INVALID_HANDLE)
   {
      FileSeek(handle, 0, SEEK_END);
      
      string escapedPayload = payload;
      StringReplace(escapedPayload, "|", "{{PIPE}}");
      
      // Add checksum for integrity validation
      int checksum = StringLen(escapedPayload);
      
      string line = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + "|0|" + 
                    IntegerToString(dealId) + "|" + IntegerToString(checksum) + "|" + escapedPayload + "\n";
      FileWriteString(handle, line);
      FileClose(handle);
   }
   else
   {
      Print("ERROR: Could not open queue file for writing");
   }
}

//+------------------------------------------------------------------+
//| Process Retry Queue (with integrity check)                        |
//+------------------------------------------------------------------+
void ProcessQueue()
{
   if(!FileIsExist(g_queueFileName))
      return;
   
   int handle = FileOpen(g_queueFileName, FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
   if(handle == INVALID_HANDLE) return;
   
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
   
   string remainingEntries[];
   int remainingCount = 0;
   
   for(int i = 0; i < count; i++)
   {
      string parts[];
      int partCount = StringSplit(entries[i], '|', parts);
      
      // Support both old format (4 parts) and new format (5 parts with checksum)
      int payloadStartIdx = 3;
      int checksumExpected = -1;
      
      if(partCount >= 5)
      {
         // New format: timestamp|retries|dealId|checksum|payload
         checksumExpected = (int)StringToInteger(parts[3]);
         payloadStartIdx = 4;
      }
      else if(partCount < 4)
      {
         // Corrupt line, skip
         LogMessage("Skipping corrupt queue line: " + entries[i]);
         continue;
      }
      
      string timestamp = parts[0];
      int retryCount = (int)StringToInteger(parts[1]);
      ulong dealId = (ulong)StringToInteger(parts[2]);
      
      // Reconstruct payload
      string escapedPayload = parts[payloadStartIdx];
      for(int j = payloadStartIdx + 1; j < partCount; j++)
         escapedPayload += "|" + parts[j];
      
      // Integrity check
      if(checksumExpected >= 0 && StringLen(escapedPayload) != checksumExpected)
      {
         LogMessage("Queue integrity check failed for deal " + IntegerToString(dealId) + ", discarding");
         continue;
      }
      
      StringReplace(escapedPayload, "{{PIPE}}", "|");
      string payload = escapedPayload;
      
      if(retryCount >= InpMaxRetries)
      {
         LogMessage("Max retries exceeded for deal " + IntegerToString(dealId) + ", discarding");
         continue;
      }
      
      if(SendEvent(payload, dealId))
      {
         MarkDealProcessed(dealId);
         if(InpVerboseMode)
            Print("Queued event sent successfully");
      }
      else
      {
         Sleep(InpRetryDelayMs);
         
         string escapedForRequeue = payload;
         StringReplace(escapedForRequeue, "|", "{{PIPE}}");
         int newChecksum = StringLen(escapedForRequeue);
         ArrayResize(remainingEntries, remainingCount + 1);
         remainingEntries[remainingCount] = timestamp + "|" + IntegerToString(retryCount + 1) + "|" + 
                                            IntegerToString(dealId) + "|" + IntegerToString(newChecksum) + "|" + escapedForRequeue;
         remainingCount++;
      }
   }
   
   if(remainingCount > 0)
   {
      handle = FileOpen(g_queueFileName, FILE_WRITE|FILE_TXT|FILE_ANSI);
      if(handle != INVALID_HANDLE)
      {
         for(int i = 0; i < remainingCount; i++)
            FileWriteString(handle, remainingEntries[i] + "\n");
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
      }
      else if(error == 5203)
      {
         Print("INFO: Could not connect to server. Check internet connection.");
      }
      g_webRequestOk = false;
   }
   else
   {
      Print("Connection OK! Ready to send trade events.");
      g_webRequestOk = true;
   }
}

//+------------------------------------------------------------------+
//| Check if Deal Already Processed (binary search on sorted array)   |
//+------------------------------------------------------------------+
bool IsDealProcessed(ulong dealTicket)
{
   int size = ArraySize(g_processedDeals);
   if(size == 0) return false;
   
   // Binary search
   int lo = 0, hi = size - 1;
   while(lo <= hi)
   {
      int mid = (lo + hi) / 2;
      if(g_processedDeals[mid] == dealTicket)
         return true;
      else if(g_processedDeals[mid] < dealTicket)
         lo = mid + 1;
      else
         hi = mid - 1;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Mark Deal as Processed (insert sorted for binary search)          |
//+------------------------------------------------------------------+
void MarkDealProcessed(ulong dealTicket)
{
   int size = ArraySize(g_processedDeals);
   
   // Trim if too large (remove oldest half)
   if(size >= g_maxProcessedDeals)
   {
      int removeCount = g_maxProcessedDeals / 2;
      for(int i = 0; i < size - removeCount; i++)
         g_processedDeals[i] = g_processedDeals[i + removeCount];
      ArrayResize(g_processedDeals, size - removeCount);
      size = ArraySize(g_processedDeals);
   }
   
   // Find insertion point (sorted order)
   int insertAt = size;
   for(int i = 0; i < size; i++)
   {
      if(g_processedDeals[i] >= dealTicket)
      {
         if(g_processedDeals[i] == dealTicket) return; // Already exists
         insertAt = i;
         break;
      }
   }
   
   // Shift and insert
   ArrayResize(g_processedDeals, size + 1);
   for(int i = size; i > insertAt; i--)
      g_processedDeals[i] = g_processedDeals[i - 1];
   g_processedDeals[insertAt] = dealTicket;
}

//+------------------------------------------------------------------+
//| Log Rotation: rotate if file exceeds max size                     |
//+------------------------------------------------------------------+
void RotateLogIfNeeded()
{
   if(InpMaxLogSizeKB <= 0) return;
   if(!FileIsExist(g_logFileName)) return;
   
   // Check file size
   int handle = FileOpen(g_logFileName, FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
   if(handle == INVALID_HANDLE) return;
   
   long fileSize = FileSize(handle);
   FileClose(handle);
   
   if(fileSize > (long)InpMaxLogSizeKB * 1024)
   {
      // Close current log if open
      if(g_logHandle != INVALID_HANDLE)
      {
         FileClose(g_logHandle);
         g_logHandle = INVALID_HANDLE;
      }
      
      // Delete old rotated log if exists
      if(FileIsExist(g_logFileNameOld))
         FileDelete(g_logFileNameOld);
      
      // Rename current to .1
      // MQL5 doesn't have rename, so copy and delete
      int src = FileOpen(g_logFileName, FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      int dst = FileOpen(g_logFileNameOld, FILE_WRITE|FILE_TXT|FILE_ANSI);
      if(src != INVALID_HANDLE && dst != INVALID_HANDLE)
      {
         while(!FileIsEnding(src))
         {
            string line = FileReadString(src);
            FileWriteString(dst, line + "\n");
         }
      }
      if(src != INVALID_HANDLE) FileClose(src);
      if(dst != INVALID_HANDLE) FileClose(dst);
      FileDelete(g_logFileName);
      
      // Reopen fresh log
      g_logHandle = FileOpen(g_logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
      if(g_logHandle != INVALID_HANDLE)
      {
         LogMessage("=== Log rotated (previous log saved as " + g_logFileNameOld + ") ===");
      }
   }
}

//+------------------------------------------------------------------+
//| Format Timestamp as ISO 8601 (without Z)                          |
//+------------------------------------------------------------------+
string FormatTimestamp(datetime time)
{
   MqlDateTime dt;
   TimeToStruct(time, dt);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d",
                       dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);
}

//+------------------------------------------------------------------+
//| Format Timestamp as ISO 8601 UTC (with Z suffix)                  |
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
   
   if(lastSyncTime == 0) return true;
   
   long hoursSinceSync = (TimeCurrent() - lastSyncTime) / 3600;
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
      return;
   }
   
   int totalDeals = HistoryDealsTotal();
   Print("Scanning ", totalDeals, " deals from the last ", SYNC_DAYS, " days...");
   
   int sentCount = 0;
   int skippedCount = 0;
   int errorCount = 0;
   
   for(int i = 0; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;
      
      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      
      if(!PassesFilter(symbol, magic)) { skippedCount++; continue; }
      if(IsNonTradingDeal(dealType)) { skippedCount++; continue; }
      
      string direction = GetDirectionFromDealType(dealType);
      if(direction == "") { skippedCount++; continue; }
      
      string eventType = "";
      if(dealEntry == DEAL_ENTRY_IN) eventType = "entry";
      else if(dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_INOUT) eventType = "exit";
      else { skippedCount++; continue; }
      
      string payload = BuildPayload(dealTicket, eventType, direction, "history_sync");
      
      if(sentCount > 0 && sentCount % 10 == 0)
         Print("Syncing history... ", sentCount, "/", totalDeals - skippedCount, " deals sent");
      
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
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      
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
      
      if(!PassesFilter(symbol, magic)) { skippedCount++; continue; }
      
      string direction = (posType == POSITION_TYPE_BUY) ? "buy" : "sell";
      
      string payload = BuildOpenPositionPayload(ticket, symbol, direction, lots, openPrice, sl, tp, openTime, swap, profit, magic, comment);
      
      if(SendEvent(payload, ticket))
         sentCount++;
      else
      {
         AddToQueue(payload, ticket);
         errorCount++;
      }
      
      Sleep(50);
   }
   
   Print("Open position sync complete! Sent: ", sentCount, ", Queued: ", errorCount, ", Skipped: ", skippedCount);
}
//+------------------------------------------------------------------+
