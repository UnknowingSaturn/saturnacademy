import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Mt5Terminal,
  RiskConfig,
  SafetyConfig,
  SymbolMapping,
  DEFAULT_RISK_CONFIG,
  DEFAULT_SAFETY_CONFIG,
} from "../../types";

interface ConfirmationStepProps {
  masterTerminal: Mt5Terminal | null;
  receiverTerminals: Mt5Terminal[];
  riskConfig?: RiskConfig;
  safetyConfig?: SafetyConfig;
  symbolMappings?: SymbolMapping[];
  onComplete: () => void;
  onBack: () => void;
  onAddMoreReceivers: () => void;
}

export default function ConfirmationStep({
  masterTerminal,
  receiverTerminals,
  riskConfig = DEFAULT_RISK_CONFIG,
  safetyConfig = DEFAULT_SAFETY_CONFIG,
  symbolMappings = [],
  onComplete,
  onBack,
  onAddMoreReceivers,
}: ConfirmationStepProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSaveAndComplete = async () => {
    if (!masterTerminal) {
      setError("No master terminal selected");
      return;
    }

    if (receiverTerminals.length === 0) {
      setError("No receiver terminals selected");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Build symbol mappings object
      const symbolMappingsObj: Record<string, string> = {};
      symbolMappings.forEach((m) => {
        if (m.enabled) {
          symbolMappingsObj[m.master_symbol] = m.receiver_symbol;
        }
      });

      // Build receiver configs
      const receivers = receiverTerminals.map((terminal) => ({
        terminal_id: terminal.terminal_id,
        account_number: terminal.account_info?.account_number || "",
        broker: terminal.broker || terminal.account_info?.broker || "",
        risk: riskConfig,
        safety: safetyConfig,
        symbol_mappings: symbolMappingsObj,
      }));

      // Save config to all receiver terminals
      const configHash = await invoke<string>("save_copier_config", {
        masterTerminalId: masterTerminal.terminal_id,
        masterAccountNumber: masterTerminal.account_info?.account_number || "",
        masterBroker: masterTerminal.broker || masterTerminal.account_info?.broker || "",
        receivers,
      });

      console.log("Config saved with hash:", configHash);
      setSaved(true);

      // Wait a moment then complete
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err) {
      console.error("Failed to save config:", err);
      setError(err as string);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-4xl mb-3">{saved ? "✅" : "🎉"}</div>
        <h2 className="text-xl font-semibold mb-2">
          {saved ? "Configuration Saved!" : "Setup Complete!"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {saved
            ? "Your copier configuration has been saved to all terminals."
            : "Review your configuration and save to start copying trades."}
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

      {/* Configuration Summary */}
      <div className="p-4 bg-muted/50 rounded-lg space-y-3">
        <p className="text-sm font-medium">Configuration Summary</p>
        
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="text-muted-foreground">Risk Mode:</div>
          <div className="font-medium capitalize">{riskConfig.mode.replace('_', ' ')}</div>
          
          <div className="text-muted-foreground">Risk Value:</div>
          <div className="font-medium">{riskConfig.value}</div>
          
          <div className="text-muted-foreground">Max Slippage:</div>
          <div className="font-medium">{safetyConfig.max_slippage_pips} pips</div>
          
          <div className="text-muted-foreground">Daily Loss Limit:</div>
          <div className="font-medium">{safetyConfig.max_daily_loss_r}R</div>
          
          <div className="text-muted-foreground">Prop Firm Mode:</div>
          <div className="font-medium">{safetyConfig.prop_firm_safe_mode ? "Enabled" : "Disabled"}</div>
          
          <div className="text-muted-foreground">Symbol Mappings:</div>
          <div className="font-medium">{symbolMappings.filter(m => m.enabled).length} active</div>
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

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          disabled={saving}
          className="px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={handleSaveAndComplete}
          disabled={saving || saved}
          className="flex-1 px-4 py-2.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <span className="animate-spin">⏳</span>
              Saving Configuration...
            </>
          ) : saved ? (
            <>
              ✓ Configuration Saved
            </>
          ) : (
            "Save Config & Start Copying"
          )}
        </button>
      </div>
    </div>
  );
}
