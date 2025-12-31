import { invoke } from "@tauri-apps/api/tauri";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Play,
  RefreshCw,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import { CopierStatus } from "../types";

interface StatusPanelProps {
  status: CopierStatus | null;
}

export default function StatusPanel({ status }: StatusPanelProps) {
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

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Connection Status */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {status?.is_connected ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
            <span className="text-sm font-medium">
              {status?.is_connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <button
            onClick={handleSync}
            className="p-1.5 hover:bg-secondary rounded-md transition-colors"
            title="Sync Configuration"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {status?.last_sync && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Last sync: {formatTime(status.last_sync)}</span>
          </div>
        )}

        {status?.config_version > 0 && (
          <div className="text-xs text-muted-foreground mt-1">
            Config v{status.config_version}
          </div>
        )}
      </div>

      {/* Copier Controls */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity
              className={`w-4 h-4 ${
                status?.is_running ? "text-green-500" : "text-muted-foreground"
              }`}
            />
            <span className="text-sm font-medium">
              {status?.is_running ? "Running" : "Stopped"}
            </span>
          </div>

          {status?.is_running ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive/20 text-red-400 rounded-md text-sm hover:bg-destructive/30 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!status?.is_connected}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-3.5 h-3.5" />
              Start
            </button>
          )}
        </div>

        {status?.last_error && (
          <div className="text-xs text-red-400 bg-red-500/10 rounded p-2 mt-2">
            {status.last_error}
          </div>
        )}
      </div>

      {/* Today's Stats */}
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium mb-3">Today's Activity</h3>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Trades"
            value={status?.trades_today ?? 0}
            icon={Activity}
          />
          <StatCard
            label="P&L"
            value={`$${(status?.pnl_today ?? 0).toFixed(2)}`}
            icon={status?.pnl_today && status.pnl_today >= 0 ? ArrowUpRight : ArrowDownRight}
            positive={status?.pnl_today ? status.pnl_today >= 0 : undefined}
          />
          <StatCard
            label="Open"
            value={status?.open_positions ?? 0}
            icon={Activity}
          />
          <StatCard label="Config" value={`v${status?.config_version ?? 0}`} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  positive,
}: {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  positive?: boolean;
}) {
  return (
    <div className="bg-secondary/50 rounded-md p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon && (
          <Icon
            className={`w-3.5 h-3.5 ${
              positive === true
                ? "text-green-500"
                : positive === false
                ? "text-red-500"
                : "text-muted-foreground"
            }`}
          />
        )}
      </div>
      <div
        className={`text-lg font-semibold mt-1 ${
          positive === true
            ? "text-green-500"
            : positive === false
            ? "text-red-500"
            : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
