import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
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
            Make sure MT5 is installed and try again
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium">Found {terminals.length} terminal{terminals.length !== 1 ? 's' : ''}:</p>
          {terminals.map((terminal) => (
            <div
              key={terminal.terminal_id}
              className="p-4 bg-card border border-border rounded-lg flex items-center justify-between"
            >
              <div>
                <p className="font-medium">{terminal.broker || "Unknown Broker"}</p>
                <p className="text-xs text-muted-foreground">
                  ID: {shortenId(terminal.terminal_id)}
                </p>
                {terminal.account_info && (
                  <p className="text-xs text-muted-foreground">
                    Account: {terminal.account_info.account_number}
                  </p>
                )}
              </div>
              <div className="w-3 h-3 rounded-full bg-green-500" title="Detected" />
            </div>
          ))}
        </div>
      )}

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
