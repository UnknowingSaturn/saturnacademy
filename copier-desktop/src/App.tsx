import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import StatusPanel from "./components/StatusPanel";
import ExecutionLog from "./components/ExecutionLog";
import Settings from "./components/Settings";
import TerminalManager from "./components/TerminalManager";
import WizardView from "./components/WizardView";
import PositionsPanel from "./components/PositionsPanel";
import ReceiverGrid from "./components/ReceiverGrid";
import PositionSyncDialog from "./components/PositionSyncDialog";
import { CopierStatus, Execution, Mt5Terminal } from "./types";

type Tab = "status" | "positions" | "receivers" | "log" | "terminals" | "settings";
type AppMode = "wizard" | "dashboard";

function App() {
  const [mode, setMode] = useState<AppMode>("wizard");
  const [activeTab, setActiveTab] = useState<Tab>("status");
  const [status, setStatus] = useState<CopierStatus | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [terminals, setTerminals] = useState<Mt5Terminal[]>([]);
  const [masterTerminalId, setMasterTerminalId] = useState<string>("");
  const [receiverTerminalIds, setReceiverTerminalIds] = useState<string[]>([]);
  const [showSyncDialog, setShowSyncDialog] = useState(false);

  // Check if setup is complete on mount
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const status = await invoke<CopierStatus>("get_copier_status");
        if (status.is_connected || status.is_running) {
          setMode("dashboard");
        }
        
        // Find terminals
        const foundTerminals = await invoke<Mt5Terminal[]>("find_terminals");
        setTerminals(foundTerminals);
        
        // Identify master and receivers
        const master = foundTerminals.find(t => t.master_installed);
        const receivers = foundTerminals.filter(t => t.receiver_installed);
        
        if (master) {
          setMasterTerminalId(master.terminal_id);
        }
        setReceiverTerminalIds(receivers.map(r => r.terminal_id));
      } catch (error) {
        console.log("Initial setup needed");
      }
    };
    checkSetup();
  }, []);

  useEffect(() => {
    if (mode !== "dashboard") return;

    const interval = setInterval(async () => {
      try {
        const result = await invoke<CopierStatus>("get_copier_status");
        setStatus(result);

        const execs = await invoke<Execution[]>("get_recent_executions");
        setExecutions(execs);
      } catch (error) {
        console.error("Failed to get status:", error);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [mode]);

  const handleWizardComplete = () => {
    setMode("dashboard");
  };

  const handleShowWizard = () => {
    setMode("wizard");
  };

  const handlePauseReceiver = (terminalId: string) => {
    console.log("Paused receiver:", terminalId);
  };

  const handleResumeReceiver = (terminalId: string) => {
    console.log("Resumed receiver:", terminalId);
  };

  const receiverTerminals = terminals.filter(t => t.receiver_installed);

  if (mode === "wizard") {
    return (
      <div className="h-screen flex flex-col bg-background">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Saturn Trade Copier - Setup</span>
          </div>
          <button
            onClick={() => setMode("dashboard")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip to Dashboard →
          </button>
        </header>

        <main className="flex-1 overflow-hidden">
          <WizardView onComplete={handleWizardComplete} />
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              status?.is_running
                ? "bg-green-500"
                : status?.is_connected
                ? "bg-yellow-500"
                : "bg-red-500"
            }`}
          />
          <span className="font-semibold text-sm">Saturn Trade Copier</span>
        </div>
        <div className="flex items-center gap-3">
          {masterTerminalId && (
            <button
              onClick={() => setShowSyncDialog(true)}
              className="px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20"
            >
              Sync Positions
            </button>
          )}
          <button
            onClick={handleShowWizard}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Run Setup
          </button>
          <span className="text-xs text-muted-foreground">v2.0.0</span>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="flex border-b border-border bg-card/50 overflow-x-auto">
        <TabButton active={activeTab === "status"} onClick={() => setActiveTab("status")}>
          Status
        </TabButton>
        <TabButton active={activeTab === "positions"} onClick={() => setActiveTab("positions")}>
          Positions
        </TabButton>
        <TabButton active={activeTab === "receivers"} onClick={() => setActiveTab("receivers")}>
          Receivers
        </TabButton>
        <TabButton active={activeTab === "log"} onClick={() => setActiveTab("log")}>
          Activity
        </TabButton>
        <TabButton active={activeTab === "terminals"} onClick={() => setActiveTab("terminals")}>
          Terminals
        </TabButton>
        <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
          Settings
        </TabButton>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {activeTab === "status" && <StatusPanel status={status} />}
        {activeTab === "positions" && (
          <PositionsPanel
            masterTerminalId={masterTerminalId}
            receiverTerminalIds={receiverTerminalIds}
          />
        )}
        {activeTab === "receivers" && (
          <ReceiverGrid
            receiverTerminals={receiverTerminals}
            onPauseReceiver={handlePauseReceiver}
            onResumeReceiver={handleResumeReceiver}
          />
        )}
        {activeTab === "log" && <ExecutionLog executions={executions} />}
        {activeTab === "terminals" && <TerminalManager />}
        {activeTab === "settings" && <Settings status={status} />}
      </main>

      {/* Position Sync Dialog */}
      <PositionSyncDialog
        masterTerminalId={masterTerminalId}
        receiverTerminalIds={receiverTerminalIds}
        isOpen={showSyncDialog}
        onClose={() => setShowSyncDialog(false)}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
        active
          ? "text-primary border-b-2 border-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default App;
