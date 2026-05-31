import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface ReceiverStatus {
  account_id: string;
  name?: string;
  paused?: boolean;
  last_execution_at?: string | null;
  last_error?: string | null;
}

export interface TerminalInfo {
  install_id: string;
  data_path?: string;
  ea_attached?: boolean;
  active_login?: string | null;
  account_number?: string | null;
}

export interface AgentStateRow {
  id: string;
  user_id: string;
  install_id: string;
  status: string;
  version: string | null;
  last_heartbeat_at: string | null;
  terminals: TerminalInfo[];
  receivers_status: ReceiverStatus[];
  last_error: string | null;
  updated_at: string;
}

/**
 * Fetches all agent_state rows for the current user and subscribes to realtime
 * changes. Multiple installs (e.g. work + home PC) yield multiple rows.
 */
export function useAgentState() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["agent_state", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<AgentStateRow[]> => {
      const { data, error } = await supabase
        .from("agent_state")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("agent_state_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_state" },
        () => query.refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return query;
}

/** Heartbeat freshness bucketed for UI badges. */
export function heartbeatHealth(
  lastHeartbeatAt: string | null | undefined,
): "fresh" | "stale" | "dead" | "unknown" {
  if (!lastHeartbeatAt) return "unknown";
  const ageSec = (Date.now() - new Date(lastHeartbeatAt).getTime()) / 1000;
  if (ageSec < 30) return "fresh";
  if (ageSec < 120) return "stale";
  return "dead";
}

/** Bump component every 10s so heartbeat age recomputes without realtime hit. */
export function useTickEverySeconds(seconds = 10) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), seconds * 1000);
    return () => clearInterval(i);
  }, [seconds]);
}
