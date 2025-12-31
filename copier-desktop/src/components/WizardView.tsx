import { useState } from "react";
import { Mt5Terminal, WizardState } from "../types";
import WizardProgress from "./wizard/WizardProgress";
import TerminalScanStep from "./wizard/TerminalScanStep";
import MasterSelectionStep from "./wizard/MasterSelectionStep";
import ReceiverSelectionStep from "./wizard/ReceiverSelectionStep";
import ConfirmationStep from "./wizard/ConfirmationStep";

interface WizardViewProps {
  onComplete: () => void;
}

const STEPS = ["Scan", "Master", "Receivers", "Complete"];

export default function WizardView({ onComplete }: WizardViewProps) {
  const [state, setState] = useState<WizardState>({
    step: 0,
    terminals: [],
    masterTerminal: null,
    receiverTerminals: [],
    setupComplete: false,
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
            <ConfirmationStep
              masterTerminal={state.masterTerminal}
              receiverTerminals={state.receiverTerminals}
              onComplete={handleComplete}
              onBack={() => goToStep(2)}
              onAddMoreReceivers={() => goToStep(2)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
