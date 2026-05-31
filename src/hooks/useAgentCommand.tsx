import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AgentCommand =
  | "pause_receiver"
  | "resume_receiver"
  | "sync_positions"
  | "rescan_terminals"
  | "reload_config";

interface DispatchOptions {
  installId: string;
  command: AgentCommand;
  payload?: Record<string, unknown>;
  /** Max time to wait for desktop to complete the command. */
  timeoutMs?: number;
}

/**
 * Inserts a row into agent_commands via the agent-commands edge function and
 * polls until status becomes `done` or `error`. Returns the final row.
 */
export function useAgentCommand() {
  const [pending, setPending] = useState(false);

  const dispatch = useCallback(
    async ({ installId, command, payload, timeoutMs = 15_000 }: DispatchOptions) => {
      setPending(true);
      try {
        const { data, error } = await supabase.functions.invoke("agent-commands", {
          body: { install_id: installId, command, payload: payload ?? {} },
        });
        if (error) throw error;
        const commandId = (data as any)?.id as string;
        if (!commandId) throw new Error("no command id returned");

        const deadline = Date.now() + timeoutMs;
        let last: any = null;
        while (Date.now() < deadline) {
          const { data: row } = await supabase
            .from("agent_commands")
            .select("status, result, error_message")
            .eq("id", commandId)
            .maybeSingle();
          last = row;
          if (row?.status === "done") return row;
          if (row?.status === "error") {
            throw new Error(row.error_message || "agent reported error");
          }
          await new Promise((r) => setTimeout(r, 750));
        }
        toast.warning(
          "Command sent but desktop agent hasn't confirmed yet. It will run when the agent next polls.",
        );
        return last;
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to dispatch command");
        throw e;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { dispatch, pending };
}
