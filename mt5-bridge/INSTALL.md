# Trade Journal Bridge - Installation Guide

Complete setup guide for the MT5 Expert Advisor that automatically captures and sends trade events to your journal.

## Overview

```
┌─────────────────────┐     HTTP      ┌─────────────────────┐     HTTPS     ┌─────────────────────┐
│       MT5           │ ──────────► │   Relay Server      │ ──────────► │    Journal API      │
│  TradeJournalBridge │   localhost   │   (Node.js)         │              │   (Supabase)        │
└─────────────────────┘               └─────────────────────┘              └─────────────────────┘
```

## Prerequisites

- MetaTrader 5 terminal
- Node.js 14+ (for relay server)
- An account on the Trade Journal app

---

## Step 1: Get Your API Key

1. Log into your Trade Journal account
2. Go to **Dashboard** → **Accounts**
3. Create or select an account
4. Copy the **API Key** (you'll need this for the EA)

> ⚠️ **Important**: Keep your API key secret. Anyone with this key can add trades to your account.

---

## Step 2: Install the Expert Advisor

### 2.1 Locate MT5 Data Folder

1. Open MetaTrader 5
2. Go to **File** → **Open Data Folder**
3. Navigate to `MQL5/Experts/`

### 2.2 Copy EA File

1. Copy `TradeJournalBridge.mq5` to the `MQL5/Experts/` folder
2. In MT5, go to **Tools** → **MetaEditor** (or press F4)
3. In the Navigator panel, find `Experts/TradeJournalBridge.mq5`
4. Press **F7** to compile
5. Verify no errors in the output log

### 2.3 Enable WebRequest

This is **critical** - the EA needs permission to make HTTP requests:

1. In MT5, go to **Tools** → **Options**
2. Click the **Expert Advisors** tab
3. Check ✅ **Allow WebRequest for listed URL:**
4. Click **Add** and enter: `http://127.0.0.1`
5. Click **OK**

![WebRequest Settings](https://i.imgur.com/example.png)

---

## Step 3: Install the Relay Server

### 3.1 Install Node.js

If you don't have Node.js installed:

1. Download from [nodejs.org](https://nodejs.org/)
2. Install the LTS version
3. Verify installation: `node --version`

### 3.2 Setup Relay Server

```bash
# Navigate to the relay server folder
cd mt5-bridge

# Install dependencies (there are none, but run anyway)
npm install

# Start the relay server
npm start
```

You should see:

```
╔═══════════════════════════════════════════════════════════╗
║         Trade Journal Bridge - Relay Server               ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on http://127.0.0.1:8080                  ║
║                                                           ║
║  Endpoints:                                               ║
║    POST /api/trades  - Forward trade events               ║
║    GET  /health      - Health check                       ║
║    GET  /stats       - Request statistics                 ║
║                                                           ║
║  Press Ctrl+C to stop                                     ║
╚═══════════════════════════════════════════════════════════╝
```

### 3.3 Run as Background Service (Optional)

**Windows (using PM2):**
```bash
npm install -g pm2
pm2 start relay-server.js --name trade-journal-relay
pm2 save
pm2 startup
```

**Linux/macOS:**
```bash
npm install -g pm2
pm2 start relay-server.js --name trade-journal-relay
pm2 save
pm2 startup
```

---

## Step 4: Attach EA to Chart

1. In MT5, open any chart (recommended: EURUSD M1)
2. In the Navigator panel (Ctrl+N), expand **Expert Advisors**
3. Drag **TradeJournalBridge** onto the chart
4. Configure the inputs:

| Parameter | Value | Description |
|-----------|-------|-------------|
| **Terminal ID** | `TERMINAL_01` | Unique name for this MT5 instance |
| **API Key** | `your-api-key` | From Step 1 |
| **Server URL** | `http://127.0.0.1:8080` | Leave default |
| **Enable Logging** | `true` | Recommended |
| **Verbose Mode** | `false` | Set to true for debugging |
| **Symbol Filter** | *(empty)* | Leave empty for all symbols |
| **Magic Filter** | `0` | 0 = all magic numbers |

5. Click **OK**
6. Make sure the **AutoTrading** button in the toolbar is enabled

---

## Step 5: Verify Installation

### 5.1 Check EA Status

Look at the chart. You should see in the **Experts** tab (bottom panel):
```
Trade Journal Bridge initialized successfully
Terminal ID: TERMINAL_01
Server URL: http://127.0.0.1:8080
WebRequest OK. Relay server responding.
```

### 5.2 Test with a Demo Trade

1. Open a small demo trade manually
2. Check the relay server console - you should see:
```
[INFO] Received event: open for EURUSD
[INFO] Event forwarded successfully { event_id: "...", trade_id: "..." }
```

3. Close the trade
4. Check the console again for the `close` event
5. Verify the trade appears in your journal

---

## Troubleshooting

### EA shows "WebRequest not allowed"

1. Go to **Tools** → **Options** → **Expert Advisors**
2. Make sure `http://127.0.0.1` is in the allowed URLs list
3. Restart the EA

### EA shows "Relay server not responding"

1. Make sure the relay server is running: `npm start`
2. Check if port 8080 is available
3. Try accessing http://127.0.0.1:8080/health in a browser

### Events not appearing in journal

1. Check the relay server console for errors
2. Verify your API key is correct
3. Check the log file: `MQL5/Files/TradeJournal.log`
4. Check the queue file: `MQL5/Files/TradeJournalQueue.csv`

### "Invalid API key" error

1. Go to your journal account settings
2. Regenerate or copy the correct API key
3. Update the EA input parameter

---

## Multiple MT5 Terminals

If you run multiple MT5 terminals (e.g., different prop firm accounts):

1. Use a **unique Terminal ID** for each terminal
2. Use the **same relay server** (it can handle multiple terminals)
3. Each terminal should have its own API key (linked to the correct account)

Example setup:
- Terminal 1: `FTMO_MAIN` with API key for FTMO account
- Terminal 2: `FUNDEDNEXT_1` with API key for FundedNext account
- Terminal 3: `DEMO_TEST` with API key for demo account

---

## Security Notes

1. **API keys are secret** - never share them
2. **Relay server runs locally** - no external exposure
3. **EA is read-only** - cannot place or modify trades
4. **Prop firm safe** - tested with FTMO and FundedNext

---

## Log Files

| File | Location | Purpose |
|------|----------|---------|
| `TradeJournal.log` | `MQL5/Files/` | EA activity log |
| `TradeJournalQueue.csv` | `MQL5/Files/` | Failed events queue |
| Relay console | Terminal | Server activity |

---

## Updating

### Update EA

1. Copy new `TradeJournalBridge.mq5` to `MQL5/Experts/`
2. Recompile in MetaEditor (F7)
3. Remove and re-attach EA to chart

### Update Relay Server

1. Stop the relay server (Ctrl+C or `pm2 stop trade-journal-relay`)
2. Replace `relay-server.js`
3. Restart: `npm start` or `pm2 restart trade-journal-relay`

---

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review log files for error messages
3. Enable verbose mode for detailed logging
4. Contact support with:
   - MT5 version
   - EA log file contents
   - Relay server console output
   - Steps to reproduce the issue
