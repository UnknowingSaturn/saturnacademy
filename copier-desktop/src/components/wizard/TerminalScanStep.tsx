import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { FolderOpen, RefreshCw, Monitor, CheckCircle2, AlertCircle, Cpu } from "lucide-react";
import { Mt5Terminal, TerminalInfo } from "../../types";

interface TerminalScanStepProps {
  terminals: Mt5Terminal[];
  onTerminalsFound: (terminals: Mt5Terminal[]) => void;
  onContinue: () => void;
}

export default function TerminalScanStep({
  terminals,
  onTerminalsFound,
  onContinue,
}: TerminalScanStepProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingManual, setAddingManual] = useState(false);
  const [discoveryInfo, setDiscoveryInfo] = useState<TerminalInfo[]>([]);

  const scanTerminals = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use enhanced discovery
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
      
      onTerminalsFound(converted);
    } catch (err) {
      // Fallback to old method
      try {
        const result = await invoke<Mt5Terminal[]>("find_terminals");
        onTerminalsFound(result);
      } catch (fallbackErr) {
        setError(`Failed to scan: ${fallbackErr}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddManualPath = async () => {
    setAddingManual(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select MT5 Terminal Folder (containing terminal64.exe)",
      });
      
      if (selected && typeof selected === "string") {
        // Call backend to validate and add this terminal
        const terminal = await invoke<Mt5Terminal | null>("add_terminal_path", { 
          path: selected 
        });
        
        if (terminal) {
          // Add to existing terminals list
          onTerminalsFound([...terminals, terminal]);
        } else {
          setError("Selected folder is not a valid MT5 terminal. Make sure it contains terminal64.exe");
        }
      }
    } catch (err) {
      setError(`Failed to add terminal: ${err}`);
    } finally {
      setAddingManual(false);
    }
  };

  useEffect(() => {
    scanTerminals();
  }, []);

  const shortenId = (id: string) => {
    if (id.length > 12) {
      return `${id.slice(0, 6)}...${id.slice(-4)}`;
    }
    return id;
  };

  const getDiscoveryMethodLabel = (method: string) => {
    switch (method) {
      case "process": return "Running";
      case "registry": return "Registry";
      case "app_data": return "AppData";
      case "common_path": return "Path";
      case "manual": return "Manual";
      default: return method;
    }
  };

  const getDiscoveryMethodColor = (method: string) => {
    switch (method) {
      case "process": return "text-green-500 bg-green-500/10";
      case "registry": return "text-blue-500 bg-blue-500/10";
      case "app_data": return "text-purple-500 bg-purple-500/10";
      case "manual": return "text-cyan-500 bg-cyan-500/10";
      default: return "text-muted-foreground bg-muted";
    }
  };

  // Merge discovery info with terminals for display
  const terminalsWithInfo = terminals.map(t => {
    const info = discoveryInfo.find(d => d.terminal_id === t.terminal_id);
    return { ...t, discoveryInfo: info };
  });

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Detect MT5 Terminals</h2>
        <p className="text-sm text-muted-foreground">
          We scan running processes, registry, AppData, and common paths
        </p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground mt-4">Scanning for terminals...</p>
          <p className="text-xs text-muted-foreground mt-1">Checking processes, registry, and common paths</p>
        </div>
      ) : terminalsWithInfo.length === 0 ? (
        <div className="text-center py-8 bg-muted/50 rounded-lg">
          <Cpu className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No MT5 terminals found</p>
          <p className="text-xs text-muted-foreground mt-2">
            Make sure MT5 is installed and try again, or add manually
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <Monitor className="w-4 h-4" />
            Found {terminalsWithInfo.length} terminal{terminalsWithInfo.length !== 1 ? 's' : ''}
          </p>
          {terminalsWithInfo.map((terminal) => {
            const displayName = terminal.account_info?.broker || terminal.broker || "MT5 Terminal";
            const accountNum = terminal.account_info?.account_number;
            const server = terminal.discoveryInfo?.server;
            const isRunning = terminal.discoveryInfo?.is_running;
            const discoveryMethod = terminal.discoveryInfo?.discovery_method || "app_data";
            
            return (
              <div
                key={terminal.terminal_id}
                className="p-4 bg-card border border-border rounded-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">
                        {displayName}
                      </p>
                      {accountNum && (
                        <span className="text-muted-foreground">#{accountNum}</span>
                      )}
                      {!terminal.broker && !terminal.account_info?.broker && (
                        <span className="text-amber-500 text-xs bg-amber-500/10 px-1.5 py-0.5 rounded">
                          Attach EA to identify
                        </span>
                      )}
                    </div>
                    {server && (
                      <p className="text-xs text-muted-foreground mt-0.5">{server}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs mt-2">
                      {/* Discovery method badge */}
                      <span className={`px-1.5 py-0.5 rounded ${getDiscoveryMethodColor(discoveryMethod)}`}>
                        {getDiscoveryMethodLabel(discoveryMethod)}
                      </span>
                      
                      {/* Running status */}
                      {isRunning && (
                        <span className="text-green-500 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          Running
                        </span>
                      )}
                      
                      {/* Terminal ID */}
                      <span className="text-muted-foreground font-mono">
                        ID: {shortenId(terminal.terminal_id)}
                      </span>
                      
                      {/* EA badges */}
                      {terminal.master_installed && (
                        <span className="text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">
                          Master EA
                        </span>
                      )}
                      {terminal.receiver_installed && (
                        <span className="text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded">
                          Receiver EA
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Connection status indicator */}
                  <div className="flex items-center">
                    {terminal.account_info ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-yellow-500" title="EA not connected" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Add Section */}
      <div className="border-t border-border pt-4">
        <button
          onClick={handleAddManualPath}
          disabled={addingManual}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm border border-dashed border-border rounded-lg hover:bg-accent disabled:opacity-50 text-muted-foreground hover:text-foreground transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          {addingManual ? "Selecting..." : "Add Terminal Manually"}
        </button>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Use this if your terminal wasn't auto-detected (e.g., custom install paths)
        </p>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          onClick={scanTerminals}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Scanning..." : "Refresh"}
        </button>
        <button
          onClick={onContinue}
          disabled={terminals.length === 0 || loading}
          className="flex-1 px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
