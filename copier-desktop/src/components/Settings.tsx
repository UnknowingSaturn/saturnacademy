import { invoke } from "@tauri-apps/api/tauri";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import { relaunch } from "@tauri-apps/api/process";
import { useState } from "react";
import { Check, Download, Eye, EyeOff, FolderOpen, Key, Loader2, RefreshCw, Save } from "lucide-react";
import { CopierStatus } from "../types";

interface SettingsProps {
  status: CopierStatus | null;
}

export default function Settings({ status }: SettingsProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [mt5Path, setMt5Path] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Update states
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return;

    setSaving(true);
    setError(null);

    try {
      await invoke("set_api_key", { apiKey: apiKey.trim() });
      await invoke("sync_config");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSetMt5Path = async () => {
    if (!mt5Path.trim()) return;

    try {
      await invoke("set_mt5_path", { path: mt5Path.trim() });
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setError(null);
    
    try {
      const { shouldUpdate, manifest } = await checkUpdate();
      
      if (shouldUpdate && manifest) {
        setUpdateAvailable(true);
        setUpdateVersion(manifest.version);
      } else {
        setUpdateAvailable(false);
        setUpdateVersion(null);
      }
    } catch (e) {
      console.error("Update check failed:", e);
      setError(`Update check failed: ${String(e)}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstalling(true);
    setError(null);
    
    try {
      await installUpdate();
      await relaunch();
    } catch (e) {
      console.error("Update installation failed:", e);
      setError(`Update failed: ${String(e)}`);
      setInstalling(false);
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* API Key */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">API Key</h3>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Enter the API key from your Saturn web dashboard to sync configuration
        </p>

        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter your API key..."
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded"
          >
            {showKey ? (
              <EyeOff className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Eye className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </div>

        <button
          onClick={handleSaveApiKey}
          disabled={saving || !apiKey.trim()}
          className="mt-3 w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? (
            "Saving..."
          ) : saved ? (
            <>
              <Check className="w-4 h-4" />
              Saved & Synced
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save & Sync
            </>
          )}
        </button>
      </div>

      {/* MT5 Data Path */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <FolderOpen className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">MT5 Data Path</h3>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Path to your MT5 terminal data folder (usually in AppData/Roaming/MetaQuotes/Terminal)
        </p>

        <input
          type="text"
          value={mt5Path}
          onChange={(e) => setMt5Path(e.target.value)}
          placeholder="C:\Users\You\AppData\Roaming\MetaQuotes\Terminal\ABC123..."
          className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />

        <button
          onClick={handleSetMt5Path}
          disabled={!mt5Path.trim()}
          className="mt-3 w-full flex items-center justify-center gap-2 bg-secondary text-foreground rounded-md py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-4 h-4" />
          Set Path
        </button>
      </div>

      {/* Updates */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Download className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Updates</h3>
        </div>

        {updateAvailable && updateVersion ? (
          <div className="space-y-3">
            <div className="bg-primary/10 border border-primary/30 rounded-md p-3">
              <p className="text-sm font-medium text-primary">
                Update Available: v{updateVersion}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                A new version is ready to install
              </p>
            </div>
            <button
              onClick={handleInstallUpdate}
              disabled={installing}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {installing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Install & Restart
                </>
              )}
            </button>
          </div>
        ) : (
          <button
            onClick={handleCheckUpdate}
            disabled={checkingUpdate}
            className="w-full flex items-center justify-center gap-2 bg-secondary text-foreground rounded-md py-2 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50 transition-colors"
          >
            {checkingUpdate ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Check for Updates
              </>
            )}
          </button>
        )}
      </div>

      {/* Status Info */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium mb-3">Connection Info</h3>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span
              className={
                status?.is_connected ? "text-green-500" : "text-red-500"
              }
            >
              {status?.is_connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Config Version</span>
            <span>{status?.config_version ?? "N/A"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Sync</span>
            <span>
              {status?.last_sync
                ? new Date(status.last_sync).toLocaleTimeString()
                : "Never"}
            </span>
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* App Info */}
      <div className="text-center text-xs text-muted-foreground pt-4">
        <p>Saturn Trade Copier v1.0.0</p>
        <p className="mt-1">© 2024 Saturn Trading</p>
      </div>
    </div>
  );
}
