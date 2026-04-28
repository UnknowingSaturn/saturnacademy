import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SharedReport, SharedReportTrade, PublicReportPayload } from "@/types/sharedReports";

function genSlug() {
  return "r_" + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 5);
}

export function useSharedReports() {
  return useQuery({
    queryKey: ["shared_reports"],
    queryFn: async (): Promise<SharedReport[]> => {
      const { data, error } = await supabase
        .from("shared_reports")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SharedReport[];
    },
  });
}

export function useSharedReport(id: string | null) {
  return useQuery({
    queryKey: ["shared_report", id],
    enabled: !!id,
    queryFn: async (): Promise<{ report: SharedReport; trades: SharedReportTrade[] } | null> => {
      if (!id) return null;
      const [{ data: report, error: rErr }, { data: trades, error: tErr }] = await Promise.all([
        supabase.from("shared_reports").select("*").eq("id", id).maybeSingle(),
        supabase.from("shared_report_trades").select("*").eq("shared_report_id", id).order("sort_order"),
      ]);
      if (rErr) throw rErr;
      if (tErr) throw tErr;
      if (!report) return null;
      return { report: report as unknown as SharedReport, trades: (trades || []) as unknown as SharedReportTrade[] };
    },
  });
}

export function useCreateSharedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title?: string; period_start?: string; period_end?: string; live_mode?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("shared_reports")
        .insert({
          user_id: user.id,
          slug: genSlug(),
          title: input.title || "Untitled report",
          period_start: input.period_start || null,
          period_end: input.period_end || null,
          visibility: "private",
          live_mode: !!input.live_mode,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SharedReport;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shared_reports"] });
      toast.success("Report draft created");
    },
    onError: (e: Error) => toast.error(`Create failed: ${e.message}`),
  });
}

export function useUpdateSharedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<SharedReport> }) => {
      const { data, error } = await supabase
        .from("shared_reports")
        .update(input.patch as any)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SharedReport;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["shared_reports"] });
      qc.invalidateQueries({ queryKey: ["shared_report", data.id] });
    },
    onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
  });
}

export function useDeleteSharedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shared_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shared_reports"] });
      toast.success("Report deleted");
    },
  });
}

export function useAddTradeToReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { shared_report_id: string; trade_id: string; sort_order: number }) => {
      const { data, error } = await supabase
        .from("shared_report_trades")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["shared_report", vars.shared_report_id] });
    },
  });
}

export function useUpdateReportTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; shared_report_id: string; patch: Partial<SharedReportTrade> }) => {
      const { error } = await supabase
        .from("shared_report_trades")
        .update(input.patch as any)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["shared_report", vars.shared_report_id] });
    },
  });
}

export function useRemoveTradeFromReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; shared_report_id: string }) => {
      const { error } = await supabase.from("shared_report_trades").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["shared_report", vars.shared_report_id] });
    },
  });
}

export function usePublicReport(slug: string | undefined) {
  return useQuery({
    queryKey: ["public_report", slug],
    enabled: !!slug,
    queryFn: async (): Promise<PublicReportPayload | null> => {
      if (!slug) return null;
      const { data, error } = await supabase.functions.invoke("get-shared-report", {
        body: { slug },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as PublicReportPayload;
    },
    retry: false,
    // Auto-refresh only when the report is in live mode, so static snapshots
    // keep the original one-shot fetch behaviour.
    refetchInterval: (query) =>
      (query.state.data as PublicReportPayload | null)?.report?.live_mode ? 60_000 : false,
    refetchOnWindowFocus: (query) =>
      !!(query.state.data as PublicReportPayload | null)?.report?.live_mode,
  });
}
