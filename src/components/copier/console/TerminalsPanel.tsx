import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScanLine } from "lucide-react";
import type { AgentStateRow } from "@/hooks/useAgentState";
import { useAgentCommand } from "@/hooks/useAgentCommand";

interface Props {
  agent: AgentStateRow;
}

export function TerminalsPanel({ agent }: Props) {
  const { dispatch, pending } = useAgentCommand();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Terminals discovered</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => dispatch({ installId: agent.install_id, command: "rescan_terminals" })}
          disabled={pending}
        >
          <ScanLine className="h-3.5 w-3.5 mr-1.5" />
          Rescan
        </Button>
      </CardHeader>
      <CardContent>
        {agent.terminals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No MT5 installs detected.</p>
        ) : (
          <div className="space-y-2">
            {agent.terminals.map((t) => (
              <div
                key={t.install_id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs truncate">{t.install_id}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t.data_path ?? "—"}
                  </div>
                </div>
                <div className="text-xs text-right shrink-0">
                  <div>{t.active_login ?? t.account_number ?? "—"}</div>
                  <div className={t.ea_attached ? "text-emerald-500" : "text-muted-foreground"}>
                    EA {t.ea_attached ? "attached" : "missing"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
