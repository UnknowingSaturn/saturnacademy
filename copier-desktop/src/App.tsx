import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { checkUpdate } from "@tauri-apps/api/updater";
import Sidebar, { NavItem } from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import ExecutionLog from "./components/ExecutionLog";
import Settings from "./components/Settings";
import TerminalManager from "./components/TerminalManager";
import WizardView from "./components/WizardView";
import PositionsPanel from "./components/PositionsPanel";
import ReceiverGrid from "./components/ReceiverGrid";
import PositionSyncDialog from "./components/PositionSyncDialog";
import Configuration from "./components/Configuration";
import UpdateNotification from "./components/UpdateNotification";
import { CopierStatus, Execution, Mt5Terminal, MasterHeartbeat } from "./types";

type AppMode = "wizard" | "dashboard";

function App() {
  const [mode, setMode] = useState<AppMode>("wizard");
  const [activeNav, setActiveNav] = useState<NavItem>("dashboard");
  const [status, setStatus] = useState<CopierStatus | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [terminals, setTerminals] = useState<Mt5Terminal[]>([]);
  const [masterTerminalId, setMasterTerminalId] = useState<string>("");
  const [receiverTerminalIds, setReceiverTerminalIds] = useState<string[]>([]);
  const [masterHeartbeat, setMasterHeartbeat] = useState<MasterHeartbeat | null>(null);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string>("");

  // Check for updates on startup
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const { shouldUpdate, manifest } = await checkUpdate();
        if (shouldUpdate && manifest) {
          setUpdateAvailable(true);
          setUpdateVersion(manifest.version);
        }
      } catch (e) {
        console.log("Update check skipped:", e);
      }
    };
    
    // Delay to not block startup
    const timeout = setTimeout(checkForUpdates, 3000);
    return () => clearTimeout(timeout);
  }, []);

  // Check if setup is complete on mount
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const statusResult = await invoke<CopierStatus>("get_copier_status");
        setStatus(statusResult);
        if (statusResult.is_connected || statusResult.is_running) {
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
        console.log("Initial setup needed:", error);
      }
    };
    checkSetup();
  }, []);

  // Poll for status and heartbeat when in dashboard mode
  useEffect(() => {
    if (mode !== "dashboard") return;

    const fetchData = async () => {
      try {
        const result = await invoke<CopierStatus>("get_copier_status");
        setStatus(result);

        const execs = await invoke<Execution[]>("get_recent_executions");
        setExecutions(execs);

        // Try to get master heartbeat
        if (masterTerminalId) {
          try {
            const heartbeat = await invoke<MasterHeartbeat | null>("get_master_heartbeat", { terminalId: masterTerminalId });
            setMasterHeartbeat(heartbeat);
          } catch {
            // Heartbeat not available
          }
        }
      } catch (error) {
        console.error("Failed to get status:", error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1000);

    return () => clearInterval(interval);
  }, [mode, masterTerminalId]);

  const handleWizardComplete = () => {
    setMode("dashboard");
  };

  const handleShowWizard = () => {
    setMode("wizard");
  };

  const handlePauseReceiver = async (terminalId: string) => {
    try {
      await invoke("pause_receivers", { receiverTerminalIds: [terminalId] });
      console.log("Paused receiver:", terminalId);
    } catch (error) {
      console.error("Failed to pause receiver:", error);
    }
  };

  const handleResumeReceiver = async (terminalId: string) => {
    try {
      await invoke("resume_receivers", { receiverTerminalIds: [terminalId] });
      console.log("Resumed receiver:", terminalId);
    } catch (error) {
      console.error("Failed to resume receiver:", error);
    }
  };

  const receiverTerminals = terminals.filter(t => t.receiver_installed);

  if (mode === "wizard") {
    return (
      <div className="h-screen flex flex-col bg-background">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <span className="text-primary font-bold text-sm">S</span>
            </div>
            <div>
              <span className="font-semibold">Saturn Trade Copier</span>
              <span className="text-xs text-muted-foreground ml-2">Setup Wizard</span>
            </div>
          </div>
          <button
            onClick={() => setMode("dashboard")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
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
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <Sidebar
        activeItem={activeNav}
        onNavigate={setActiveNav}
        onShowWizard={handleShowWizard}
        status={status}
        masterHeartbeat={masterHeartbeat?.timestamp_utc}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold capitalize">{activeNav}</h1>
            {activeNav === "dashboard" && status?.is_running && (
              <span className="flex items-center gap-1.5 text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Copying Active
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {masterTerminalId && (
              <button
                onClick={() => setShowSyncDialog(true)}
                className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
              >
                Sync Positions
              </button>
            )}
            <span className="text-xs text-muted-foreground">
              Config v{status?.config_version ?? 0}
            </span>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-hidden">
          {activeNav === "dashboard" && (
            <Dashboard
              status={status}
              executions={executions}
              masterHeartbeat={masterHeartbeat}
              receiverTerminals={receiverTerminals}
              onPauseReceiver={handlePauseReceiver}
              onResumeReceiver={handleResumeReceiver}
            />
          )}
          {activeNav === "positions" && (
            <PositionsPanel
              masterTerminalId={masterTerminalId}
              receiverTerminalIds={receiverTerminalIds}
            />
          )}
          {activeNav === "receivers" && (
            <ReceiverGrid
              receiverTerminals={receiverTerminals}
              onPauseReceiver={handlePauseReceiver}
              onResumeReceiver={handleResumeReceiver}
            />
          )}
          {activeNav === "activity" && <ExecutionLog executions={executions} />}
          {activeNav === "configuration" && <Configuration receiverTerminals={receiverTerminals} />}
          {activeNav === "terminals" && <TerminalManager />}
          {activeNav === "settings" && <Settings status={status} />}
        </main>
      </div>

      {/* Position Sync Dialog */}
      <PositionSyncDialog
        masterTerminalId={masterTerminalId}
        receiverTerminalIds={receiverTerminalIds}
        isOpen={showSyncDialog}
        onClose={() => setShowSyncDialog(false)}
      />

      {/* Update Notification */}
      {updateAvailable && (
        <UpdateNotification
          version={updateVersion}
          onDismiss={() => setUpdateAvailable(false)}
        />
      )}
    </div>
  );
}

export default App;