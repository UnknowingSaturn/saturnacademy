import { DollarSign, Link2, Settings2, Shield, Clock } from "lucide-react";

interface Tab {
  key: string;
  label: string;
  icon: React.ReactNode;
}

interface ConfigurationTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
  isGlobal?: boolean;
}

const TABS: Tab[] = [
  { key: "risk", label: "Risk", icon: <DollarSign className="w-4 h-4" /> },
  { key: "symbols", label: "Symbols", icon: <Link2 className="w-4 h-4" /> },
  { key: "overrides", label: "Overrides", icon: <Settings2 className="w-4 h-4" /> },
  { key: "safety", label: "Safety", icon: <Shield className="w-4 h-4" /> },
  { key: "sessions", label: "Sessions", icon: <Clock className="w-4 h-4" /> },
];

export function ConfigurationTabs({ activeTab, onTabChange, children, isGlobal }: ConfigurationTabsProps) {
  return (
    <div className="h-full flex flex-col">
      {/* Tab Headers */}
      <div className="flex items-center gap-1 p-2 border-b border-border bg-card/50">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
        
        {/* Global Badge */}
        {isGlobal && (
          <span className="ml-auto text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
            Editing Global Defaults
          </span>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
    </div>
  );
}
