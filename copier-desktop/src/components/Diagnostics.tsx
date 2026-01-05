import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
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
} from "lucide-react";
import { DiagnosticsInfo, TerminalDiagnostic, ErrorEntry } from "../types";

export default function Diagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchDiagnostics = async () => {
    try {
      const data = await invoke<DiagnosticsInfo>("get_diagnostics");
      setDiagnostics(data);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch diagnostics: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
    
    if (autoRefresh) {
      const interval = setInterval(fetchDiagnostics, 2000);
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
                  
                  return (
                    <div key={terminal.terminal_id} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">
                              {terminal.broker || "Unknown Broker"}
                            </span>
                            {terminal.account && (
                              <span className="text-muted-foreground">
                                - {terminal.account}
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
                            
                            {/* Terminal ID */}
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
