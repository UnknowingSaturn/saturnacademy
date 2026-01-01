import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { PositionDiscrepancy, PositionSyncStatus } from "../types";

interface PositionSyncDialogProps {
  masterTerminalId: string;
  receiverTerminalIds: string[];
  isOpen: boolean;
  onClose: () => void;
}

export default function PositionSyncDialog({
  masterTerminalId,
  receiverTerminalIds,
  isOpen,
  onClose,
}: PositionSyncDialogProps) {
  const [syncStatus, setSyncStatus] = useState<PositionSyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      loadSyncStatus();
    }
  }, [isOpen, masterTerminalId, receiverTerminalIds]);

  const loadSyncStatus = async () => {
    setLoading(true);
    setError(null);

    try {
      const status = await invoke<PositionSyncStatus>("get_position_sync_status", {
        masterTerminalId,
        receiverTerminalIds,
      });
      setSyncStatus(status);
    } catch (err) {
      console.error("Failed to load sync status:", err);
      setError(err as string);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncPosition = async (
    discrepancy: PositionDiscrepancy,
    action: "open" | "close"
  ) => {
    const key = `${discrepancy.receiver_id}_${discrepancy.master_position?.position_id || discrepancy.receiver_position?.position_id}`;
    setSyncing((prev) => ({ ...prev, [key]: true }));

    try {
      if (action === "open" && discrepancy.master_position) {
        await invoke("sync_position_to_receiver", {
          receiverTerminalId: discrepancy.receiver_id,
          command: {
            command_type: "open",
            master_position_id: discrepancy.master_position.position_id,
            symbol: discrepancy.master_position.symbol,
            direction: discrepancy.master_position.direction,
            volume: discrepancy.master_position.volume,
            sl: discrepancy.master_position.sl,
            tp: discrepancy.master_position.tp,
          },
        });
      } else if (action === "close" && discrepancy.receiver_position) {
        await invoke("sync_position_to_receiver", {
          receiverTerminalId: discrepancy.receiver_id,
          command: {
            command_type: "close",
            position_id: discrepancy.receiver_position.position_id,
          },
        });
      }

      // Reload sync status
      await loadSyncStatus();
    } catch (err) {
      console.error("Failed to sync position:", err);
      setError(err as string);
    } finally {
      setSyncing((prev) => ({ ...prev, [key]: false }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Position Sync</h2>
            <p className="text-sm text-muted-foreground">
              Review and sync positions between master and receivers
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <span className="animate-spin text-2xl">⏳</span>
              <span className="ml-2">Loading positions...</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}

          {syncStatus && !loading && (
            <>
              {/* Master Positions */}
              <div>
                <h3 className="text-sm font-medium mb-2">
                  Master Positions ({syncStatus.master_positions.length})
                </h3>
                {syncStatus.master_positions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open positions</p>
                ) : (
                  <div className="space-y-2">
                    {syncStatus.master_positions.map((pos) => (
                      <div
                        key={pos.position_id}
                        className="p-3 bg-muted/50 rounded-lg flex items-center justify-between"
                      >
                        <div>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            pos.direction === "buy" 
                              ? "bg-green-500/20 text-green-600" 
                              : "bg-red-500/20 text-red-600"
                          }`}>
                            {pos.direction.toUpperCase()}
                          </span>
                          <span className="ml-2 font-medium">{pos.symbol}</span>
                          <span className="ml-2 text-muted-foreground">{pos.volume} lots</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          ID: {pos.position_id}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Discrepancies */}
              {syncStatus.discrepancies.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2 text-yellow-600">
                    ⚠️ Discrepancies ({syncStatus.discrepancies.length})
                  </h3>
                  <div className="space-y-2">
                    {syncStatus.discrepancies.map((disc, idx) => {
                      const key = `${disc.receiver_id}_${disc.master_position?.position_id || disc.receiver_position?.position_id}`;
                      const isSyncing = syncing[key];

                      return (
                        <div
                          key={idx}
                          className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <span className="text-xs font-medium text-yellow-600 capitalize">
                                {disc.discrepancy_type.replace(/([A-Z])/g, " $1").trim()}
                              </span>
                              <p className="text-sm mt-1">{disc.suggested_action}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Receiver: {disc.receiver_id.slice(0, 8)}...
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {disc.discrepancy_type === "MissingOnReceiver" && (
                                <button
                                  onClick={() => handleSyncPosition(disc, "open")}
                                  disabled={isSyncing}
                                  className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                                >
                                  {isSyncing ? "..." : "Open"}
                                </button>
                              )}
                              {disc.discrepancy_type === "OrphanedOnReceiver" && (
                                <button
                                  onClick={() => handleSyncPosition(disc, "close")}
                                  disabled={isSyncing}
                                  className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                                >
                                  {isSyncing ? "..." : "Close"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {syncStatus.discrepancies.length === 0 && (
                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
                  <span className="text-2xl">✓</span>
                  <p className="text-sm text-green-600 mt-1">All positions are in sync!</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-between">
          <button
            onClick={loadSyncStatus}
            disabled={loading}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
