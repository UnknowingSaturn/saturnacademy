import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface DormantAccount {
  id: string;
  pending_repairs?: number;
}

/**
 * Shared lookup of pending repair counts per account, sourced from the
 * trade-repair `list-drift` endpoint. Used by AccountCard to surface a
 * Repair CTA in the right place (Accounts page) instead of the Journal.
 */
export function usePendingRepairs() {
  return useQuery({
    queryKey: ["pending-repairs"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("trade-repair", {
        body: { action: "list-drift" },
      });
      if (error) throw error;
      const map = new Map<string, number>();
      for (const a of (data?.dormant_accounts ?? []) as DormantAccount[]) {
        if (a.pending_repairs) map.set(a.id, a.pending_repairs);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
