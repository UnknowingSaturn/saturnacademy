# Ephemeris Trade Copier - Installation Guide

## Quick Install (Recommended)

### Step 1: Download the Installer
1. Go to the Trade Copier page in your Ephemeris journal
2. Click the "Desktop" tab
3. Click "Download for Windows"
4. Save the file to your Downloads folder

### Step 2: Run the Installer
1. Navigate to your Downloads folder
2. Double-click `EphemerisTradeCopier-setup.exe`
3. If Windows SmartScreen appears:
   - Click "More info"
   - Click "Run anyway"

### Step 3: Complete Installation
1. Follow the installation wizard
2. Choose your installation directory (default is recommended)
3. Optionally create a desktop shortcut
4. Click "Install"

### Step 4: First Launch
The app will launch automatically after installation. You'll find it in your system tray (bottom-right of your screen, near the clock).

### Step 5: Configure the App
1. Right-click the tray icon
2. Select "Settings"
3. Enter your API key:
   - Go to your Ephemeris journal web app
   - Navigate to Trade Copier → Desktop tab
   - Copy your Receiver API Key
   - Paste it in the desktop app

### Step 6: Verify Connection
1. The tray icon should turn green when connected
2. Right-click and select "Open Dashboard" to see the mini dashboard
3. Verify your configuration is synced from the cloud

---

## System Requirements

| Requirement | Minimum |
|------------|---------|
| OS | Windows 10 (64-bit) |
| RAM | 2 GB |
| Disk Space | 50 MB |
| MetaTrader 5 | Installed and configured |
| Internet | Required for initial setup |

---

## Tray Icon Colors

| Color | Status |
|-------|--------|
| 🟢 Green | Active and copying trades |
| 🟡 Yellow | Paused or waiting for master heartbeat |
| 🔴 Red | Error or daily limit reached |
| ⚫ Gray | Disconnected from cloud |

---

## Troubleshooting

### App won't start
1. Check Windows Event Viewer for errors
2. Try running as Administrator
3. Reinstall the app

### Can't connect to cloud
1. Check your internet connection
2. Verify your API key is correct
3. Check if the Ephemeris web app is accessible

### Trades not copying
1. Ensure the Master EA is running in MT5
2. Check the queue folder path in settings
3. Look at the execution log in the mini dashboard

### Windows SmartScreen blocking
This is normal for new apps. The app is safe to run:
1. Click "More info"
2. Click "Run anyway"

---

## Uninstallation

1. Open Windows Settings
2. Go to Apps → Installed apps
3. Find "Ephemeris Trade Copier"
4. Click the three dots → Uninstall

Or use the uninstaller in the Start Menu under "Ephemeris Trade Copier".

---

## Getting Help

- **Documentation**: Check the README in the GitHub repository
- **Community**: Join our Discord server
- **Issues**: Report bugs on GitHub Issues

---

## Auto-Updates

The app will automatically check for updates on startup. When an update is available:
1. You'll see a notification in the system tray
2. Click the notification to download the update
3. The app will restart with the new version

To manually check for updates:
1. Right-click the tray icon
2. Select "Check for Updates"
