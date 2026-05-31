import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgentState, type AgentStateRow } from "@/hooks/useAgentState";
import { AgentStatusBadge } from "@/components/copier/console/AgentStatusBadge";
import { ReceiversPanel } from "@/components/copier/console/ReceiversPanel";
import { TerminalsPanel } from "@/components/copier/console/TerminalsPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function CopierConsole() {
  const { data: agents, isLoading } = useAgentState();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Copier Console</h1>
        <p className="text-muted-foreground">
          Live control surface for your desktop copier agents. Pause/resume receivers,
          rescan terminals, and trigger position sync from the web.
        </p>
      </div>

      {!isLoading && (!agents || agents.length === 0) && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>No agents paired yet</AlertTitle>
          <AlertDescription>
            Install the desktop agent and pair it with your account from the existing
            setup screen. Once it sends its first heartbeat, it will appear here.
          </AlertDescription>
        </Alert>
      )}

      {agents?.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentStateRow }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="min-w-0">
          <CardTitle className="text-lg truncate">Agent {agent.install_id}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {agent.version ? `v${agent.version}` : "version unknown"}
          </p>
        </div>
        <AgentStatusBadge lastHeartbeatAt={agent.last_heartbeat_at} status={agent.status} />
      </CardHeader>
      <CardContent className="space-y-4">
        {agent.last_error && (
          <Alert variant="destructive">
            <AlertDescription>{agent.last_error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <TerminalsPanel agent={agent} />
          <ReceiversPanel agent={agent} />
        </div>
      </CardContent>
    </Card>
  );
}
