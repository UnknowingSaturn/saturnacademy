import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { MasterPosition, MasterHeartbeat } from "../types";

interface PositionsPanelProps {
  masterTerminalId: string;
  receiverTerminalIds: string[];
}

export default function PositionsPanel({
  masterTerminalId,
  receiverTerminalIds,
}: PositionsPanelProps) {
  const [positions, setPositions] = useState<MasterPosition[]>([]);
  const [heartbeat, setHeartbeat] = useState<MasterHeartbeat | null>(null);
  const [isMasterOnline, setIsMasterOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [masterTerminalId]);

  const loadData = async () => {
    try {
      // Check if master is online
      const online = await invoke<boolean>("check_master_online", {
        terminalId: masterTerminalId,
      });
      setIsMasterOnline(online);

      // Get heartbeat
      try {
        const hb = await invoke<MasterHeartbeat>("get_master_heartbeat", {
          terminalId: masterTerminalId,
        });
        setHeartbeat(hb);
      } catch {
        setHeartbeat(null);
      }

      // Get positions from sync status
      try {
        const status = await invoke<{ master_positions: MasterPosition[] }>(
          "get_position_sync_status",
          {
            masterTerminalId,
            receiverTerminalIds,
          }
        );
        setPositions(status.master_positions);
      } catch {
        setPositions([]);
      }

      setError(null);
    } catch (err) {
      setError(err as string);
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalPnL = () => {
    // This would need actual P&L data from positions
    return 0;
  };

  return (
    <div className="p-4 space-y-4">
      {/* Master Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-3 h-3 rounded-full ${
              isMasterOnline ? "bg-green-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <div>
            <p className="text-sm font-medium">
              Master {isMasterOnline ? "Online" : "Offline"}
            </p>
            {heartbeat && (
              <p className="text-xs text-muted-foreground">
                Account: {heartbeat.account} • Balance: ${heartbeat.balance.toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={loadData}
          className="p-2 hover:bg-muted rounded-lg text-sm"
        >
          ⟳ Refresh
        </button>
      </div>

      {/* Account Summary */}
      {heartbeat && (
        <div className="grid grid-cols-3 gap-4">
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Balance</p>
            <p className="text-lg font-semibold">${heartbeat.balance.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Equity</p>
            <p className="text-lg font-semibold">${heartbeat.equity.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Open Positions</p>
            <p className="text-lg font-semibold">{heartbeat.open_positions}</p>
          </div>
        </div>
      )}

      {/* Positions Table */}
      <div>
        <h3 className="text-sm font-medium mb-2">Open Positions</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="animate-spin text-xl">⏳</span>
          </div>
        ) : positions.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
            <p className="text-sm">No open positions</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium">Symbol</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">Direction</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">Volume</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">Entry</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">SL</th>
                  <th className="px-3 py-2 text-right text-xs font-medium">TP</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.position_id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{pos.symbol}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 text-xs rounded ${
                          pos.direction === "buy"
                            ? "bg-green-500/20 text-green-600"
                            : "bg-red-500/20 text-red-600"
                        }`}
                      >
                        {pos.direction.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{pos.volume}</td>
                    <td className="px-3 py-2 text-right font-mono">{pos.open_price.toFixed(5)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-500">
                      {pos.sl > 0 ? pos.sl.toFixed(5) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-green-500">
                      {pos.tp > 0 ? pos.tp.toFixed(5) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}
    </div>
  );
}
