# MT5 Trade Journal Bridge - Installation Guide

This Expert Advisor captures your MT5 trades in real-time and sends them directly to your Trade Journal. No relay server required!

## Quick Setup (3 minutes)

### Step 1: Download the EA
Download `TradeJournalBridge.mq5` from this folder or from the Accounts page in your Trade Journal.

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
- ✅ Capture all trade entries and exits in real-time
- ✅ Track partial closes with proper volume aggregation
- ✅ Auto-detect your broker and account type
- ✅ Work with prop firm accounts (FTMO, FundedNext, etc.)

## Importing Historical Trades

By default, only **new trades** are synced automatically. To import older trades:

1. Go to the **Accounts** page in your Trade Journal
2. Click the **History** button (clock icon) on your account card
3. Select a date range (up to 3 months)
4. Click **"Enable Import"**
5. **Restart your EA** (remove and re-attach to chart, or restart MT5)

Your historical trades will be imported automatically. Duplicates are handled gracefully.

**Note:** The EA will automatically re-sync history every 24 hours if import is enabled. For older trades beyond 3 months, use the CSV import feature.

## How It Works

### Real-Time Capture
The EA sends **deal events** (entries and exits) to your journal. The backend:
- Groups deals by position ID to track trades
- Automatically detects partial closes vs full closes
- Calculates total PnL including all partial exits
- Computes R-multiples when stop-loss is set

### Server-Controlled Import
When you enable history import from the app:
1. The EA sends up to 90 days of history on startup
2. The server filters trades based on your selected date range
3. Only trades within your specified window are imported
4. Duplicates are automatically skipped

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
4. For historical trades, make sure you enabled import from the app first

### Historical trades not importing
1. Make sure you enabled import from the Accounts page
2. Restart the EA after enabling import
3. Wait a few seconds and refresh the journal page
4. Check that trades fall within your selected date range

## Optional Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Symbol Filter | (empty) | Only capture specific symbol (e.g., "EURUSD") |
| Magic Filter | 0 | Only capture specific magic number (0 = all) |
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

## Version History

- **v2.11**: Server-controlled history import (always sends 90 days, server filters)
- **v2.10**: Added reset sync flag, configurable sync days
- **v2.09**: Initial release with direct cloud connection

## Support

If you need help, check the documentation or contact support through the app.
