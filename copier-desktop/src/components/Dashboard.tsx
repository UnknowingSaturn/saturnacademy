import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  DollarSign,
  Pause,
  Play,
  RefreshCw,
  Square,
  TrendingUp,
  XCircle,
  TestTube2,
} from "lucide-react";
import { CopierStatus, Execution, Mt5Terminal, MasterHeartbeat } from "../types";
import EAStatusBadge, { getEAStatus, formatHeartbeatAge } from "./EAStatusBadge";
import ErrorDisplay from "./ErrorDisplay";

interface DashboardProps {
  status: CopierStatus | null;
  executions: Execution[];
  masterHeartbeat: MasterHeartbeat | null;
  receiverTerminals: Mt5Terminal[];
  onPauseReceiver: (terminalId: string) => void;
  onResumeReceiver: (terminalId: string) => void;
}

export default function Dashboard({
  status,
  executions,
  masterHeartbeat,
  receiverTerminals,
  onPauseReceiver,
  onResumeReceiver,
}: DashboardProps) {
  const [testingCopy, setTestingCopy] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSync = async () => {
    try {
      await invoke("sync_config");
    } catch (error) {
      console.error("Sync failed:", error);
    }
  };

  const handleStart = async () => {
    try {
      await invoke("start_copier");
    } catch (error) {
      console.error("Start failed:", error);
    }
  };

  const handleStop = async () => {
    try {
      await invoke("stop_copier");
    } catch (error) {
      console.error("Stop failed:", error);
    }
  };

  const handleTestCopy = async () => {
    setTestingCopy(true);
    setTestResult(null);
    try {
      const result = await invoke<{ success: boolean; message: string }>("test_copy");
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, message: `Test failed: ${error}` });
    } finally {
      setTestingCopy(false);
    }
  };

  // Check if we have any demo accounts (for test copy feature)
  const hasDemoAccount = receiverTerminals.some(
    (t) => t.account_info?.account_number?.toString().startsWith("5") // Demo accounts often start with 5
  );

  const masterStatus = getEAStatus(masterHeartbeat?.timestamp_utc);
  const heartbeatAge = formatHeartbeatAge(masterHeartbeat?.timestamp_utc);

  const recentExecutions = executions.slice(0, 5);
  const successCount = executions.filter(e => e.status === "success").length;
  const failedCount = executions.filter(e => e.status === "failed").length;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Master Status Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Master Connection */}
        <div className="bg-card rounded-xl border border-border p-5 col-span-1 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">Master Status</h3>
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ${
                    status?.is_running
                      ? "status-online animate-pulse"
                      : status?.is_connected
                      ? "status-warning"
                      : "status-offline"
                  }`}
                />
                <span className="text-xl font-semibold">
                  {status?.is_running ? "Running" : status?.is_connected ? "Connected" : "Disconnected"}
                </span>
                <EAStatusBadge status={masterStatus} lastHeartbeat={masterHeartbeat?.timestamp_utc} />
              </div>
              {masterHeartbeat && (
                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                  <span>Account: {masterHeartbeat.account}</span>
                  <span>Balance: ${masterHeartbeat.balance?.toLocaleString()}</span>
                  <span>Equity: ${masterHeartbeat.equity?.toLocaleString()}</span>
                </div>
              )}
              <div className={`flex items-center gap-1.5 mt-2 text-xs ${masterStatus === "stale" ? "text-yellow-500" : masterStatus === "offline" ? "text-red-400" : "text-muted-foreground"}`}>
                <Clock className="w-3 h-3" />
                <span>Last heartbeat: {heartbeatAge}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSync}
                className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Sync Configuration"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              
              {status?.is_running ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 px-4 py-2 bg-destructive/20 text-red-400 rounded-lg text-sm hover:bg-destructive/30 transition-colors"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={!status?.is_connected}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" />
                  Start
                </button>
              )}
            </div>
          </div>

          {status?.last_error && (
            <div className="mt-4">
              <ErrorDisplay error={status.last_error} showSuggestion={true} />
            </div>
          )}

          {/* Test Copy Result */}
          {testResult && (
            <div className={`flex items-start gap-2 mt-4 p-3 rounded-lg ${
              testResult.success ? "bg-green-500/10" : "bg-red-500/10"
            }`}>
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              )}
              <span className={`text-sm ${testResult.success ? "text-green-400" : "text-red-400"}`}>
                {testResult.message}
              </span>
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Today's Stats</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Activity className="w-4 h-4" />
                <span className="text-sm">Trades</span>
              </div>
              <span className="text-lg font-semibold">{status?.trades_today ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <DollarSign className="w-4 h-4" />
                <span className="text-sm">P&L</span>
              </div>
              <span className={`text-lg font-semibold ${(status?.pnl_today ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                ${(status?.pnl_today ?? 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm">Open</span>
              </div>
              <span className="text-lg font-semibold">{status?.open_positions ?? 0}</span>
            </div>
          </div>

          {/* Test Copy Button */}
          {hasDemoAccount && (
            <div className="mt-4 pt-3 border-t border-border">
              <button
                onClick={handleTestCopy}
                disabled={testingCopy || !status?.is_running}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-secondary/50 text-foreground rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <TestTube2 className="w-4 h-4" />
                {testingCopy ? "Testing..." : "Test Copy (Demo)"}
              </button>
              <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                Opens &amp; closes 0.01 lot test trade
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Receiver Health Grid */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">Receiver Accounts</h3>
          <span className="text-xs text-muted-foreground">{receiverTerminals.length} connected</span>
        </div>

        {receiverTerminals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No receiver accounts configured</p>
            <p className="text-xs mt-1">Run the setup wizard to add receivers</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {receiverTerminals.map((terminal) => (
              <div
                key={terminal.terminal_id}
                className="bg-secondary/30 rounded-lg p-4 hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm truncate max-w-[150px]">
                      {terminal.broker || "Unknown Broker"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {terminal.account_info?.account_number || terminal.terminal_id.slice(0, 8)}
                    </div>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-green-500" title="Online" />
                </div>
                
                {terminal.account_info && (
                  <div className="text-xs text-muted-foreground space-y-1 mt-3">
                    <div className="flex justify-between">
                      <span>Balance:</span>
                      <span className="text-foreground">${terminal.account_info.balance.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Equity:</span>
                      <span className="text-foreground">${terminal.account_info.equity.toLocaleString()}</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => onPauseReceiver(terminal.terminal_id)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-secondary/50 rounded hover:bg-secondary transition-colors"
                  >
                    <Pause className="w-3 h-3" />
                    Pause
                  </button>
                  <button
                    onClick={() => onResumeReceiver(terminal.terminal_id)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    Resume
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">Recent Activity</h3>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-green-500">
              <CheckCircle2 className="w-3 h-3" />
              {successCount} success
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <XCircle className="w-3 h-3" />
              {failedCount} failed
            </span>
          </div>
        </div>

        {recentExecutions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No recent activity</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentExecutions.map((exec) => (
              <div
                key={exec.id}
                className="flex items-center gap-3 p-3 bg-secondary/30 rounded-lg"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    exec.status === "success"
                      ? "bg-green-500/20"
                      : exec.status === "failed"
                      ? "bg-red-500/20"
                      : "bg-yellow-500/20"
                  }`}
                >
                  {exec.direction === "buy" ? (
                    <ArrowUpRight className={`w-4 h-4 ${exec.status === "success" ? "text-green-500" : "text-red-500"}`} />
                  ) : (
                    <ArrowDownRight className={`w-4 h-4 ${exec.status === "success" ? "text-green-500" : "text-red-500"}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{exec.symbol}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${exec.direction === "buy" ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"}`}>
                      {exec.direction.toUpperCase()}
                    </span>
                    <span className="text-xs text-muted-foreground">{exec.event_type}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {exec.master_lots} → {exec.receiver_lots} lots
                    {exec.slippage_pips !== null && ` • ${exec.slippage_pips.toFixed(1)} pips slip`}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-xs font-medium ${
                    exec.status === "success" ? "text-green-500" : exec.status === "failed" ? "text-red-500" : "text-yellow-500"
                  }`}>
                    {exec.status}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(exec.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}