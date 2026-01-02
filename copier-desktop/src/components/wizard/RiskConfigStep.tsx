import { useState, useEffect } from "react";
import { Mt5Terminal, RiskConfig, RiskMode, SafetyConfig } from "../../types";

// Combined config for the wizard step (risk + safety together)
export interface WizardRiskConfig {
  risk: RiskConfig;
  safety: SafetyConfig;
}

interface RiskConfigStepProps {
  receiverTerminals: Mt5Terminal[];
  riskConfig: WizardRiskConfig;
  onConfigChange: (config: WizardRiskConfig) => void;
  onContinue: () => void;
  onBack: () => void;
}

const RISK_MODES: { value: RiskMode; label: string; description: string }[] = [
  { value: 'balance_multiplier', label: 'Balance Multiplier', description: 'Scale lots based on receiver balance ratio' },
  { value: 'fixed_lot', label: 'Fixed Lot', description: 'Use the same lot size for all trades' },
  { value: 'lot_multiplier', label: 'Lot Multiplier', description: 'Multiply master lot size by a factor' },
  { value: 'risk_percent', label: 'Risk Percent', description: 'Risk a fixed % of balance per trade' },
  { value: 'risk_dollar', label: 'Risk Dollar', description: 'Risk a fixed dollar amount per trade' },
];

export default function RiskConfigStep({
  receiverTerminals,
  riskConfig,
  onConfigChange,
  onContinue,
  onBack,
}: RiskConfigStepProps) {
  const [localConfig, setLocalConfig] = useState<WizardRiskConfig>(riskConfig);

  useEffect(() => {
    onConfigChange(localConfig);
  }, [localConfig, onConfigChange]);

  const handleModeChange = (mode: RiskMode) => {
    let defaultValue = 1.0;
    if (mode === 'fixed_lot') defaultValue = 0.01;
    if (mode === 'risk_percent') defaultValue = 1.0;
    if (mode === 'risk_dollar') defaultValue = 100;
    
    setLocalConfig(prev => ({ 
      ...prev, 
      risk: { mode, value: defaultValue }
    }));
  };

  const getValueLabel = () => {
    switch (localConfig.risk.mode) {
      case 'fixed_lot': return 'Lot Size';
      case 'lot_multiplier': return 'Multiplier';
      case 'balance_multiplier': return 'Multiplier';
      case 'risk_percent': return 'Risk %';
      case 'risk_dollar': return 'Risk $';
      default: return 'Value';
    }
  };

  const getValueStep = () => {
    switch (localConfig.risk.mode) {
      case 'fixed_lot': return 0.01;
      case 'risk_percent': return 0.5;
      case 'risk_dollar': return 10;
      default: return 0.1;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="text-3xl mb-2">⚙️</div>
        <h2 className="text-xl font-semibold mb-1">Risk Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure how trades are sized on {receiverTerminals.length} receiver account{receiverTerminals.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Risk Mode Selection */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Risk Mode</label>
        <div className="grid gap-2">
          {RISK_MODES.map(mode => (
            <button
              key={mode.value}
              onClick={() => handleModeChange(mode.value)}
              className={`p-3 text-left border rounded-lg transition-colors ${
                localConfig.risk.mode === mode.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="font-medium text-sm">{mode.label}</div>
              <div className="text-xs text-muted-foreground">{mode.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Risk Value */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{getValueLabel()}</label>
        <input
          type="number"
          value={localConfig.risk.value}
          onChange={e => setLocalConfig(prev => ({ 
            ...prev, 
            risk: { ...prev.risk, value: parseFloat(e.target.value) || 0 }
          }))}
          step={getValueStep()}
          min={0.01}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
        />
      </div>

      {/* Safety Settings */}
      <div className="p-4 bg-muted/50 rounded-lg space-y-4">
        <h3 className="text-sm font-medium">Safety Settings</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Max Slippage (pips)</label>
            <input
              type="number"
              value={localConfig.safety.max_slippage_pips}
              onChange={e => setLocalConfig(prev => ({ 
                ...prev, 
                safety: { ...prev.safety, max_slippage_pips: parseFloat(e.target.value) || 0 }
              }))}
              step={0.5}
              min={0}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Max Daily Loss (R)</label>
            <input
              type="number"
              value={localConfig.safety.max_daily_loss_r}
              onChange={e => setLocalConfig(prev => ({ 
                ...prev, 
                safety: { ...prev.safety, max_daily_loss_r: parseFloat(e.target.value) || 0 }
              }))}
              step={0.5}
              min={0}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm"
            />
          </div>
        </div>

        {/* Prop Firm Safe Mode */}
        <label className="flex items-center gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-accent/50">
          <input
            type="checkbox"
            checked={localConfig.safety.prop_firm_safe_mode}
            onChange={e => setLocalConfig(prev => ({ 
              ...prev, 
              safety: {
                ...prev.safety,
                prop_firm_safe_mode: e.target.checked,
                max_slippage_pips: e.target.checked ? 2 : prev.safety.max_slippage_pips,
                max_daily_loss_r: e.target.checked ? 2 : prev.safety.max_daily_loss_r,
              }
            }))}
            className="w-4 h-4 rounded border-border"
          />
          <div>
            <div className="text-sm font-medium">Prop Firm Safe Mode</div>
            <div className="text-xs text-muted-foreground">Stricter limits for prop firm accounts</div>
          </div>
        </label>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm border border-border rounded-lg hover:bg-accent"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          className="flex-1 px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
