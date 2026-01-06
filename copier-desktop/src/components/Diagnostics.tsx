import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { save } from "@tauri-apps/api/dialog";
import {
  RefreshCw,
  Cpu,
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Server,
  Zap,
  Layers,
  XCircle,
  Download,
  Play,
  Pause,
  RotateCcw,
} from "lucide-react";
import { DiagnosticsInfo } from "../types";

interface ReconciliationStatus {
  config: {
    enabled: boolean;
    interval_secs: number;
    auto_close_orphaned: boolean;
    auto_open_missing: boolean;
    auto_adjust_volume: boolean;
    auto_sync_sl_tp: boolean;
  };
  last_run: string | null;
  recent_actions: Array<{
    timestamp: string;
    receiver_id: string;
    action_type: string;
    symbol: string;
    details: string;
    success: boolean;
    error: string | null;
  }>;
}

export default function Diagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [reconStatus, setReconStatus] = useState<ReconciliationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [runningRecon, setRunningRecon] = useState(false);

  const fetchDiagnostics = async () => {
    try {
      const [data, recon] = await Promise.all([
        invoke<DiagnosticsInfo>("get_diagnostics"),
        invoke<ReconciliationStatus>("get_recon_status"),
      ]);
      setDiagnostics(data);
      setReconStatus(recon);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch diagnostics: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleExportBundle = async () => {
    try {
      setExporting(true);
      const savePath = await save({
        defaultPath: `copier-debug-${Date.now()}.txt`,
        filters: [{ name: "Text Files", extensions: ["txt"] }],
      });
      
      if (savePath) {
        await invoke("export_debug_bundle", { savePath });
        alert("Debug bundle exported successfully!");
      }
    } catch (err) {
      alert(`Export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  };

  const handleRunReconciliation = async () => {
    try {
      setRunningRecon(true);
      const result = await invoke<{ discrepancy_count: number }>("run_reconciliation_now");
      alert(`Reconciliation complete: ${result.discrepancy_count} discrepancies found`);
      fetchDiagnostics();
    } catch (err) {
      alert(`Reconciliation failed: ${err}`);
    } finally {
      setRunningRecon(false);
    }
  };

  const handleToggleRecon = async (enabled: boolean) => {
    try {
      if (reconStatus) {
        await invoke("update_recon_config", {
          config: { ...reconStatus.config, enabled },
        });
        if (enabled) {
          await invoke("start_recon_loop");
        } else {
          await invoke("stop_recon_loop");
        }
        fetchDiagnostics();
      }
    } catch (err) {
      alert(`Failed to toggle reconciliation: ${err}`);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
    
    if (autoRefresh) {
      // Reduced from 2s to 5s to prevent UI lag
      const interval = setInterval(fetchDiagnostics, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const getHeartbeatStatus = (ageSeconds: number | null) => {
    if (ageSeconds === null) return { text: "Never", color: "text-muted-foreground", icon: Clock };
    if (ageSeconds < 10) return { text: "Just now", color: "text-green-500", icon: CheckCircle2 };
    if (ageSeconds < 30) return { text: `${ageSeconds}s ago`, color: "text-green-500", icon: CheckCircle2 };
    if (ageSeconds < 60) return { text: `${ageSeconds}s ago`, color: "text-yellow-500", icon: AlertCircle };
    if (ageSeconds < 300) return { text: `${Math.floor(ageSeconds / 60)}m ago`, color: "text-orange-500", icon: AlertCircle };
    return { text: "Offline", color: "text-red-500", icon: XCircle };
  };

  const getDiscoveryMethodBadge = (method: string) => {
    const colors: Record<string, string> = {
      process: "bg-green-500/20 text-green-500",
      registry: "bg-blue-500/20 text-blue-500",
      app_data: "bg-purple-500/20 text-purple-500",
      common_path: "bg-orange-500/20 text-orange-500",
      manual: "bg-cyan-500/20 text-cyan-500",
    };
    return colors[method] || "bg-muted text-muted-foreground";
  };

  const getEaStatusBadge = (status: string) => {
    switch (status) {
      case "master":
        return "bg-blue-500/20 text-blue-500 border-blue-500/30";
      case "receiver":
        return "bg-purple-500/20 text-purple-500 border-purple-500/30";
      case "both":
        return "bg-green-500/20 text-green-500 border-green-500/30";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  if (loading && !diagnostics) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading diagnostics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            System Diagnostics
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time system health and terminal status
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportBundle}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent disabled:opacity-50"
          >
            <Download className={`w-4 h-4 ${exporting ? "animate-pulse" : ""}`} />
            Export Bundle
          </button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-border"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchDiagnostics}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {diagnostics && (
        <>
          {/* Discovered Terminals */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Discovered Terminals</h3>
              <span className="ml-auto text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                {diagnostics.terminals.length}
              </span>
            </div>
            <div className="divide-y divide-border">
              {diagnostics.terminals.length === 0 ? (
                <div className="p-8 text-center">
                  <Cpu className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No terminals discovered</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Make sure MT5 is installed and running
                  </p>
                </div>
              ) : (
                diagnostics.terminals.map((terminal) => {
                  const heartbeat = getHeartbeatStatus(terminal.last_heartbeat_age_secs);
                  const HeartbeatIcon = heartbeat.icon;
                  // Use install_label pre-EA, broker post-EA
                  const displayName = terminal.verified 
                    ? (terminal.broker || terminal.install_label || "MT5 Terminal")
                    : (terminal.install_label || "MT5 Terminal");
                  
                  return (
                    <div key={terminal.terminal_id} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">
                              {displayName}
                            </span>
                            {terminal.account && (
                              <span className="text-muted-foreground">
                                - {terminal.account}
                              </span>
                            )}
                            {!terminal.verified && (
                              <span className="text-amber-500 text-xs bg-amber-500/10 px-1.5 py-0.5 rounded">
                                Unverified
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {/* Running status */}
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${
                              terminal.is_running 
                                ? "bg-green-500/10 text-green-500 border-green-500/30" 
                                : "bg-muted text-muted-foreground border-border"
                            }`}>
                              {terminal.is_running ? "Running" : "Stopped"}
                            </span>
                            
                            {/* EA Status */}
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${getEaStatusBadge(terminal.ea_status)}`}>
                              EA: {terminal.ea_status || "none"}
                            </span>
                            
                            {/* Discovery method */}
                            <span className={`text-xs px-2 py-0.5 rounded ${getDiscoveryMethodBadge(terminal.discovery_method)}`}>
                              {terminal.discovery_method}
                            </span>
                            
                            {/* Terminal ID (secondary) */}
                            <span className="text-xs text-muted-foreground font-mono">
                              {terminal.terminal_id.length > 16 
                                ? `${terminal.terminal_id.slice(0, 8)}...${terminal.terminal_id.slice(-4)}` 
                                : terminal.terminal_id}
                            </span>
                          </div>
                        </div>
                        
                        {/* Heartbeat */}
                        <div className={`flex items-center gap-1.5 text-sm ${heartbeat.color}`}>
                          <HeartbeatIcon className="w-4 h-4" />
                          <span>{heartbeat.text}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Execution Queue Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Clock className="w-4 h-4" />
                <span className="text-xs">Pending</span>
              </div>
              <p className="text-2xl font-semibold">{diagnostics.queue_pending}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Activity className="w-4 h-4" />
                <span className="text-xs">In Progress</span>
              </div>
              <p className="text-2xl font-semibold">{diagnostics.queue_in_progress}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-500 mb-2">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs">Completed Today</span>
              </div>
              <p className="text-2xl font-semibold text-green-500">{diagnostics.queue_completed_today}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-500 mb-2">
                <XCircle className="w-4 h-4" />
                <span className="text-xs">Failed Today</span>
              </div>
              <p className="text-2xl font-semibold text-red-500">{diagnostics.queue_failed_today}</p>
            </div>
          </div>

          {/* Reconciliation Status */}
          {reconStatus && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">Automatic Reconciliation</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRunReconciliation}
                    disabled={runningRecon}
                    className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-accent disabled:opacity-50"
                  >
                    <Play className={`w-3 h-3 ${runningRecon ? "animate-pulse" : ""}`} />
                    Run Now
                  </button>
                  <button
                    onClick={() => handleToggleRecon(!reconStatus.config.enabled)}
                    className={`flex items-center gap-1 px-2 py-1 text-xs border rounded ${
                      reconStatus.config.enabled
                        ? "bg-green-500/20 text-green-500 border-green-500/30"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {reconStatus.config.enabled ? (
                      <>
                        <Pause className="w-3 h-3" />
                        Enabled
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3" />
                        Disabled
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Interval</span>
                    <p className="font-medium">{reconStatus.config.interval_secs}s</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Run</span>
                    <p className="font-medium">
                      {reconStatus.last_run
                        ? new Date(reconStatus.last_run).toLocaleTimeString()
                        : "Never"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Auto-close Orphaned</span>
                    <p className="font-medium">{reconStatus.config.auto_close_orphaned ? "Yes" : "No"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Auto-sync SL/TP</span>
                    <p className="font-medium">{reconStatus.config.auto_sync_sl_tp ? "Yes" : "No"}</p>
                  </div>
                </div>
                
                {reconStatus.recent_actions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground mb-2">Recent Actions</p>
                    <div className="max-h-24 overflow-y-auto space-y-1">
                      {reconStatus.recent_actions.slice(0, 5).map((action, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {action.success ? (
                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                          ) : (
                            <XCircle className="w-3 h-3 text-red-500" />
                          )}
                          <span className="text-muted-foreground">
                            {new Date(action.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="font-mono">{action.symbol}</span>
                          <span>{action.action_type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Idempotency Keys */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Layers className="w-4 h-4" />
              <span className="text-sm">Idempotency Keys Cached</span>
            </div>
            <p className="text-xl font-semibold">{diagnostics.idempotency_keys_count}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Prevents duplicate trade execution
            </p>
          </div>

          {/* Recent Errors */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-destructive" />
              <h3 className="text-sm font-semibold">Recent Errors</h3>
              <span className="ml-auto text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded">
                {diagnostics.recent_errors.length}
              </span>
            </div>
            <div className="divide-y divide-border max-h-64 overflow-y-auto">
              {diagnostics.recent_errors.length === 0 ? (
                <div className="p-8 text-center">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-green-500 mb-3" />
                  <p className="text-sm text-muted-foreground">No recent errors</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    System is running smoothly
                  </p>
                </div>
              ) : (
                diagnostics.recent_errors.map((err, index) => (
                  <div key={index} className="p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-destructive break-words">{err.message}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{new Date(err.timestamp).toLocaleTimeString()}</span>
                          {err.terminal_id && (
                            <>
                              <span>•</span>
                              <span className="font-mono truncate">{err.terminal_id}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* System Info */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-3">
              <Server className="w-4 h-4" />
              <span className="text-sm font-medium">System Information</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Platform</span>
                <p className="font-medium">Windows</p>
              </div>
              <div>
                <span className="text-muted-foreground">Copier Version</span>
                <p className="font-medium">2.0.0</p>
              </div>
              <div>
                <span className="text-muted-foreground">Last Refresh</span>
                <p className="font-medium">{new Date().toLocaleTimeString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Auto-Refresh</span>
                <p className="font-medium">{autoRefresh ? "Enabled (2s)" : "Disabled"}</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
