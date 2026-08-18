// ============================================================================
// useBarCoverage — bar ingestion control surface for the Backtest tab.
//
// Reads the `ingest-bars` status snapshot (instruments, manifest, job queue)
// and exposes enqueue / drain mutations. Drain is bounded on the server; the
// UI just re-polls until the queue empties.
// ============================================================================

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DukascopyInstrument {
  code: string;
  symbol: string;
  priceDivisor: number;
  since: string;
}

export interface ManifestRow {
  symbol: string;
  month: string;
  source: string;
  bar_count: number;
  first_ts: string | null;
  last_ts: string | null;
  byte_size: number;
  missing_minutes: number;
  missing_days: string[] | null;
}

export interface JobRow {
  symbol: string;
  month: string;
  source: string;
  status: string;
  attempts: number;
  last_error: string | null;
}

export interface CoverageSnapshot {
  instruments: DukascopyInstrument[];
  /** Symbols with at least one manifest row (includes broker uploads). */
  importedSymbols: string[];
  manifest: ManifestRow[];
  jobs: JobRow[];
  jobCounts: Record<string, number>;
}

async function callIngest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ingest-bars", { body });
  if (error) {
    // Edge errors carry a JSON body with the real message.
    let detail = error.message;
    // deno-lint-ignore no-explicit-any
    const ctx = (error as any).context;
    if (ctx?.body) {
      try {
        const parsed = typeof ctx.body === "string" ? JSON.parse(ctx.body) : ctx.body;
        if (parsed?.error) detail = parsed.error;
      } catch { /* keep the generic message */ }
    }
    throw new Error(detail);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

export function useBarCoverage(symbol: string | null) {
  const qc = useQueryClient();
  const [isDraining, setIsDraining] = useState(false);

  const query = useQuery({
    queryKey: ["bar-coverage", symbol ?? "all"],
    queryFn: () => callIngest<CoverageSnapshot>({ action: "status", symbol }),
    staleTime: 30_000,
  });

  const enqueue = useMutation({
    mutationFn: (vars: { symbol: string; from: string; to: string }) =>
      callIngest<{ requested: number; queued: number; revived: number; skipped: number }>({
        action: "enqueue",
        ...vars,
      }),
    onSuccess: (r) => {
      toast.success(
        `Queued ${r.queued} month${r.queued === 1 ? "" : "s"}` +
          (r.revived ? `, retrying ${r.revived} failed` : "") +
          (r.skipped ? `, ${r.skipped} already present` : ""),
      );
      void qc.invalidateQueries({ queryKey: ["bar-coverage"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Drain in bounded passes until the server reports an empty queue. */
  const drain = useCallback(async () => {
    setIsDraining(true);
    try {
      for (let pass = 0; pass < 20; pass++) {
        const r = await callIngest<{ processed: unknown[]; remaining: number }>({
          action: "drain",
          maxJobs: 3,
        });
        await qc.invalidateQueries({ queryKey: ["bar-coverage"] });
        if (r.remaining === 0) {
          toast.success("Bar ingestion queue is empty");
          return;
        }
        if (pass === 19) {
          toast.message(`${r.remaining} month(s) still queued — run again to continue`);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setIsDraining(false);
    }
  }, [qc]);

  return {
    snapshot: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
    enqueue,
    drain,
    isDraining,
  };
}
