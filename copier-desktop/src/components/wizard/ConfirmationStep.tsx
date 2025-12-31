import { Mt5Terminal } from "../../types";

interface ConfirmationStepProps {
  masterTerminal: Mt5Terminal | null;
  receiverTerminals: Mt5Terminal[];
  onComplete: () => void;
  onBack: () => void;
  onAddMoreReceivers: () => void;
}

export default function ConfirmationStep({
  masterTerminal,
  receiverTerminals,
  onComplete,
  onBack,
  onAddMoreReceivers,
}: ConfirmationStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-4xl mb-3">🎉</div>
        <h2 className="text-xl font-semibold mb-2">Setup Complete!</h2>
        <p className="text-sm text-muted-foreground">
          Your trade copier is configured and ready to use.
        </p>
      </div>

      {/* Connection Diagram */}
      <div className="p-6 bg-card border border-border rounded-lg">
        <div className="flex flex-col items-center gap-4">
          {/* Master */}
          <div className="w-full max-w-xs p-4 bg-blue-500/10 border-2 border-blue-500 rounded-lg text-center">
            <p className="text-xs text-blue-600 font-medium mb-1">MASTER</p>
            <p className="font-medium">{masterTerminal?.broker || "Unknown"}</p>
            {masterTerminal?.account_info && (
              <p className="text-xs text-muted-foreground">
                {masterTerminal.account_info.account_number}
              </p>
            )}
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center text-muted-foreground">
            <div className="w-0.5 h-4 bg-muted-foreground/30" />
            <span className="text-xs">copies to</span>
            <div className="w-0.5 h-4 bg-muted-foreground/30" />
            <span>↓</span>
          </div>

          {/* Receivers */}
          {receiverTerminals.length > 0 ? (
            <div className="w-full space-y-2">
              {receiverTerminals.map((receiver) => (
                <div
                  key={receiver.terminal_id}
                  className="p-4 bg-purple-500/10 border-2 border-purple-500 rounded-lg text-center"
                >
                  <p className="text-xs text-purple-600 font-medium mb-1">RECEIVER</p>
                  <p className="font-medium">{receiver.broker || "Unknown"}</p>
                  {receiver.account_info && (
                    <p className="text-xs text-muted-foreground">
                      {receiver.account_info.account_number}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full max-w-xs p-4 border-2 border-dashed border-muted-foreground/30 rounded-lg text-center">
              <p className="text-sm text-muted-foreground">No receivers configured</p>
              <button
                onClick={onAddMoreReceivers}
                className="mt-2 text-xs text-primary hover:underline"
              >
                + Add receiver accounts
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Next Steps */}
      <div className="p-4 bg-muted/50 rounded-lg">
        <p className="text-sm font-medium mb-2">Next steps:</p>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Open each MT5 terminal</li>
          <li>Navigate to Navigator → Expert Advisors → Right-click → Refresh</li>
          <li>Drag the EA (TradeCopierMaster/Receiver) onto any chart</li>
          <li>Enter your API key from the Saturn web app in the EA settings</li>
          <li>Click OK to start the EA</li>
        </ol>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent"
        >
          Back
        </button>
        <button
          onClick={onComplete}
          className="flex-1 px-4 py-2.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600"
        >
          Start Copying Trades
        </button>
      </div>
    </div>
  );
}
