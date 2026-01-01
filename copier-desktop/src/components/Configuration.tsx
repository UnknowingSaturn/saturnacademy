import { useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import { Mt5Terminal, RiskConfig, SafetyConfig, SymbolMapping, SymbolOverride, DEFAULT_RISK_CONFIG, DEFAULT_SAFETY_CONFIG } from "../types";
import { ReceiverSelector } from "./config/ReceiverSelector";
import { ConfigurationTabs } from "./config/ConfigurationTabs";
import { RiskConfigPanel } from "./config/RiskConfigPanel";
import { SymbolMappingPanel } from "./config/SymbolMappingPanel";
import { SymbolOverridesPanel } from "./config/SymbolOverridesPanel";
import { SafetySettingsPanel } from "./config/SafetySettingsPanel";
import { SessionFilterPanel } from "./config/SessionFilterPanel";

interface ConfigurationProps {
  receiverTerminals: Mt5Terminal[];
}

interface ReceiverConfigState {
  riskConfig: RiskConfig;
  safetyConfig: SafetyConfig;
  symbolMappings: SymbolMapping[];
  symbolOverrides: SymbolOverride[];
  sessionConfig: {
    allowed_sessions: string[];
    custom_start_hour?: number;
    custom_end_hour?: number;
    timezone: string;
  };
  useGlobalRisk: boolean;
  useGlobalSafety: boolean;
  useGlobalSessions: boolean;
}

const defaultReceiverConfig: ReceiverConfigState = {
  riskConfig: DEFAULT_RISK_CONFIG,
  safetyConfig: DEFAULT_SAFETY_CONFIG,
  symbolMappings: [],
  symbolOverrides: [],
  sessionConfig: {
    allowed_sessions: ["london", "new_york", "overlap"],
    timezone: "UTC",
  },
  useGlobalRisk: true,
  useGlobalSafety: true,
  useGlobalSessions: true,
};

export default function Configuration({ receiverTerminals }: ConfigurationProps) {
  const [selectedReceiver, setSelectedReceiver] = useState<string | null>(
    receiverTerminals.length > 0 ? receiverTerminals[0].terminal_id : "global"
  );
  const [activeTab, setActiveTab] = useState("risk");
  const [configs, setConfigs] = useState<Map<string, ReceiverConfigState>>(new Map());
  const [hasChanges, setHasChanges] = useState(false);

  const getConfig = (id: string): ReceiverConfigState => {
    return configs.get(id) ?? defaultReceiverConfig;
  };

  const updateConfig = (id: string, updates: Partial<ReceiverConfigState>) => {
    const current = getConfig(id);
    const updated = { ...current, ...updates };
    setConfigs(new Map(configs.set(id, updated)));
    setHasChanges(true);
  };

  const handleSave = async () => {
    // TODO: Invoke Tauri command to save config
    console.log("Saving configuration:", Object.fromEntries(configs));
    setHasChanges(false);
  };

  const handleDiscard = () => {
    setConfigs(new Map());
    setHasChanges(false);
  };

  const currentConfig = selectedReceiver ? getConfig(selectedReceiver) : defaultReceiverConfig;
  const isGlobal = selectedReceiver === "global";

  const renderTabContent = () => {
    if (!selectedReceiver) return null;

    switch (activeTab) {
      case "risk":
        return (
          <RiskConfigPanel
            config={currentConfig.riskConfig}
            onChange={(riskConfig) => updateConfig(selectedReceiver, { riskConfig })}
            onUseGlobal={isGlobal ? undefined : () => updateConfig(selectedReceiver, { useGlobalRisk: !currentConfig.useGlobalRisk })}
            isUsingGlobal={!isGlobal && currentConfig.useGlobalRisk}
          />
        );
      case "symbols":
        return (
          <SymbolMappingPanel
            mappings={currentConfig.symbolMappings}
            onChange={(symbolMappings) => updateConfig(selectedReceiver, { symbolMappings })}
          />
        );
      case "overrides":
        return (
          <SymbolOverridesPanel
            overrides={currentConfig.symbolOverrides}
            onChange={(symbolOverrides) => updateConfig(selectedReceiver, { symbolOverrides })}
          />
        );
      case "safety":
        return (
          <SafetySettingsPanel
            config={currentConfig.safetyConfig}
            onChange={(safetyConfig) => updateConfig(selectedReceiver, { safetyConfig })}
            onUseGlobal={isGlobal ? undefined : () => updateConfig(selectedReceiver, { useGlobalSafety: !currentConfig.useGlobalSafety })}
            isUsingGlobal={!isGlobal && currentConfig.useGlobalSafety}
          />
        );
      case "sessions":
        return (
          <SessionFilterPanel
            config={currentConfig.sessionConfig}
            onChange={(sessionConfig) => updateConfig(selectedReceiver, { sessionConfig })}
            onUseGlobal={isGlobal ? undefined : () => updateConfig(selectedReceiver, { useGlobalSessions: !currentConfig.useGlobalSessions })}
            isUsingGlobal={!isGlobal && currentConfig.useGlobalSessions}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex">
      {/* Left Panel - Receiver List */}
      <div className="w-72 border-r border-border p-4 bg-card/50">
        <ReceiverSelector
          receivers={receiverTerminals}
          selectedId={selectedReceiver}
          onSelect={setSelectedReceiver}
          hasCustomConfig={new Map(
            Array.from(configs.entries())
              .filter(([id]) => id !== "global")
              .map(([id, config]) => [id, !config.useGlobalRisk || !config.useGlobalSafety])
          )}
        />
      </div>

      {/* Right Panel - Configuration */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedReceiver ? (
          <>
            <ConfigurationTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              isGlobal={isGlobal}
            >
              {renderTabContent()}
            </ConfigurationTabs>

            {/* Footer Actions */}
            {hasChanges && (
              <div className="p-4 border-t border-border bg-card/50 flex items-center justify-end gap-3">
                <button
                  onClick={handleDiscard}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Discard Changes
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">Select a receiver to configure</p>
          </div>
        )}
      </div>
    </div>
  );
}
