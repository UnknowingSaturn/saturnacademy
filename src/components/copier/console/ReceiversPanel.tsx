import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pause, Play, RefreshCw, RotateCw } from "lucide-react";
import type { AgentStateRow, ReceiverStatus } from "@/hooks/useAgentState";
import { useAgentCommand } from "@/hooks/useAgentCommand";

interface Props {
  agent: AgentStateRow;
}

export function ReceiversPanel({ agent }: Props) {
  const { dispatch, pending } = useAgentCommand();

  const togglePause = async (receiver: ReceiverStatus) => {
    await dispatch({
      installId: agent.install_id,
      command: receiver.paused ? "resume_receiver" : "pause_receiver",
      payload: { account_id: receiver.account_id },
    });
  };

  const syncPositions = async (receiver: ReceiverStatus) => {
    await dispatch({
      installId: agent.install_id,
      command: "sync_positions",
      payload: { account_id: receiver.account_id },
    });
  };

  const reloadConfig = async () => {
    await dispatch({ installId: agent.install_id, command: "reload_config" });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Receivers</CardTitle>
        <Button size="sm" variant="outline" onClick={reloadConfig} disabled={pending}>
          <RotateCw className="h-3.5 w-3.5 mr-1.5" />
          Reload config
        </Button>
      </CardHeader>
      <CardContent>
        {agent.receivers_status.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No receivers reported by this agent yet.
          </p>
        ) : (
          <div className="space-y-2">
            {agent.receivers_status.map((r) => (
              <div
                key={r.account_id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {r.name ?? r.account_id}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.paused ? "Paused" : "Active"}
                    {r.last_execution_at && (
                      <> · last exec {new Date(r.last_execution_at).toLocaleTimeString()}</>
                    )}
                    {r.last_error && <span className="text-destructive"> · {r.last_error}</span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncPositions(r)}
                    disabled={pending}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Sync
                  </Button>
                  <Button
                    size="sm"
                    variant={r.paused ? "default" : "secondary"}
                    onClick={() => togglePause(r)}
                    disabled={pending}
                  >
                    {r.paused ? (
                      <>
                        <Play className="h-3.5 w-3.5 mr-1.5" /> Resume
                      </>
                    ) : (
                      <>
                        <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
