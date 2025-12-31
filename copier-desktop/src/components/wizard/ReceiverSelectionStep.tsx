import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Mt5Terminal } from "../../types";

interface ReceiverSelectionStepProps {
  terminals: Mt5Terminal[];
  masterTerminal: Mt5Terminal | null;
  selectedReceivers: Mt5Terminal[];
  onSelectReceivers: (terminals: Mt5Terminal[]) => void;
  onContinue: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export default function ReceiverSelectionStep({
  terminals,
  masterTerminal,
  selectedReceivers,
  onSelectReceivers,
  onContinue,
  onBack,
  onSkip,
}: ReceiverSelectionStepProps) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installedCount, setInstalledCount] = useState(0);

  // Filter out master terminal
  const availableTerminals = terminals.filter(
    (t) => t.terminal_id !== masterTerminal?.terminal_id
  );

  const handleToggle = (terminal: Mt5Terminal) => {
    const isSelected = selectedReceivers.some((r) => r.terminal_id === terminal.terminal_id);
    if (isSelected) {
      onSelectReceivers(selectedReceivers.filter((r) => r.terminal_id !== terminal.terminal_id));
    } else {
      onSelectReceivers([...selectedReceivers, terminal]);
    }
    setInstalledCount(0);
  };

  const handleInstallAndContinue = async () => {
    if (selectedReceivers.length === 0) return;

    setInstalling(true);
    setError(null);
    let installed = 0;

    try {
      for (const receiver of selectedReceivers) {
        await invoke("install_ea", {
          terminalId: receiver.terminal_id,
          eaType: "receiver",
        });
        installed++;
        setInstalledCount(installed);
      }
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
        <h2 className="text-xl font-semibold mb-2">Select Receiver Accounts</h2>
        <p className="text-sm text-muted-foreground">
          Choose which accounts should receive copied trades from your master.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
          {error}
        </div>
      )}

      {availableTerminals.length === 0 ? (
        <div className="text-center py-8 bg-muted/50 rounded-lg">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm font-medium">No other terminals available</p>
          <p className="text-xs text-muted-foreground mt-2">
            You can add receiver accounts later
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {availableTerminals.map((terminal) => {
            const isSelected = selectedReceivers.some(
              (r) => r.terminal_id === terminal.terminal_id
            );
            return (
              <button
                key={terminal.terminal_id}
                onClick={() => handleToggle(terminal)}
                className={`w-full p-4 text-left rounded-lg border-2 transition-colors ${
                  isSelected
                    ? "border-purple-500 bg-purple-500/5"
                    : "border-border hover:border-purple-500/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{terminal.broker || "Unknown Broker"}</p>
                    <p className="text-xs text-muted-foreground">
                      ID: {shortenId(terminal.terminal_id)}
                    </p>
                    {terminal.account_info && (
                      <p className="text-xs text-muted-foreground">
                        Account: {terminal.account_info.account_number} • Balance: ${terminal.account_info.balance.toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div
                    className={`w-5 h-5 rounded flex items-center justify-center ${
                      isSelected ? "bg-purple-500" : "border-2 border-muted-foreground"
                    }`}
                  >
                    {isSelected && <span className="text-white text-xs">✓</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedReceivers.length > 0 && (
        <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
          <p className="text-sm font-medium text-purple-600 mb-1">
            {selectedReceivers.length} receiver{selectedReceivers.length !== 1 ? 's' : ''} selected
          </p>
          <p className="text-xs text-muted-foreground">
            Receiver EAs will execute trades from your master account.
          </p>
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent"
        >
          Back
        </button>
        {availableTerminals.length > 0 && selectedReceivers.length === 0 ? (
          <button
            onClick={onSkip}
            className="flex-1 px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent"
          >
            Skip for now
          </button>
        ) : null}
        <button
          onClick={handleInstallAndContinue}
          disabled={selectedReceivers.length === 0 || installing}
          className="flex-1 px-4 py-2.5 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50"
        >
          {installing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Installing {installedCount}/{selectedReceivers.length}...
            </span>
          ) : installedCount === selectedReceivers.length && installedCount > 0 ? (
            "Installed ✓"
          ) : (
            `Install Receiver EA${selectedReceivers.length !== 1 ? 's' : ''} & Continue`
          )}
        </button>
      </div>
    </div>
  );
}
