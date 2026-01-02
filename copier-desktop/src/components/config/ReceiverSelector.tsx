import { Settings, Check } from "lucide-react";
import { Mt5Terminal, ReceiverHealth } from "../../types";

interface ReceiverSelectorProps {
  receivers: Mt5Terminal[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  receiverHealth?: Map<string, ReceiverHealth>;
  hasCustomConfig?: Map<string, boolean>;
}

export function ReceiverSelector({ 
  receivers, 
  selectedId, 
  onSelect,
  receiverHealth,
  hasCustomConfig
}: ReceiverSelectorProps) {
  const getHealthStatus = (terminalId: string) => {
    const health = receiverHealth?.get(terminalId);
    if (!health) return { online: false, lastSeen: null };
    
    // Handle undefined last_heartbeat
    if (!health.last_heartbeat) {
      return { online: false, lastSeen: null };
    }
    
    const lastSeen = new Date(health.last_heartbeat);
    const diffMs = Date.now() - lastSeen.getTime();
    return { 
      online: diffMs < 30000, 
      lastSeen: health.last_heartbeat 
    };
  };

  const formatLastSeen = (timestamp: string | null) => {
    if (!timestamp) return "Never";
    const diff = Date.now() - new Date(timestamp).getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return "Offline";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Receiver Accounts</h3>
        <span className="text-xs text-muted-foreground">
          {receivers.length} configured
        </span>
      </div>

      {receivers.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <Settings className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No receivers configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            Run the setup wizard to add receiver accounts
          </p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto">
          {receivers.map(receiver => {
            const isSelected = selectedId === receiver.terminal_id;
            const { online, lastSeen } = getHealthStatus(receiver.terminal_id);
            const hasCustom = hasCustomConfig?.get(receiver.terminal_id) ?? false;

            return (
              <button
                key={receiver.terminal_id}
                onClick={() => onSelect(receiver.terminal_id)}
                className={`w-full glass-card p-3 text-left transition-all ${
                  isSelected 
                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" 
                    : "hover:border-border/80"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Status Indicator */}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    online ? "bg-profit status-online" : "bg-loss status-offline"
                  }`} />

                  {/* Account Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {receiver.account_info?.broker || "Unknown Broker"}
                      </span>
                      {hasCustom && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary flex-shrink-0">
                          Custom
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        #{receiver.account_info?.account_number || "N/A"}
                      </span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className={`text-xs ${online ? "text-profit" : "text-muted-foreground"}`}>
                        {formatLastSeen(lastSeen)}
                      </span>
                    </div>
                  </div>

                  {/* Selection Indicator */}
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  )}
                </div>

                {/* Balance (if available) */}
                {receiver.account_info?.balance && (
                  <div className="mt-2 pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Balance</span>
                      <span className="font-medium">
                        ${receiver.account_info.balance.toLocaleString(undefined, { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Global Defaults Button */}
      <div className="pt-4 border-t border-border">
        <button
          onClick={() => onSelect("global")}
          className={`w-full glass-card p-3 text-left transition-all ${
            selectedId === "global" 
              ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" 
              : "hover:border-border/80"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20">
              <Settings className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1">
              <span className="text-sm font-medium">Global Defaults</span>
              <p className="text-xs text-muted-foreground">
                Settings that apply to all receivers
              </p>
            </div>
            {selectedId === "global" && (
              <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <Check className="w-3 h-3 text-primary-foreground" />
              </div>
            )}
          </div>
        </button>
      </div>
    </div>
  );
}
