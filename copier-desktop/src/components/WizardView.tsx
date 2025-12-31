import { useState, useCallback } from "react";
import { Mt5Terminal, WizardState } from "../types";
import WizardProgress from "./wizard/WizardProgress";
import TerminalScanStep from "./wizard/TerminalScanStep";
import MasterSelectionStep from "./wizard/MasterSelectionStep";
import ReceiverSelectionStep from "./wizard/ReceiverSelectionStep";
import RiskConfigStep, { RiskConfig } from "./wizard/RiskConfigStep";
import SymbolMappingStep, { SymbolMapping } from "./wizard/SymbolMappingStep";
import ConfirmationStep from "./wizard/ConfirmationStep";

interface WizardViewProps {
  onComplete: () => void;
}

interface ExtendedWizardState extends WizardState {
  riskConfig: RiskConfig;
  symbolMappings: SymbolMapping[];
}

const STEPS = ["Scan", "Master", "Receivers", "Risk", "Symbols", "Complete"];

const DEFAULT_RISK_CONFIG: RiskConfig = {
  risk_mode: 'balance_multiplier',
  risk_value: 1.0,
  max_slippage_pips: 3.0,
  max_daily_loss_r: 3.0,
  prop_firm_safe_mode: false,
};

export default function WizardView({ onComplete }: WizardViewProps) {
  const [state, setState] = useState<ExtendedWizardState>({
    step: 0,
    terminals: [],
    masterTerminal: null,
    receiverTerminals: [],
    setupComplete: false,
    riskConfig: DEFAULT_RISK_CONFIG,
    symbolMappings: [],
  });

  const goToStep = (step: number) => {
    setState((prev) => ({ ...prev, step }));
  };

  const handleTerminalsFound = (terminals: Mt5Terminal[]) => {
    setState((prev) => ({ ...prev, terminals }));
  };

  const handleSelectMaster = (terminal: Mt5Terminal) => {
    setState((prev) => ({ ...prev, masterTerminal: terminal }));
  };

  const handleSelectReceivers = (terminals: Mt5Terminal[]) => {
    setState((prev) => ({ ...prev, receiverTerminals: terminals }));
  };

  const handleRiskConfigChange = useCallback((config: RiskConfig) => {
    setState((prev) => ({ ...prev, riskConfig: config }));
  }, []);

  const handleSymbolMappingsChange = useCallback((mappings: SymbolMapping[]) => {
    setState((prev) => ({ ...prev, symbolMappings: mappings }));
  }, []);

  const handleComplete = () => {
    setState((prev) => ({ ...prev, setupComplete: true }));
    onComplete();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-lg mx-auto">
        <WizardProgress currentStep={state.step} steps={STEPS} />

        <div className="mt-8">
          {state.step === 0 && (
            <TerminalScanStep
              terminals={state.terminals}
              onTerminalsFound={handleTerminalsFound}
              onContinue={() => goToStep(1)}
            />
          )}

          {state.step === 1 && (
            <MasterSelectionStep
              terminals={state.terminals}
              selectedMaster={state.masterTerminal}
              onSelectMaster={handleSelectMaster}
              onContinue={() => goToStep(2)}
              onBack={() => goToStep(0)}
            />
          )}

          {state.step === 2 && (
            <ReceiverSelectionStep
              terminals={state.terminals}
              masterTerminal={state.masterTerminal}
              selectedReceivers={state.receiverTerminals}
              onSelectReceivers={handleSelectReceivers}
              onContinue={() => goToStep(3)}
              onBack={() => goToStep(1)}
              onSkip={() => goToStep(3)}
            />
          )}

          {state.step === 3 && (
            <RiskConfigStep
              receiverTerminals={state.receiverTerminals}
              riskConfig={state.riskConfig}
              onConfigChange={handleRiskConfigChange}
              onContinue={() => goToStep(4)}
              onBack={() => goToStep(2)}
            />
          )}

          {state.step === 4 && (
            <SymbolMappingStep
              symbolMappings={state.symbolMappings}
              onMappingsChange={handleSymbolMappingsChange}
              onContinue={() => goToStep(5)}
              onBack={() => goToStep(3)}
            />
          )}

          {state.step === 5 && (
            <ConfirmationStep
              masterTerminal={state.masterTerminal}
              receiverTerminals={state.receiverTerminals}
              onComplete={handleComplete}
              onBack={() => goToStep(4)}
              onAddMoreReceivers={() => goToStep(2)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
