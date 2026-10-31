import { supabase } from "@/integrations/supabase/client";
import { buildJournalReport, ReportTradeRow } from "./journalReport";

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Fetches everything needed for the given trade ids and returns the Markdown. */
export async function loadJournalReport(tradeIds: string[]): Promise<string> {
  const ids = [...new Set(tradeIds)];
  const trades: ReportTradeRow[] = [];
  const reviews: any[] = [];
  const comments: any[] = [];
  for (const part of chunk(ids, 150)) {
    const [t, r, c] = await Promise.all([
      supabase.from("trades").select("*").in("id", part),
      supabase.from("trade_reviews").select("*").in("trade_id", part),
      supabase.from("trade_comments").select("trade_id, content, created_at").in("trade_id", part),
    ]);
    if (t.error) throw t.error;
    if (r.error) throw r.error;
    trades.push(...((t.data ?? []) as any));
    reviews.push(...(r.data ?? []));
    comments.push(...(c.data ?? []));
  }
  const [pb, fd] = await Promise.all([
    supabase.from("playbooks").select("*"),
    supabase.from("custom_field_definitions").select("key, label").eq("is_active", true),
  ]);
  return buildJournalReport({
    trades,
    reviews,
    comments,
    playbooks: (pb.data ?? []) as any,
    fieldDefs: (fd.data ?? []) as any,
  });
}

export function downloadMarkdown(md: string, filename: string) {
  const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
