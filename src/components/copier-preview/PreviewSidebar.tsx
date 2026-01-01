import { useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Cpu,
  LayoutDashboard,
  List,
  Settings,
  Users,
  Wand2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { CopierStatus, NavItem } from "@/types/copier-preview";
import { toast } from "sonner";

interface NavButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  badge?: string | number;
}

function NavButton({ icon: Icon, label, active, collapsed, onClick, badge }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
      }`}
      title={collapsed ? label : undefined}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${active ? "text-primary" : ""}`} />
      {!collapsed && (
        <>
          <span className="text-sm font-medium">{label}</span>
          {badge !== undefined && (
            <span className="ml-auto text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
              {badge}
            </span>
          )}
        </>
      )}
      {collapsed && badge !== undefined && (
        <span className="absolute -top-1 -right-1 text-[10px] bg-primary text-primary-foreground w-4 h-4 rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}

interface PreviewSidebarProps {
  activeItem: NavItem;
  onNavigate: (item: NavItem) => void;
  status: CopierStatus | null;
  masterHeartbeat?: string | null;
}

export function PreviewSidebar({ activeItem, onNavigate, status, masterHeartbeat }: PreviewSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  const getHeartbeatText = () => {
    if (!masterHeartbeat) return "No heartbeat";
    const diff = Date.now() - new Date(masterHeartbeat).getTime();
    if (diff < 5000) return "Just now";
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return "Offline";
  };

  const isHeartbeatStale = () => {
    if (!masterHeartbeat) return true;
    const diff = Date.now() - new Date(masterHeartbeat).getTime();
    return diff > 30000;
  };

  const handleShowWizard = () => {
    toast.info("Setup Wizard", {
      description: "The setup wizard would open here in the desktop app",
    });
  };

  return (
    <aside
      className={`h-full flex flex-col border-r border-border bg-card transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">Saturn</span>
              <span className="text-[10px] text-muted-foreground">Trade Copier</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center mx-auto">
            <Activity className="w-4 h-4 text-primary" />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`p-1.5 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors ${
            collapsed ? "mx-auto mt-2" : ""
          }`}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Connection Status */}
      <div className={`p-3 border-b border-border ${collapsed ? "text-center" : ""}`}>
        <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
          {status?.is_connected ? (
            <Wifi className="w-4 h-4 text-green-500" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-500" />
          )}
          {!collapsed && (
            <span className={`text-xs ${status?.is_connected ? "text-green-500" : "text-red-500"}`}>
              {status?.is_connected ? "Connected" : "Disconnected"}
            </span>
          )}
        </div>
        {!collapsed && status?.is_connected && (
          <div className={`text-[10px] mt-1 ${isHeartbeatStale() ? "text-yellow-500" : "text-muted-foreground"}`}>
            Master: {getHeartbeatText()}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        <NavButton
          icon={LayoutDashboard}
          label="Dashboard"
          active={activeItem === "dashboard"}
          collapsed={collapsed}
          onClick={() => onNavigate("dashboard")}
        />
        <NavButton
          icon={List}
          label="Positions"
          active={activeItem === "positions"}
          collapsed={collapsed}
          onClick={() => onNavigate("positions")}
          badge={status?.open_positions || undefined}
        />
        <NavButton
          icon={Users}
          label="Receivers"
          active={activeItem === "receivers"}
          collapsed={collapsed}
          onClick={() => onNavigate("receivers")}
        />
        <NavButton
          icon={Activity}
          label="Activity"
          active={activeItem === "activity"}
          collapsed={collapsed}
          onClick={() => onNavigate("activity")}
        />
        <NavButton
          icon={Cpu}
          label="Terminals"
          active={activeItem === "terminals"}
          collapsed={collapsed}
          onClick={() => onNavigate("terminals")}
        />
        <NavButton
          icon={Settings}
          label="Settings"
          active={activeItem === "settings"}
          collapsed={collapsed}
          onClick={() => onNavigate("settings")}
        />
      </nav>

      {/* Footer Actions */}
      <div className="p-2 border-t border-border space-y-2">
        <button
          onClick={handleShowWizard}
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors ${
            collapsed ? "justify-center" : ""
          }`}
          title={collapsed ? "Run Setup Wizard" : undefined}
        >
          <Wand2 className="w-4 h-4" />
          {!collapsed && <span className="text-sm font-medium">Setup Wizard</span>}
        </button>

        {!collapsed && (
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] text-muted-foreground">v2.0.0</span>
            <div
              className={`w-2 h-2 rounded-full ${
                status?.is_running ? "bg-green-500 animate-pulse" : "bg-muted-foreground"
              }`}
              title={status?.is_running ? "Running" : "Stopped"}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
