import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { BacktestDashboard } from "@/components/strategy-lab/BacktestDashboard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles } from "lucide-react";

export default function StrategyLab() {
  const { user } = useAuth();
  const { data: playbooks } = usePlaybooks();
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("none");
  const selectedPlaybook = playbooks?.find((p) => p.id === selectedPlaybookId);

  if (!user) return null;

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden">
      <div className="border-b border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="font-semibold text-foreground">Strategy Lab</h1>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Walk-forward backtesting workbench
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Select value={selectedPlaybookId} onValueChange={setSelectedPlaybookId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select playbook" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No playbook</SelectItem>
                {playbooks?.map((pb) => (
                  <SelectItem key={pb.id} value={pb.id}>
                    {pb.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <BacktestDashboard
          selectedPlaybookId={selectedPlaybookId}
          playbookName={selectedPlaybook?.name}
        />
      </div>
    </div>
  );
}
