import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { SymbolAlias } from "@/lib/symbolAliasing";

export function useSymbolAliases() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["symbol_aliases", user?.id],
    queryFn: async (): Promise<SymbolAlias[]> => {
      if (!user?.id) return [];
      const { data, error } = await (supabase as any)
        .from("symbol_aliases")
        .select("raw_symbol, canonical_symbol, source")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data ?? []) as SymbolAlias[];
    },
    enabled: !!user?.id,
  });
}

export function useUpsertSymbolAlias() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      raw_symbol: string;
      canonical_symbol: string;
      source?: "manual" | "auto";
    }) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await (supabase as any)
        .from("symbol_aliases")
        .upsert(
          {
            user_id: user.id,
            raw_symbol: input.raw_symbol,
            canonical_symbol: input.canonical_symbol.trim().toUpperCase(),
            source: input.source ?? "manual",
          },
          { onConflict: "user_id,raw_symbol" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["symbol_aliases", user?.id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save alias"),
  });
}

export function useDeleteSymbolAlias() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (raw_symbol: string) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await (supabase as any)
        .from("symbol_aliases")
        .delete()
        .eq("user_id", user.id)
        .eq("raw_symbol", raw_symbol);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["symbol_aliases", user?.id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to remove alias"),
  });
}

export function useBulkUpsertSymbolAliases() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (
      rows: Array<{ raw_symbol: string; canonical_symbol: string; source?: "manual" | "auto" }>,
    ) => {
      if (!user?.id) throw new Error("Not authenticated");
      if (rows.length === 0) return;
      const payload = rows.map((r) => ({
        user_id: user.id,
        raw_symbol: r.raw_symbol,
        canonical_symbol: r.canonical_symbol.trim().toUpperCase(),
        source: r.source ?? "manual",
      }));
      const { error } = await (supabase as any)
        .from("symbol_aliases")
        .upsert(payload, { onConflict: "user_id,raw_symbol" });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["symbol_aliases", user?.id] });
      toast.success(`Saved ${vars.length} alias${vars.length === 1 ? "" : "es"}.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save aliases"),
  });
}
