import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import StatusPanel from "./components/StatusPanel";
import ExecutionLog from "./components/ExecutionLog";
import Settings from "./components/Settings";
import { CopierStatus, Execution } from "./types";

type Tab = "status" | "log" | "settings";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("status");
  const [status, setStatus] = useState<CopierStatus | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);

  useEffect(() => {
    // Poll for status updates
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
  }, []);

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
        <span className="text-xs text-muted-foreground">v1.0.0</span>
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
