import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import StatusPanel from "./components/StatusPanel";
import ExecutionLog from "./components/ExecutionLog";
import Settings from "./components/Settings";
import TerminalManager from "./components/TerminalManager";
import WizardView from "./components/WizardView";
import { CopierStatus, Execution } from "./types";

type Tab = "terminals" | "status" | "log" | "settings";
type AppMode = "wizard" | "dashboard";

function App() {
  const [mode, setMode] = useState<AppMode>("wizard");
  const [activeTab, setActiveTab] = useState<Tab>("status");
  const [status, setStatus] = useState<CopierStatus | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);

  // Check if setup is complete on mount
  useEffect(() => {
    const checkSetup = async () => {
      try {
        // Check if we have any configured accounts by looking for config
        const status = await invoke<CopierStatus>("get_copier_status");
        // If copier is connected or running, show dashboard
        if (status.is_connected || status.is_running) {
          setMode("dashboard");
        }
      } catch (error) {
        console.log("Initial setup needed");
      }
    };
    checkSetup();
  }, []);

  useEffect(() => {
    if (mode !== "dashboard") return;

    // Poll for status updates only in dashboard mode
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

  if (mode === "wizard") {
    return (
      <div className="h-screen flex flex-col bg-background">
        {/* Header */}
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

        {/* Wizard Content */}
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
          <button
            onClick={handleShowWizard}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Run Setup
          </button>
          <span className="text-xs text-muted-foreground">v1.0.0</span>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="flex border-b border-border bg-card/50">
        <TabButton
          active={activeTab === "status"}
          onClick={() => setActiveTab("status")}
        >
          Status
        </TabButton>
        <TabButton
          active={activeTab === "terminals"}
          onClick={() => setActiveTab("terminals")}
        >
          Terminals
        </TabButton>
        <TabButton
          active={activeTab === "log"}
          onClick={() => setActiveTab("log")}
        >
          Activity
        </TabButton>
        <TabButton
          active={activeTab === "settings"}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </TabButton>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === "status" && <StatusPanel status={status} />}
        {activeTab === "terminals" && <TerminalManager />}
        {activeTab === "log" && <ExecutionLog executions={executions} />}
        {activeTab === "settings" && <Settings status={status} />}
      </main>
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
      className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
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
