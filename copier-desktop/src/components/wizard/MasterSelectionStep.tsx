import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Mt5Terminal } from "../../types";

interface MasterSelectionStepProps {
  terminals: Mt5Terminal[];
  selectedMaster: Mt5Terminal | null;
  onSelectMaster: (terminal: Mt5Terminal) => void;
  onContinue: () => void;
  onBack: () => void;
}

export default function MasterSelectionStep({
  terminals,
  selectedMaster,
  onSelectMaster,
  onContinue,
  onBack,
}: MasterSelectionStepProps) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);

  const handleSelect = async (terminal: Mt5Terminal) => {
    onSelectMaster(terminal);
    setInstalled(false);
    setError(null);
  };

  const handleInstallAndContinue = async () => {
    if (!selectedMaster) return;

    setInstalling(true);
    setError(null);

    try {
      await invoke("install_ea", {
        terminalId: selectedMaster.terminal_id,
        eaType: "master",
      });
      setInstalled(true);
      // Small delay before continuing
      setTimeout(onContinue, 500);
    } catch (err) {
      setError(`Failed to install EA: ${err}`);
    } finally {
      setInstalling(false);
    }
  };

  const shortenId = (id: string) => {
    if (id.length > 12) {
      return `${id.slice(0, 6)}...${id.slice(-4)}`;
    }
    return id;
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Select Master Account</h2>
        <p className="text-sm text-muted-foreground">
          Choose the account you trade on. Trades from this account will be copied.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {terminals.map((terminal) => {
          const isSelected = selectedMaster?.terminal_id === terminal.terminal_id;
          const displayName = terminal.account_info?.broker || terminal.broker || "MT5 Terminal";
          const accountNum = terminal.account_info?.account_number;
          const balance = terminal.account_info?.balance;
          
          return (
            <button
              key={terminal.terminal_id}
              onClick={() => handleSelect(terminal)}
              className={`w-full p-4 text-left rounded-lg border-2 transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {displayName}
                    {accountNum && <span className="text-muted-foreground"> - {accountNum}</span>}
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
                        <span className="text-blue-500">Master EA installed</span>
                      </>
                    )}
                  </div>
                </div>
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ml-3 ${
                    isSelected ? "border-primary bg-primary" : "border-muted-foreground"
                  }`}
                >
                  {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedMaster && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-sm font-medium text-blue-600 mb-1">Master EA will be installed</p>
          <p className="text-xs text-muted-foreground">
            The Master EA will capture all trades and send them to receiver accounts.
          </p>
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="flex-1 px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent"
        >
          Back
        </button>
        <button
          onClick={handleInstallAndContinue}
          disabled={!selectedMaster || installing}
          className="flex-1 px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {installing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Installing...
            </span>
          ) : installed ? (
            "Installed ✓"
          ) : (
            "Install Master EA & Continue"
          )}
        </button>
      </div>
    </div>
  );
}
