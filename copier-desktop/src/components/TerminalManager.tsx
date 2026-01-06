import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Mt5Terminal, TerminalInfo } from "../types";

interface TerminalManagerProps {
  onTerminalSelect?: (terminalId: string) => void;
}

export default function TerminalManager({ onTerminalSelect }: TerminalManagerProps) {
  const [terminals, setTerminals] = useState<Mt5Terminal[]>([]);
  const [discoveryInfo, setDiscoveryInfo] = useState<TerminalInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const scanTerminals = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use enhanced discovery for better install_label support
      const result = await invoke<TerminalInfo[]>("discover_terminals");
      setDiscoveryInfo(result);
      
      // Convert to Mt5Terminal format for compatibility
      const converted: Mt5Terminal[] = result.map(t => ({
        terminal_id: t.terminal_id,
        path: t.data_folder,
        broker: t.broker,
        has_mql5: t.has_mql5,
        master_installed: t.master_installed,
        receiver_installed: t.receiver_installed,
        account_info: t.login ? {
          account_number: t.login.toString(),
          broker: t.broker || "",
          balance: 0,
          equity: 0,
          margin: 0,
          free_margin: 0,
          leverage: 0,
          currency: "USD",
          server: t.server || "",
        } : null,
        last_heartbeat: t.last_heartbeat,
      }));
      
      setTerminals(converted);
    } catch (err) {
      // Fallback to old method
      try {
        const result = await invoke<Mt5Terminal[]>("find_terminals");
        setTerminals(result);
      } catch (fallbackErr) {
        setError(`Failed to scan terminals: ${fallbackErr}`);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    scanTerminals();
  }, []);

  const installEa = async (terminalId: string, eaType: "master" | "receiver") => {
    setInstalling(`${terminalId}-${eaType}`);
    setError(null);
    setSuccess(null);
    
    try {
      const path = await invoke<string>("install_ea", {
        terminalId,
        eaType,
      });
      setSuccess(`EA installed successfully to: ${path}`);
      // Refresh terminal list to update install status
      await scanTerminals();
    } catch (err) {
      setError(`Failed to install EA: ${err}`);
    } finally {
      setInstalling(null);
    }
  };

  const shortenId = (id: string) => {
    if (id.length > 12) {
      return `${id.slice(0, 6)}...${id.slice(-4)}`;
    }
    return id;
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">MT5 Terminals</h2>
        <button
          onClick={scanTerminals}
          disabled={loading}
          className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Scanning..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-600">
          {success}
          <p className="mt-2 text-xs text-muted-foreground">
            Next steps: Open MT5 → Navigator → Expert Advisors → Right-click → Refresh → Drag EA to chart
          </p>
        </div>
      )}

      {loading && terminals.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : terminals.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No MT5 terminals found</p>
          <p className="text-xs mt-2">
            Make sure MT5 is installed in the default location
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {terminals.map((terminal) => {
            // Get discovery info for this terminal
            const info = discoveryInfo.find(d => d.terminal_id === terminal.terminal_id);
            const isVerified = info?.verified === true;
            // Use install_label pre-EA, broker post-EA
            const displayName = isVerified 
              ? (info?.broker || terminal.broker || info?.install_label || "MT5 Terminal")
              : (info?.install_label || terminal.broker || "MT5 Terminal");
            
            return (
              <div
                key={terminal.terminal_id}
                className="p-3 bg-card border border-border rounded-lg"
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">
                      {displayName}
                      {terminal.account_info?.account_number && (
                        <span className="text-muted-foreground font-normal"> - {terminal.account_info.account_number}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ID: {shortenId(terminal.terminal_id)}
                      {!isVerified && (
                        <span className="ml-2 text-amber-500">(attach EA to verify)</span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {terminal.master_installed && (
                      <span className="px-2 py-0.5 text-xs bg-blue-500/10 text-blue-500 rounded">
                        Master
                      </span>
                    )}
                    {terminal.receiver_installed && (
                      <span className="px-2 py-0.5 text-xs bg-purple-500/10 text-purple-500 rounded">
                        Receiver
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => installEa(terminal.terminal_id, "master")}
                    disabled={installing !== null}
                    className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
                      terminal.master_installed
                        ? "bg-muted text-muted-foreground hover:bg-muted/80"
                        : "bg-blue-500 text-white hover:bg-blue-600"
                    } disabled:opacity-50`}
                  >
                    {installing === `${terminal.terminal_id}-master` ? (
                      <span className="flex items-center justify-center gap-1">
                        <span className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full" />
                        Installing...
                      </span>
                    ) : terminal.master_installed ? (
                      "Reinstall Master"
                    ) : (
                      "Install Master EA"
                    )}
                  </button>

                  <button
                    onClick={() => installEa(terminal.terminal_id, "receiver")}
                    disabled={installing !== null}
                    className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
                      terminal.receiver_installed
                        ? "bg-muted text-muted-foreground hover:bg-muted/80"
                        : "bg-purple-500 text-white hover:bg-purple-600"
                    } disabled:opacity-50`}
                  >
                    {installing === `${terminal.terminal_id}-receiver` ? (
                      <span className="flex items-center justify-center gap-1">
                        <span className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full" />
                        Installing...
                      </span>
                    ) : terminal.receiver_installed ? (
                      "Reinstall Receiver"
                    ) : (
                      "Install Receiver EA"
                    )}
                  </button>
                </div>

                {onTerminalSelect && (
                  <button
                    onClick={() => onTerminalSelect(terminal.terminal_id)}
                    className="w-full mt-2 px-3 py-1.5 text-xs border border-border rounded hover:bg-accent"
                  >
                    Use this terminal
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          <strong>How it works:</strong>
        </p>
        <ol className="text-xs text-muted-foreground mt-2 space-y-1 list-decimal list-inside">
          <li>Click "Install Master EA" on your main trading account</li>
          <li>Click "Install Receiver EA" on accounts you want to copy to</li>
          <li>Open each MT5 terminal and compile the EA (right-click → Compile)</li>
          <li>Drag the EA onto any chart and configure settings</li>
        </ol>
      </div>
    </div>
  );
}
