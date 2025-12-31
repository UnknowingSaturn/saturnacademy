# Saturn Trade Copier - Release Guide

## Prerequisites

Before your first release, you need to set up signing keys:

### 1. Generate Tauri Signing Keys

Run this command on your development machine:

```bash
npx tauri signer generate -w ~/.tauri/saturn-copier.key
```

This generates:
- **Private key**: `~/.tauri/saturn-copier.key`
- **Public key**: Displayed in terminal (also saved as `.key.pub`)

### 2. Add Secrets to GitHub Repository

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these repository secrets:
- `TAURI_PRIVATE_KEY`: Contents of the private key file
- `TAURI_KEY_PASSWORD`: The password you used when generating keys

### 3. Update tauri.conf.json

Add the public key to `copier-desktop/src-tauri/tauri.conf.json`:

```json
{
  "tauri": {
    "updater": {
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

### 4. Add Application Icons

Before building for production, add icon files to `copier-desktop/src-tauri/icons/`:

Required files:
- `icon.ico` (Windows) - 256x256 multi-resolution
- `icon.icns` (macOS) - Apple icon format
- `32x32.png` - 32x32 PNG
- `128x128.png` - 128x128 PNG
- `128x128@2x.png` - 256x256 PNG (for retina displays)

Then update `tauri.conf.json` to reference them:

```json
{
  "tauri": {
    "bundle": {
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico"
      ]
    },
    "systemTray": {
      "iconPath": "icons/icon.ico"
    }
  }
}
```

**Note**: The default configuration has empty icon paths for development. Icons are required for production builds.

---

## Releasing a New Version

### Step 1: Bump Version Numbers

Update the version in these 3 files:

1. **copier-desktop/package.json**
   ```json
   "version": "1.0.1"
   ```

2. **copier-desktop/src-tauri/tauri.conf.json**
   ```json
   "package": {
     "version": "1.0.1"
   }
   ```

3. **copier-desktop/src-tauri/Cargo.toml**
   ```toml
   version = "1.0.1"
   ```

### Step 2: Commit and Tag

```bash
git add .
git commit -m "Release v1.0.1"
git tag v1.0.1
git push origin main --tags
```

### Step 3: Wait for Build

GitHub Actions will automatically:
1. Build the Windows installer
2. Sign the artifacts
3. Create a GitHub Release with the installer

### Step 4: Verify

1. Check the [Releases page](../../releases) for the new version
2. Verify `.msi.zip` and `.msi.zip.sig` files are present
3. Test the update from an installed app

---

## How Updates Work

1. **On App Startup**: The desktop app calls the update endpoint
2. **Endpoint Fetches Latest Release**: From GitHub Releases API
3. **Compare Versions**: If newer version exists, returns update info
4. **User Prompt**: App shows "Update Available" in Settings
5. **Install**: User clicks install, app downloads, installs, and restarts

---

## Troubleshooting

### Build Fails
- Check GitHub Actions logs
- Ensure all 3 version files match
- Verify secrets are set correctly
- Ensure icons are configured (see Step 4 above)

### Updates Not Working
- Check update endpoint logs in Lovable Cloud
- Verify release has signed artifacts (`.sig` files)
- Check `pubkey` in tauri.conf.json matches the key used for signing

### Signature Mismatch
- Regenerate keys and update both GitHub secrets and tauri.conf.json
- Ensure the same key pair is used for all releases
