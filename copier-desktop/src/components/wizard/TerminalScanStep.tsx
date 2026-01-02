import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";
import { FolderOpen } from "lucide-react";
import { Mt5Terminal } from "../../types";

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

  const scanTerminals = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Mt5Terminal[]>("find_terminals");
      onTerminalsFound(result);
    } catch (err) {
      setError(`Failed to scan: ${err}`);
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

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Detect MT5 Terminals</h2>
        <p className="text-sm text-muted-foreground">
          Open all MetaTrader 5 terminals you want to use, then click Refresh
        </p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
          <p className="text-sm text-muted-foreground mt-4">Scanning for terminals...</p>
        </div>
      ) : terminals.length === 0 ? (
        <div className="text-center py-8 bg-muted/50 rounded-lg">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm font-medium">No MT5 terminals found</p>
          <p className="text-xs text-muted-foreground mt-2">
            Make sure MT5 is installed and try again, or add manually
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium">Found {terminals.length} terminal{terminals.length !== 1 ? 's' : ''}:</p>
          {terminals.map((terminal) => {
            const displayName = terminal.account_info?.broker || terminal.broker || "MT5 Terminal";
            const accountNum = terminal.account_info?.account_number;
            const balance = terminal.account_info?.balance;
            
            return (
              <div
                key={terminal.terminal_id}
                className="p-4 bg-card border border-border rounded-lg flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {displayName}
                    {accountNum && <span className="text-muted-foreground"> - {accountNum}</span>}
                    {!terminal.broker && !terminal.account_info?.broker && (
                      <span className="ml-2 text-amber-500 text-xs">(run EA to detect)</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <span>ID: {shortenId(terminal.terminal_id)}</span>
                    {balance !== undefined && (
                      <>
                        <span>•</span>
                        <span className="text-green-500 font-medium">
                          ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </>
                    )}
                    {terminal.master_installed && (
                      <>
                        <span>•</span>
                        <span className="text-blue-500">Master EA</span>
                      </>
                    )}
                    {terminal.receiver_installed && (
                      <>
                        <span>•</span>
                        <span className="text-purple-500">Receiver EA</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  {terminal.account_info ? (
                    <div className="w-3 h-3 rounded-full bg-green-500" title="Connected" />
                  ) : (
                    <div className="w-3 h-3 rounded-full bg-yellow-500" title="EA not running" />
                  )}
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
          Use this if your terminal wasn't auto-detected (e.g., portable installs)
        </p>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          onClick={scanTerminals}
          disabled={loading}
          className="flex-1 px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent disabled:opacity-50"
        >
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
