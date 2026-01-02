import { Wifi, WifiOff, Clock, AlertTriangle } from "lucide-react";

export type EAStatus = "online" | "stale" | "offline";

interface EAStatusBadgeProps {
  status: EAStatus;
  lastHeartbeat?: string | null;
  compact?: boolean;
}

/**
 * Calculates EA status based on heartbeat timestamp
 * Online: < 30 seconds ago
 * Stale: 30 seconds - 5 minutes ago
 * Offline: > 5 minutes ago or no heartbeat
 */
export function getEAStatus(lastHeartbeat?: string | null): EAStatus {
  if (!lastHeartbeat) return "offline";
  
  const diff = Date.now() - new Date(lastHeartbeat).getTime();
  
  if (diff < 30000) return "online";      // < 30 seconds
  if (diff < 300000) return "stale";      // < 5 minutes
  return "offline";                        // > 5 minutes
}

/**
 * Formats heartbeat age as human-readable string
 */
export function formatHeartbeatAge(lastHeartbeat?: string | null): string {
  if (!lastHeartbeat) return "Never";
  
  const diff = Date.now() - new Date(lastHeartbeat).getTime();
  
  if (diff < 5000) return "Just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return "Offline";
}

export default function EAStatusBadge({ 
  status, 
  lastHeartbeat,
  compact = false 
}: EAStatusBadgeProps) {
  const config = {
    online: {
      icon: Wifi,
      label: "Online",
      bgClass: "bg-green-500/15",
      textClass: "text-green-500",
      dotClass: "status-online",
    },
    stale: {
      icon: AlertTriangle,
      label: "Stale",
      bgClass: "bg-yellow-500/15",
      textClass: "text-yellow-500",
      dotClass: "status-warning",
    },
    offline: {
      icon: WifiOff,
      label: "Offline",
      bgClass: "bg-red-500/15",
      textClass: "text-red-500",
      dotClass: "status-offline",
    },
  }[status];

  const Icon = config.icon;
  const age = formatHeartbeatAge(lastHeartbeat);

  if (compact) {
    return (
      <div 
        className={`w-2.5 h-2.5 rounded-full ${config.dotClass}`}
        title={`${config.label} - ${age}`}
      />
    );
  }

  return (
    <div 
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${config.bgClass} ${config.textClass}`}
      title={`Last heartbeat: ${age}`}
    >
      <Icon className="w-3 h-3" />
      <span>{config.label}</span>
      {status !== "offline" && (
        <span className="text-[10px] opacity-70 flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          {age}
        </span>
      )}
    </div>
  );
}
