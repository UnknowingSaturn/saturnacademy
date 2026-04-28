# Ephemeris Trade Copier - Desktop App

A lightweight Tauri-based desktop application for ultra-low latency trade copying between MetaTrader 5 terminals.

## Overview

This desktop app runs in your system tray and monitors your MT5 master account for new trades, then automatically copies them to your receiver accounts with **20-50ms latency** (vs 100-500ms with EA-only approach).

### Features

- 🚀 **Ultra-Low Latency**: Sub-50ms trade execution
- 💾 **Lightweight**: Only ~3-5MB download
- 🔄 **Auto-Updates**: Automatic updates when new versions are released
- 📡 **Cloud Sync**: Configuration syncs from your web dashboard
- 🔌 **Offline Capable**: Works offline, syncs execution history when connected
- 🖥️ **System Tray**: Runs silently in the background

## Architecture

```
┌──────────────────┐     Config Download      ┌───────────────────┐
│   Web App        │ ──────────────────────► │   Desktop App     │
│  (Journal/UI)    │                          │   (Tauri/Rust)    │
└──────────────────┘                          └───────────────────┘
        │                                              │
        │                                              │ File Watch
        │                                              ▼
        │                                     ┌───────────────────┐
        │  Execution Sync                     │   MT5 Terminal    │
        │ ◄────────────────────────────────── │   (Master EA)     │
        │                                     └───────────────────┘
        │                                              │
        │                                              │ Commands
        ▼                                              ▼
┌──────────────────┐                          ┌───────────────────┐
│   Cloud Database │                          │   MT5 Terminal    │
│   (Lovable)      │                          │   (Receiver)      │
└──────────────────┘                          └───────────────────┘
```

## Prerequisites

- **Windows 10/11** (64-bit)
- **Node.js 18+** - [Download](https://nodejs.org/)
- **Rust 1.70+** - [Install via rustup](https://rustup.rs/)
- **Tauri CLI** - `npm install -g @tauri-apps/cli`
- **MetaTrader 5** - With master account configured

## Installation

### Option 1: Download Pre-built Installer (Recommended)

1. Download the latest `.msi` installer from the [Releases](https://github.com/your-org/saturn-copier-desktop/releases) page
2. Run the installer
3. Launch "Ephemeris Trade Copier" from the Start Menu

### Option 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/your-org/saturn-copier-desktop.git
cd saturn-copier-desktop

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your API key

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Configuration

### 1. Get Your API Key

1. Go to the Ephemeris web app
2. Navigate to **Accounts** page
3. Click on your receiver account
4. Generate or copy the API key

### 2. Configure the Desktop App

Create a `.env` file in the project root:

```env
# Your receiver account's API key
COPIER_API_KEY=your_api_key_here

# Config endpoint (automatically set)
COPIER_CONFIG_URL=https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1/copier-config

# MT5 data folder path (adjust to your installation)
MT5_DATA_PATH=C:\Users\YourName\AppData\Roaming\MetaQuotes\Terminal\YOUR_TERMINAL_ID\MQL5\Files
```

### 3. Install the Master EA

1. Open MetaTrader 5 on your master account
2. Copy `TradeCopierMaster.mq5` to `MQL5/Experts/`
3. Compile and attach to any chart
4. The EA will create a `CopierQueue` folder in `MQL5/Files/`

## Usage

### Starting the App

The app runs in your system tray. After launching:

1. **Green icon** = Active, copying trades
2. **Yellow icon** = Paused or waiting for master heartbeat
3. **Red icon** = Error or daily limit reached
4. **Gray icon** = Disconnected

### System Tray Menu

Right-click the tray icon to access:

- **Status**: Current connection and copy status
- **Open Dashboard**: Show the mini dashboard window
- **View Logs**: Open the execution log
- **Settings**: Configure app settings
- **Pause Copying**: Temporarily stop copying
- **Quit**: Exit the application

### Mini Dashboard

The dashboard shows:

- Connection status
- Today's statistics (copies, success rate, slippage)
- Recent activity log
- Quick actions

## Risk Modes

The desktop app supports all risk calculation modes:

| Mode | Description |
|------|-------------|
| `balance_multiplier` | `master_lots × (receiver_balance / master_balance) × multiplier` |
| `fixed_lot` | Fixed lot size for all trades |
| `risk_percent` | Risk percentage of account balance per trade |
| `risk_dollar` | Fixed dollar risk per trade |
| `intent` | Uses master's intent data for exact risk replication |

## Folder Structure

```
copier-desktop/
├── src/                    # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   └── components/
│       ├── TrayMenu.tsx
│       ├── StatusPanel.tsx
│       ├── ExecutionLog.tsx
│       └── Settings.tsx
├── src-tauri/              # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── copier/
│       │   ├── mod.rs
│       │   ├── file_watcher.rs
│       │   ├── event_processor.rs
│       │   ├── lot_calculator.rs
│       │   └── trade_executor.rs
│       ├── mt5/
│       │   ├── mod.rs
│       │   └── bridge.rs
│       └── sync/
│           ├── mod.rs
│           ├── config.rs
│           └── executions.rs
├── package.json
└── README.md
```

## Troubleshooting

### App won't start

1. Ensure Rust is installed: `rustc --version`
2. Ensure Node.js is installed: `node --version`
3. Try reinstalling dependencies: `npm install`

### No trades being copied

1. Check the Master EA is running on MT5
2. Verify the queue folder path in settings
3. Check the execution log for errors
4. Ensure your API key is valid

### High slippage

1. Check your internet connection
2. Reduce the poll interval in settings
3. Consider upgrading to a VPS closer to your broker

### Config not syncing

1. Check your internet connection
2. Verify your API key is correct
3. Click "Refresh Config" in settings

## Development

### Running Tests

```bash
# Rust tests
cd src-tauri
cargo test

# Frontend tests
npm test
```

### Building for Release

```bash
# Build Windows installer
npm run tauri build

# Output will be in src-tauri/target/release/bundle/
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Documentation**: [docs.saturntrading.io](https://docs.saturntrading.io)
- **Discord**: [Join our community](https://discord.gg/saturntrading)
- **Issues**: [GitHub Issues](https://github.com/your-org/saturn-copier-desktop/issues)
