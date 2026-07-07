import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { setTickSizeOverrides } from "@/lib/symbolMapping";

export interface SymbolGroup {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  symbols: string[];
  /**
   * Per-symbol tick-size override map: { "BTCUSD": 1.0, "ETHUSD": 0.1 }.
   * Used by Pair Lab to correctly scale MAE / Ideal-SL on crypto and other
   * instruments whose broker tick size doesn't match the default classifier.
   */
  tick_size_overrides: Record<string, number>;
  created_at: string;
  updated_at: string;
}

const QK = ["symbol-groups"] as const;

export function useSymbolGroups() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: QK,
    enabled: !!user,
    queryFn: async (): Promise<SymbolGroup[]> => {
      const { data, error } = await supabase
        .from("symbol_groups")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...row,
        tick_size_overrides:
          row?.tick_size_overrides && typeof row.tick_size_overrides === "object"
            ? (row.tick_size_overrides as Record<string, number>)
            : {},
      })) as SymbolGroup[];
    },
  });

  // Install merged per-symbol tick-size overrides into the client-side
  // symbol mapping shim whenever the groups change. Later group keys win
  // on conflict — UI surfaces conflicts in the group editor.
  useEffect(() => {
    const merged: Record<string, number> = {};
    for (const g of query.data ?? []) {
      for (const [k, v] of Object.entries(g.tick_size_overrides ?? {})) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) merged[k] = v;
      }
    }
    setTickSizeOverrides(merged);
  }, [query.data]);

  const create = useMutation({
    mutationFn: async (input: {
      name: string;
      color?: string | null;
      symbols: string[];
      tick_size_overrides?: Record<string, number>;
    }) => {
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("symbol_groups")
        .insert({
          user_id: user.id,
          name: input.name,
          color: input.color ?? null,
          symbols: input.symbols,
          tick_size_overrides: input.tick_size_overrides ?? {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as SymbolGroup;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("Group created");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create group"),
  });

  const update = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      color?: string | null;
      symbols?: string[];
      tick_size_overrides?: Record<string, number>;
    }) => {
      const { id, ...rest } = input;
      const { data, error } = await supabase
        .from("symbol_groups")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as SymbolGroup;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("Group updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update group"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("symbol_groups").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("Group deleted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete group"),
  });

  // Audit §1.3 + §3.3 M1: memoize the returned array so downstream memo deps
  // (usePairLab, PairLabWalkForwardContext) don't churn on every render.
  const groups = useMemo(() => query.data ?? [], [query.data]);

  return {
    groups,
    isLoading: query.isLoading,
    create,
    update,
    remove,
  };
}

export const GROUP_TEMPLATES: Array<{ name: string; color: string; symbols: string[] }> = [
  { name: "EUR majors", color: "#3b82f6", symbols: ["EURUSD", "EURGBP", "EURJPY", "EURCHF", "EURAUD"] },
  { name: "USD majors", color: "#10b981", symbols: ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD"] },
  { name: "JPY pairs", color: "#f59e0b", symbols: ["USDJPY", "EURJPY", "GBPJPY", "AUDJPY", "CHFJPY"] },
  { name: "Metals", color: "#eab308", symbols: ["XAUUSD", "XAGUSD"] },
  { name: "Indices", color: "#a855f7", symbols: ["US30", "US100", "US500", "NAS100", "SPX500", "GER40", "UK100"] },
];
