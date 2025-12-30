# Trade Copier Setup Guide

## Overview

The Trade Copier allows you to automatically copy trades from a master account to one or more receiver accounts locally, without any cloud involvement in the execution path. This is **prop firm safe** as all trade execution happens on your local machine.

## Architecture

```
Master MT5 Terminal                    Receiver MT5 Terminal(s)
+-------------------+                  +---------------------+
| TradeCopierMaster |  --writes-->     | TradeCopierReceiver |
|       EA          |   JSON files     |         EA          |
+-------------------+     |            +---------------------+
        |                 |                      |
        v                 v                      |
   Cloud Sync      CopierQueue/                  |
   (optional)      pending/                      |
                   executed/                     |
                        ^                        |
                        |                        |
                        +----------reads---------+
```

## Quick Start

### 1. Configure in Web App

1. Navigate to **Trade Copier** in the sidebar
2. **Accounts Tab**: Set one account as Master, others as Receivers
3. **Symbols Tab**: Add symbol mappings (e.g., USTEC.cash → US100)
4. **Risk Tab**: Configure risk settings per receiver
5. **Export Tab**: Generate and download `copier-config.json`

### 2. Install Master EA

1. Copy `TradeCopierMaster.mq5` to your master MT5's `MQL5/Experts/` folder
2. Compile the EA in MetaEditor
3. Attach to any chart (one instance per terminal)
4. Configure inputs:
   - **InpApiKey**: Your API key (optional, for cloud sync)
   - **InpEnableCopier**: true
   - **InpCopierQueuePath**: CopierQueue (default)
   - **InpBrokerUTCOffset**: Your broker's UTC offset (e.g., 2 for UTC+2)

### 3. Install Receiver EA

1. Copy `TradeCopierReceiver.mq5` to receiver MT5's `MQL5/Experts/` folder
2. Copy `copier-config.json` to `MQL5/Files/` folder
3. If using a network share, copy to same location on each receiver
4. Compile and attach to any chart
5. Configure inputs:
   - **InpConfigPath**: copier-config.json
   - **InpQueuePath**: Same path as Master EA (or network share path)

### 4. Enable WebRequest (Master Only)

If using cloud sync:
1. Go to Tools → Options → Expert Advisors
2. Check "Allow WebRequest for listed URL"
3. Add: `https://soosdjmnpcyuqppdjsse.supabase.co`

## Risk Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Balance Multiplier** | Receiver lots = Master lots × (Receiver balance / Master balance) × value | Proportional sizing |
| **Fixed Lot** | Always use specified lot size | Conservative approach |
| **Risk Percent** | Calculate lots to risk X% per trade | Standardized risk |
| **Risk Dollar** | Calculate lots to risk $X per trade | Fixed dollar risk |
| **Intent Mode** | Use master's SL distance with receiver's risk settings | Advanced |

## Safety Features

### Slippage Control
- Max slippage setting prevents execution if price moved too far
- Configurable per receiver (default: 3 pips)

### Daily Loss Limit
- Stops copying when daily loss exceeds threshold
- Configurable in R-multiples (default: 3R)

### Session Filter
- Only copy during specified trading sessions
- Prevents off-hours copying

### Manual Confirm Mode
- Shows dialog before each trade execution
- Recommended for initial testing

### Prop Firm Safe Mode
- Enables conservative defaults
- Slower polling, stricter slippage, manual confirm

## File Structure

```
MQL5/
├── Files/
│   ├── copier-config.json          # Downloaded from web app
│   ├── CopierQueue/
│   │   ├── pending/                # Master writes here
│   │   │   └── 2025-01-15_12345_entry.json
│   │   ├── executed/               # Processed events moved here
│   │   ├── heartbeat.json          # Master health check
│   │   └── open_positions.json     # For restart recovery
│   ├── copier-positions.json       # Receiver position mapping
│   └── copier-executed.json        # Receiver idempotency tracking
├── Experts/
│   ├── TradeCopierMaster.mq5
│   └── TradeCopierReceiver.mq5
└── Logs/
    ├── TradeCopierMaster.log
    └── TradeCopierReceiver.log
```

## Same-Machine vs Multi-Machine

### Same Machine (Both terminals on one PC)
- Default setup works out of the box
- Both EAs use `MQL5/Files/CopierQueue/` folder

### Multiple Machines (VPS/Network)
- Use a shared network folder accessible to all terminals
- Set `InpCopierQueuePath` to the network path on each EA
- Example: `\\SERVER\SharedFolder\CopierQueue`

**Note**: This is NOT recommended for prop firm copying due to potential network delays. Same-machine copying is the safest approach.

## Troubleshooting

### Events not being copied
1. Check Master EA is running (look for heartbeat.json updates)
2. Verify queue folder path matches on both EAs
3. Check receiver logs for errors
4. Ensure symbol mappings exist

### High slippage rejections
1. Increase max slippage setting
2. Reduce poll interval for faster execution
3. Check if market is volatile

### "Config file not found"
1. Verify `copier-config.json` is in `MQL5/Files/`
2. Check file permissions
3. Re-download config from web app

### Positions not closing
1. Verify position mapping is correct
2. Check receiver logs for close event processing
3. Ensure same position ID is being used

## Best Practices

1. **Test on demo first** - Always test with demo accounts before live
2. **Use Prop Firm Safe Mode** - Enable for prop firm receiver accounts
3. **Monitor logs** - Check logs regularly for any issues
4. **Keep config updated** - Re-download after changing settings
5. **Same machine for prop firms** - Avoid network latency risks
6. **Reasonable slippage** - 2-3 pips is typical, lower = more rejections

## Version History

- v1.00 - Initial release with file-based copying
