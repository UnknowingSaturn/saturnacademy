import { useState, useEffect } from "react";
import { Shield, AlertTriangle, Clock, TrendingDown, Pause } from "lucide-react";
import { SafetyConfig } from "../../types";

interface SafetySettingsPanelProps {
  config: SafetyConfig;
  onChange: (config: SafetyConfig) => void;
  onUseGlobal?: () => void;
  isUsingGlobal?: boolean;
}

const PROP_FIRM_PRESET: Partial<SafetyConfig> = {
  max_slippage_pips: 1.0,
  max_daily_loss_r: 2.0,
  max_drawdown_percent: 4.0,
  trailing_drawdown: true,
  prop_firm_safe_mode: true,
};

export function SafetySettingsPanel({ config, onChange, onUseGlobal, isUsingGlobal }: SafetySettingsPanelProps) {
  const [localConfig, setLocalConfig] = useState<SafetyConfig>(config);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleChange = (field: keyof SafetyConfig, value: number | boolean) => {
    const newConfig = { ...localConfig, [field]: value };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const applyPropFirmPreset = () => {
    const newConfig = { ...localConfig, ...PROP_FIRM_PRESET };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  return (
    <div className="space-y-6">
      {/* Global toggle */}
      {onUseGlobal && (
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium">Use Global Settings</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Inherit safety settings from global defaults
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

      {/* Prop Firm Preset */}
      <div className="glass-card p-4 border-yellow-500/30 bg-yellow-500/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/20">
              <Shield className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <span className="text-sm font-medium">Prop Firm Safe Mode</span>
              <p className="text-xs text-muted-foreground">
                Conservative settings optimized for prop firm rules
              </p>
            </div>
          </div>
          <button
            onClick={applyPropFirmPreset}
            disabled={isUsingGlobal}
            className="px-3 py-1.5 text-sm bg-yellow-500/20 text-yellow-500 rounded-lg hover:bg-yellow-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply Preset
          </button>
        </div>
      </div>

      {/* Slippage Settings */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Max Slippage</h3>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-4">
            <input
              type="number"
              value={localConfig.max_slippage_pips}
              onChange={(e) => handleChange("max_slippage_pips", parseFloat(e.target.value) || 0)}
              step={0.5}
              min={0}
              max={50}
              disabled={isUsingGlobal}
              className="flex-1 bg-background/50 border border-border rounded-lg px-4 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
            <span className="text-sm text-muted-foreground">pips</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Reject trades if execution price differs more than this from signal price
          </p>
        </div>
      </div>

      {/* Daily Loss Limit */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Daily Loss Limit</h3>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-4">
            <input
              type="number"
              value={localConfig.max_daily_loss_r ?? 0}
              onChange={(e) => handleChange("max_daily_loss_r", parseFloat(e.target.value) || 0)}
              step={0.5}
              min={0}
              max={20}
              disabled={isUsingGlobal}
              className="flex-1 bg-background/50 border border-border rounded-lg px-4 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
            <span className="text-sm text-muted-foreground">R</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Stop copying when daily loss reaches this R-multiple (0 = disabled)
          </p>
        </div>
      </div>

      {/* Max Drawdown */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Max Drawdown</h3>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-4">
            <input
              type="number"
              value={localConfig.max_drawdown_percent ?? 0}
              onChange={(e) => handleChange("max_drawdown_percent", parseFloat(e.target.value) || 0)}
              step={0.5}
              min={0}
              max={50}
              disabled={isUsingGlobal}
              className="flex-1 bg-background/50 border border-border rounded-lg px-4 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Stop copying when account drawdown reaches this percentage (0 = disabled)
          </p>
        </div>
      </div>

      {/* Toggle Options */}
      <div className="space-y-2">
        {/* Trailing Drawdown */}
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingDown className="w-4 h-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">Trailing Drawdown</span>
              <p className="text-xs text-muted-foreground">
                Drawdown calculated from equity high-water mark
              </p>
            </div>
          </div>
          <button
            onClick={() => handleChange("trailing_drawdown", !localConfig.trailing_drawdown)}
            disabled={isUsingGlobal}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              localConfig.trailing_drawdown ? "bg-primary" : "bg-muted"
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                localConfig.trailing_drawdown ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>

        {/* Manual Confirm Mode */}
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Pause className="w-4 h-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">Manual Confirmation</span>
              <p className="text-xs text-muted-foreground">
                Require manual approval before executing trades
              </p>
            </div>
          </div>
          <button
            onClick={() => handleChange("manual_confirm_mode", !localConfig.manual_confirm_mode)}
            disabled={isUsingGlobal}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              localConfig.manual_confirm_mode ? "bg-primary" : "bg-muted"
            } disabled:opacity-50`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                localConfig.manual_confirm_mode ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Poll Interval (Advanced) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Poll Interval (Advanced)</h3>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-4">
            <input
              type="number"
              value={localConfig.poll_interval_ms ?? 100}
              onChange={(e) => handleChange("poll_interval_ms", parseInt(e.target.value) || 100)}
              step={50}
              min={50}
              max={5000}
              disabled={isUsingGlobal}
              className="flex-1 bg-background/50 border border-border rounded-lg px-4 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
            <span className="text-sm text-muted-foreground">ms</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            How often the receiver checks for new signals (lower = faster but more CPU)
          </p>
        </div>
      </div>
    </div>
  );
}
