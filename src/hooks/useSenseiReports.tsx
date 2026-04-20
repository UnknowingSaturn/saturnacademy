import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Report, ReportType } from "@/types/reports";
import { toast } from "sonner";

export function useReportsList() {
  return useQuery({
    queryKey: ["reports", "list"],
    queryFn: async (): Promise<Report[]> => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Report[];
    },
  });
}

export function useReport(reportId: string | null) {
  return useQuery({
    queryKey: ["reports", "detail", reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<Report | null> => {
      if (!reportId) return null;
      const { data, error } = await supabase.from("reports").select("*").eq("id", reportId).maybeSingle();
      if (error) throw error;
      return (data as unknown as Report) || null;
    },
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { period_start: string; period_end: string; report_type: ReportType; account_id?: string | null }) => {
      const { data, error } = await supabase.functions.invoke("generate-report", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as any).report as Report;
    },
    onSuccess: (report) => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(report.status === "failed" ? "Report saved (AI section failed — see report)" : "Report generated");
    },
    onError: (e: Error) => {
      toast.error(`Failed to generate report: ${e.message}`);
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Report deleted");
    },
  });
}
