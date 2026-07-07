import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useCallback, useEffect, useRef } from "react";

export type SimulatorSource = "manual" | "active_account";

/**
 * Per-user last-used Pair Lab filter state. Hydrated on Pair Lab mount when
 * the URL doesn't specify a given value; any URL param present at mount wins
 * over the persisted preference (so shared / deep links keep working).
 * `asOf` and per-cell selection are intentionally NOT persisted — they're
 * session-scoped and would confuse the user across reloads.
 */
export interface PairLabPrefs {
  profile?: string;              // "any" | profile tag
  propFirmMode?: boolean;
  includeUnrealized?: boolean;
  includeUnassigned?: boolean;
  scope?: string;                // "all" | "grp:<id>"
  tab?: "overview" | "grid" | "windows" | "strategy" | "setup";
  lens?: "all" | "90d" | "30d";
}

export interface SimulatorProfile {
  sim_balance: number;
  sim_prop_firm: string | null;
  sim_risk_per_trade_pct: number;
  sim_hard_cap_pct: number;
  sim_source: SimulatorSource;
  /** Biggest peak-to-trough drawdown the trader would stay calm through, as %.
   *  Drives the Strategy Ranker's "Suggested risk" and Verdict columns. */
  ranker_comfort_dd_pct: number;
  /** Persisted Pair Lab filter state. */
  pair_lab_prefs: PairLabPrefs;
}

export const DEFAULT_SIM_PROFILE: SimulatorProfile = {
  sim_balance: 100000,
  sim_prop_firm: null,
  sim_risk_per_trade_pct: 1,
  sim_hard_cap_pct: 2,
  sim_source: "manual",
  ranker_comfort_dd_pct: 10,
  pair_lab_prefs: {},
};

export function useSimulatorProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["simulator_profile", user?.id],
    queryFn: async (): Promise<SimulatorProfile> => {
      if (!user?.id) return DEFAULT_SIM_PROFILE;
      const { data, error } = await supabase
        .from("user_settings")
        .select(
          "sim_balance, sim_prop_firm, sim_risk_per_trade_pct, sim_hard_cap_pct, sim_source, ranker_comfort_dd_pct",
        )
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULT_SIM_PROFILE;
      return {
        sim_balance: Number(data.sim_balance ?? DEFAULT_SIM_PROFILE.sim_balance),
        sim_prop_firm: (data.sim_prop_firm as string | null) ?? null,
        sim_risk_per_trade_pct: Number(
          data.sim_risk_per_trade_pct ?? DEFAULT_SIM_PROFILE.sim_risk_per_trade_pct,
        ),
        sim_hard_cap_pct: Number(
          data.sim_hard_cap_pct ?? DEFAULT_SIM_PROFILE.sim_hard_cap_pct,
        ),
        sim_source:
          (data.sim_source as SimulatorSource) ?? DEFAULT_SIM_PROFILE.sim_source,
        ranker_comfort_dd_pct: Number(
          (data as { ranker_comfort_dd_pct?: number | null }).ranker_comfort_dd_pct ??
            DEFAULT_SIM_PROFILE.ranker_comfort_dd_pct,
        ),
      };
    },
    enabled: !!user?.id,
  });
}

export function useUpdateSimulatorProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<SimulatorProfile>) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { data: existing } = await supabase
        .from("user_settings")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("user_settings")
          .update(updates as any)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_settings")
          .insert({ user_id: user.id, ...(updates as any) });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["simulator_profile"] });
      toast.success("Simulator profile saved");
    },
    onError: (e) => {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Save failed");
    },
  });
}

export function usePropFirms() {
  return useQuery({
    queryKey: ["prop_firms_list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prop_firms")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });
}
