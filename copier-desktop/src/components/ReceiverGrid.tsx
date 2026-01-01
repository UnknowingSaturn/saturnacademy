import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { ReceiverHealth, Mt5Terminal } from "../types";

interface ReceiverGridProps {
  receiverTerminals: Mt5Terminal[];
  onPauseReceiver: (terminalId: string) => void;
  onResumeReceiver: (terminalId: string) => void;
}

export default function ReceiverGrid({
  receiverTerminals,
  onPauseReceiver,
  onResumeReceiver,
}: ReceiverGridProps) {
  const [closing, setClosing] = useState<Record<string, boolean>>({});
  const [paused, setPaused] = useState<Record<string, boolean>>({});

  const handleCloseAll = async (terminalId: string) => {
    setClosing((prev) => ({ ...prev, [terminalId]: true }));

    try {
      await invoke("emergency_close_all", {
        receiverTerminalIds: [terminalId],
        reason: "Manual close all from dashboard",
      });
    } catch (err) {
      console.error("Failed to close all:", err);
    } finally {
      setClosing((prev) => ({ ...prev, [terminalId]: false }));
    }
  };

  const handleTogglePause = async (terminalId: string) => {
    const isPaused = paused[terminalId];

    try {
      if (isPaused) {
        await invoke("resume_receivers", {
          receiverTerminalIds: [terminalId],
        });
        setPaused((prev) => ({ ...prev, [terminalId]: false }));
        onResumeReceiver(terminalId);
      } else {
        await invoke("pause_receivers", {
          receiverTerminalIds: [terminalId],
        });
        setPaused((prev) => ({ ...prev, [terminalId]: true }));
        onPauseReceiver(terminalId);
      }
    } catch (err) {
      console.error("Failed to toggle pause:", err);
    }
  };

  const handleCloseAllReceivers = async () => {
    const terminalIds = receiverTerminals.map((t) => t.terminal_id);
    
    try {
      await invoke("emergency_close_all", {
        receiverTerminalIds: terminalIds,
        reason: "Emergency close all from dashboard",
      });
    } catch (err) {
      console.error("Failed to close all receivers:", err);
    }
  };

  const handlePauseAllReceivers = async () => {
    const terminalIds = receiverTerminals.map((t) => t.terminal_id);
    
    try {
      await invoke("pause_receivers", {
        receiverTerminalIds: terminalIds,
      });
      
      const newPaused: Record<string, boolean> = {};
      terminalIds.forEach((id) => {
        newPaused[id] = true;
      });
      setPaused(newPaused);
    } catch (err) {
      console.error("Failed to pause all receivers:", err);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Global Actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Receiver Accounts</h3>
        <div className="flex gap-2">
          <button
            onClick={handlePauseAllReceivers}
            className="px-3 py-1.5 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600"
          >
            ⏸ Pause All
          </button>
          <button
            onClick={handleCloseAllReceivers}
            className="px-3 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600"
          >
            ⚠ Close All Positions
          </button>
        </div>
      </div>

      {/* Receiver Cards */}
      {receiverTerminals.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
          <p className="text-sm">No receiver accounts configured</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {receiverTerminals.map((terminal) => {
            const isPaused = paused[terminal.terminal_id];
            const isClosing = closing[terminal.terminal_id];

            return (
              <div
                key={terminal.terminal_id}
                className={`p-4 rounded-lg border ${
                  isPaused
                    ? "bg-yellow-500/10 border-yellow-500/30"
                    : "bg-card border-border"
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          isPaused ? "bg-yellow-500" : "bg-green-500"
                        }`}
                      />
                      <p className="font-medium">
                        {terminal.broker || "Unknown Broker"}
                      </p>
                    </div>
                    {terminal.account_info && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Account: {terminal.account_info.account_number}
                      </p>
                    )}
                  </div>
                  {isPaused && (
                    <span className="px-2 py-0.5 text-xs bg-yellow-500 text-white rounded">
                      PAUSED
                    </span>
                  )}
                </div>

                {/* Stats */}
                {terminal.account_info && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="p-2 bg-muted/50 rounded">
                      <p className="text-xs text-muted-foreground">Balance</p>
                      <p className="text-sm font-medium">
                        ${terminal.account_info.balance.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-2 bg-muted/50 rounded">
                      <p className="text-xs text-muted-foreground">Equity</p>
                      <p className="text-sm font-medium">
                        ${terminal.account_info.equity.toLocaleString()}
                      </p>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleTogglePause(terminal.terminal_id)}
                    className={`flex-1 px-3 py-1.5 text-xs rounded ${
                      isPaused
                        ? "bg-green-500 text-white hover:bg-green-600"
                        : "bg-yellow-500 text-white hover:bg-yellow-600"
                    }`}
                  >
                    {isPaused ? "▶ Resume" : "⏸ Pause"}
                  </button>
                  <button
                    onClick={() => handleCloseAll(terminal.terminal_id)}
                    disabled={isClosing}
                    className="flex-1 px-3 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                  >
                    {isClosing ? "Closing..." : "Close All"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
