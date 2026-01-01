import { useState, useEffect } from "react";
import { DollarSign, Percent, TrendingUp, Scale, Target } from "lucide-react";
import { RiskConfig, RiskMode } from "../../types";

interface RiskConfigPanelProps {
  config: RiskConfig;
  onChange: (config: RiskConfig) => void;
  onUseGlobal?: () => void;
  isUsingGlobal?: boolean;
}

const RISK_MODES: { mode: RiskMode; label: string; description: string; icon: React.ReactNode }[] = [
  { 
    mode: "balance_multiplier", 
    label: "Balance Multiplier", 
    description: "Scale lots based on account balance ratio",
    icon: <Scale className="w-4 h-4" />
  },
  { 
    mode: "fixed_lot", 
    label: "Fixed Lot", 
    description: "Use a fixed lot size for all trades",
    icon: <Target className="w-4 h-4" />
  },
  { 
    mode: "risk_percent", 
    label: "Risk Percent", 
    description: "Risk a percentage of account per trade",
    icon: <Percent className="w-4 h-4" />
  },
  { 
    mode: "risk_dollar", 
    label: "Risk Dollar", 
    description: "Risk a fixed dollar amount per trade",
    icon: <DollarSign className="w-4 h-4" />
  },
  { 
    mode: "intent_based", 
    label: "Intent Based", 
    description: "Copy the master's risk intent (R-multiple)",
    icon: <TrendingUp className="w-4 h-4" />
  },
];

export function RiskConfigPanel({ config, onChange, onUseGlobal, isUsingGlobal }: RiskConfigPanelProps) {
  const [localConfig, setLocalConfig] = useState<RiskConfig>(config);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleModeChange = (mode: RiskMode) => {
    const defaultValues: Record<RiskMode, number> = {
      balance_multiplier: 1.0,
      fixed_lot: 0.1,
      risk_percent: 1.0,
      risk_dollar: 100,
      intent_based: 1.0,
    };
    
    const newConfig = { 
      ...localConfig, 
      risk_mode: mode, 
      risk_value: defaultValues[mode] 
    };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const handleValueChange = (value: number) => {
    const newConfig = { ...localConfig, risk_value: value };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const getValueLabel = () => {
    switch (localConfig.risk_mode) {
      case "balance_multiplier": return "Multiplier";
      case "fixed_lot": return "Lot Size";
      case "risk_percent": return "Risk %";
      case "risk_dollar": return "Risk $";
      case "intent_based": return "R-Multiple";
      default: return "Value";
    }
  };

  const getValueStep = () => {
    switch (localConfig.risk_mode) {
      case "balance_multiplier": return 0.1;
      case "fixed_lot": return 0.01;
      case "risk_percent": return 0.25;
      case "risk_dollar": return 10;
      case "intent_based": return 0.1;
      default: return 0.1;
    }
  };

  const getValuePlaceholder = () => {
    switch (localConfig.risk_mode) {
      case "balance_multiplier": return "e.g., 1.0 = same lots as master";
      case "fixed_lot": return "e.g., 0.10";
      case "risk_percent": return "e.g., 1.0%";
      case "risk_dollar": return "e.g., $100";
      case "intent_based": return "e.g., 1.0R";
      default: return "";
    }
  };

  return (
    <div className="space-y-6">
      {/* Global toggle */}
      {onUseGlobal && (
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium">Use Global Settings</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Inherit risk settings from global defaults
            </p>
          </div>
          <button
            onClick={onUseGlobal}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              isUsingGlobal ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                isUsingGlobal ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>
      )}

      {/* Risk Mode Selection */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Risk Mode</h3>
        <div className="grid gap-2">
          {RISK_MODES.map(({ mode, label, description, icon }) => (
            <button
              key={mode}
              onClick={() => handleModeChange(mode)}
              disabled={isUsingGlobal}
              className={`glass-card p-4 text-left transition-all ${
                localConfig.risk_mode === mode
                  ? "border-primary/50 bg-primary/5"
                  : "hover:border-border/80"
              } ${isUsingGlobal ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  localConfig.risk_mode === mode 
                    ? "bg-primary/20 text-primary" 
                    : "bg-muted text-muted-foreground"
                }`}>
                  {icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{label}</span>
                    {localConfig.risk_mode === mode && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Risk Value Input */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">{getValueLabel()}</h3>
        <div className="glass-card p-4">
          <div className="flex items-center gap-4">
            <input
              type="number"
              value={localConfig.risk_value}
              onChange={(e) => handleValueChange(parseFloat(e.target.value) || 0)}
              step={getValueStep()}
              min={0}
              disabled={isUsingGlobal}
              className="flex-1 bg-background/50 border border-border rounded-lg px-4 py-3 text-lg font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="text-sm text-muted-foreground">
              {localConfig.risk_mode === "risk_percent" && "%"}
              {localConfig.risk_mode === "risk_dollar" && "USD"}
              {localConfig.risk_mode === "balance_multiplier" && "×"}
              {localConfig.risk_mode === "fixed_lot" && "lots"}
              {localConfig.risk_mode === "intent_based" && "R"}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {getValuePlaceholder()}
          </p>
        </div>
      </div>

      {/* Preview */}
      <div className="glass-card p-4 bg-muted/30">
        <h4 className="text-xs font-medium text-muted-foreground mb-2">Preview</h4>
        <p className="text-sm">
          {localConfig.risk_mode === "balance_multiplier" && (
            <>If master trades 0.10 lots, receiver will trade <span className="text-primary font-semibold">{(0.1 * localConfig.risk_value).toFixed(2)} lots</span></>
          )}
          {localConfig.risk_mode === "fixed_lot" && (
            <>All trades will be copied at <span className="text-primary font-semibold">{localConfig.risk_value.toFixed(2)} lots</span></>
          )}
          {localConfig.risk_mode === "risk_percent" && (
            <>Each trade will risk <span className="text-primary font-semibold">{localConfig.risk_value}%</span> of account balance</>
          )}
          {localConfig.risk_mode === "risk_dollar" && (
            <>Each trade will risk <span className="text-primary font-semibold">${localConfig.risk_value}</span> based on SL distance</>
          )}
          {localConfig.risk_mode === "intent_based" && (
            <>Each trade will target <span className="text-primary font-semibold">{localConfig.risk_value}R</span> based on master's R-multiple</>
          )}
        </p>
      </div>
    </div>
  );
}
