import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface SymbolGroup {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  symbols: string[];
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
      return (data ?? []) as SymbolGroup[];
    },
  });

  const create = useMutation({
    mutationFn: async (input: { name: string; color?: string | null; symbols: string[] }) => {
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("symbol_groups")
        .insert({
          user_id: user.id,
          name: input.name,
          color: input.color ?? null,
          symbols: input.symbols,
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
    mutationFn: async (input: { id: string; name?: string; color?: string | null; symbols?: string[] }) => {
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

  return {
    groups: query.data ?? [],
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
