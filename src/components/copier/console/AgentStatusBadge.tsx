import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { heartbeatHealth, useTickEverySeconds } from "@/hooks/useAgentState";

interface Props {
  lastHeartbeatAt: string | null | undefined;
  status?: string;
}

const COPY = {
  fresh: { label: "Online", variant: "default" as const, hint: "Heartbeat <30s ago" },
  stale: { label: "Lagging", variant: "secondary" as const, hint: "Heartbeat 30s-2min" },
  dead: { label: "Offline", variant: "destructive" as const, hint: "No heartbeat for 2+ min" },
  unknown: { label: "Unknown", variant: "outline" as const, hint: "Never heard from agent" },
};

export function AgentStatusBadge({ lastHeartbeatAt, status }: Props) {
  useTickEverySeconds(10);
  const health = heartbeatHealth(lastHeartbeatAt);
  const copy = COPY[health];
  const label = status && health !== "dead" && health !== "unknown" ? `${copy.label} · ${status}` : copy.label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={copy.variant}>{label}</Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          <div>{copy.hint}</div>
          {lastHeartbeatAt && (
            <div className="text-muted-foreground">
              Last: {new Date(lastHeartbeatAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
