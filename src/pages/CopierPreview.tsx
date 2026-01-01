import { useState, useEffect } from "react";
import { NavItem, PreviewState } from "@/types/copier-preview";
import { 
  mockMasterTerminal, 
  mockReceiverTerminals, 
  createMockStatus, 
  createMockHeartbeat, 
  generateMockExecutions,
  generateMockPositions,
  defaultPreviewState 
} from "@/components/copier-preview/mockData";
import { PreviewSidebar } from "@/components/copier-preview/PreviewSidebar";
import { PreviewDashboard } from "@/components/copier-preview/PreviewDashboard";
import { PreviewReceiverGrid } from "@/components/copier-preview/PreviewReceiverGrid";
import { PreviewExecutionLog } from "@/components/copier-preview/PreviewExecutionLog";
import { PreviewSettings } from "@/components/copier-preview/PreviewSettings";
import { PreviewTerminals } from "@/components/copier-preview/PreviewTerminals";
import { PreviewPositions } from "@/components/copier-preview/PreviewPositions";
import { PreviewControls } from "@/components/copier-preview/PreviewControls";
import { toast } from "sonner";

export default function CopierPreview() {
  const [activeNav, setActiveNav] = useState<NavItem>("dashboard");
  const [previewState, setPreviewState] = useState<PreviewState>(defaultPreviewState);
  const [executions, setExecutions] = useState(generateMockExecutions(10));
  const [heartbeatTime, setHeartbeatTime] = useState(new Date().toISOString());

  // Update heartbeat time periodically
  useEffect(() => {
    if (previewState.isConnected) {
      const interval = setInterval(() => {
        setHeartbeatTime(new Date().toISOString());
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [previewState.isConnected]);

  const status = createMockStatus(previewState);
  const heartbeat = createMockHeartbeat(previewState.isConnected);
  const positions = generateMockPositions();
  const allTerminals = [mockMasterTerminal, ...mockReceiverTerminals];

  const handlePauseReceiver = (terminalId: string) => {
    toast.info("Receiver Paused", {
      description: `Paused copying on terminal ${terminalId.slice(0, 8)}...`,
    });
  };

  const handleResumeReceiver = (terminalId: string) => {
    toast.success("Receiver Resumed", {
      description: `Resumed copying on terminal ${terminalId.slice(0, 8)}...`,
    });
  };

  const handleSimulateTrade = () => {
    const newExecution = generateMockExecutions(1)[0];
    newExecution.timestamp = new Date().toISOString();
    setExecutions([newExecution, ...executions]);
    toast.success("Trade Simulated", {
      description: `${newExecution.direction.toUpperCase()} ${newExecution.symbol} - ${newExecution.status}`,
    });
  };

  const handleReset = () => {
    setPreviewState(defaultPreviewState);
    setExecutions(generateMockExecutions(10));
    toast.info("Preview Reset", {
      description: "All states reset to defaults",
    });
  };

  const renderContent = () => {
    switch (activeNav) {
      case "dashboard":
        return (
          <PreviewDashboard
            status={status}
            executions={executions}
            masterHeartbeat={heartbeat}
            receiverTerminals={mockReceiverTerminals}
            onPauseReceiver={handlePauseReceiver}
            onResumeReceiver={handleResumeReceiver}
          />
        );
      case "positions":
        return (
          <PreviewPositions
            positions={positions}
            heartbeat={heartbeat}
            isMasterOnline={previewState.isConnected}
          />
        );
      case "receivers":
        return (
          <PreviewReceiverGrid
            receiverTerminals={mockReceiverTerminals}
            onPauseReceiver={handlePauseReceiver}
            onResumeReceiver={handleResumeReceiver}
          />
        );
      case "activity":
        return <PreviewExecutionLog executions={executions} />;
      case "terminals":
        return <PreviewTerminals terminals={allTerminals} />;
      case "settings":
        return <PreviewSettings status={status} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <PreviewSidebar
        activeItem={activeNav}
        onNavigate={setActiveNav}
        status={status}
        masterHeartbeat={previewState.isConnected ? heartbeatTime : null}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {renderContent()}
      </main>

      {/* Floating Controls */}
      <PreviewControls
        state={previewState}
        onStateChange={setPreviewState}
        onSimulateTrade={handleSimulateTrade}
        onReset={handleReset}
      />
    </div>
  );
}
