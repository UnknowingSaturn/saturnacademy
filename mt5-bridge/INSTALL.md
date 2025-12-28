# MT5 Trade Journal Bridge - Installation Guide

This Expert Advisor captures your MT5 trades in real-time and sends them directly to your Trade Journal. No relay server required!

## Quick Setup (3 minutes)

### Step 1: Download the EA
Download `TradeJournalBridge.mq5` from this folder.

### Step 2: Install in MetaTrader 5
1. Open MT5
2. Go to **File → Open Data Folder**
3. Navigate to **MQL5 → Experts**
4. Copy `TradeJournalBridge.mq5` to this folder
5. Restart MT5 or right-click the Navigator panel and select **Refresh**

### Step 3: Enable WebRequest
1. Go to **Tools → Options → Expert Advisors**
2. Check **"Allow WebRequest for listed URL"**
3. Click **Add** and enter:
   ```
   https://soosdjmnpcyuqppdjsse.supabase.co
   ```
4. Click **OK**

### Step 4: Get Your API Key
1. Go to the Accounts page in your Trade Journal
2. Click **"Connect MT5"**
3. Copy the generated API Key

### Step 5: Attach the EA
1. In MT5 Navigator, find **Expert Advisors → TradeJournalBridge**
2. Drag it onto any chart
3. In the settings, paste your API Key
4. Click **OK**

## That's It!

Your account will be created automatically after your first trade. The EA will:
- ✅ **Auto-sync historical trades** from the last 30 days on first run
- ✅ Capture all trade entries and exits in real-time
- ✅ Track partial closes with proper volume aggregation
- ✅ Auto-detect your broker and account type
- ✅ Work with prop firm accounts (FTMO, FundedNext, etc.)

## How It Works

### Historical Sync (First Run)
When you first install the EA, it automatically syncs your last 30 days of trades. This happens only once - subsequent restarts won't re-sync. To re-sync history, delete the flag file: `MQL5/Files/TradeJournalSynced_[ACCOUNT].flag`

### Real-Time Capture
The EA sends **deal events** (entries and exits) to your journal. The backend:
- Groups deals by position ID to track trades
- Automatically detects partial closes vs full closes
- Calculates total PnL including all partial exits
- Computes R-multiples when stop-loss is set

## Features

- **Read-Only**: Cannot place or modify trades - prop-firm safe
- **Direct Cloud Connection**: No relay server needed
- **Auto-Retry**: Failed sends are queued and retried automatically
- **Idempotent**: Duplicate events are handled gracefully
- **UTC Timestamps**: All times are recorded in UTC for consistency

## Known Limitations

### SL/TP Modifications
The EA captures SL/TP values from deal events only. If you modify SL/TP without closing or opening a position, those changes are captured on the next deal event. Real-time SL/TP modification tracking would require handling `TRADE_TRANSACTION_POSITION` events, which adds complexity.

**Workaround**: Your final SL/TP values are always captured when the trade closes.

### Position Restart
The EA tracks processed deals in memory. If MT5 restarts, it may attempt to resend recent deals. The backend handles duplicates gracefully using idempotency keys.

## Troubleshooting

### "WebRequest not allowed" error
1. Make sure you added the URL in Tools → Options → Expert Advisors
2. The exact URL is: `https://soosdjmnpcyuqppdjsse.supabase.co`
3. Restart MT5 after adding the URL

### EA not showing in Navigator
1. Make sure the file is in the correct folder: `MQL5/Experts/`
2. Right-click Navigator → Refresh
3. Check that you have the .mq5 file (not .ex5)

### "Invalid API Key" error
1. Generate a new API Key from the Accounts page
2. Make sure you copied the complete key
3. The key is case-sensitive

### Trades not appearing in journal
1. Check the EA's Experts tab for error messages
2. Enable "Verbose Mode" in EA settings for detailed logging
3. Check `MQL5/Files/TradeJournal.log` for debug information

## Optional Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Symbol Filter | (empty) | Only capture specific symbol (e.g., "EURUSD") |
| Magic Filter | 0 | Only capture specific magic number (0 = all) |
| **Sync History** | **true** | Sync historical trades on first run |
| **Sync Days Back** | **30** | Number of days of history to sync |
| Enable Logging | true | Write logs to file for debugging |
| Verbose Mode | false | Show detailed console output |

## Technical Details

### Event Types
- **entry**: New position opened (DEAL_ENTRY_IN)
- **exit**: Position closed partially or fully (DEAL_ENTRY_OUT)

### IDs Sent
- `position_id`: Groups all deals for a single trade
- `deal_id`: Unique identifier for each deal
- `order_id`: The order that created this deal

### Timestamps
- `timestamp`: UTC time (using TimeGMT())
- `server_time`: Broker server time (for reference)

## Support

If you need help, check the documentation or contact support through the app.
