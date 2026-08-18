// ============================================================================
// useMt5Import — parse an MT5 M1 CSV export in a worker, preview it, then
// upload one encoded month at a time through `ingest-bars` (action "import").
//
// Two-step on purpose: nothing is written until the user has seen the detected
// broker offset and the per-month coverage, because a wrong offset silently
// shifts every killzone in the backtest.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type {
  Mt5AnalyzeResponse,
  Mt5ImportRequest,
  Mt5ImportResponse,
  MonthPreview,
} from "@/workers/mt5Import.worker";

export interface ImportPreview extends Omit<Mt5AnalyzeResponse, "id" | "phase" | "ok"> {
  fileName: string;
  months: MonthPreview[];
}

export interface UploadProgress {
  done: number;
  total: number;
  current: string | null;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000; // avoid blowing the argument stack on ~2 MB payloads
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function callIngest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ingest-bars", { body });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: { body?: unknown } }).context;
    if (ctx?.body) {
      try {
        const parsed = typeof ctx.body === "string" ? JSON.parse(ctx.body) : ctx.body;
        if ((parsed as { error?: string })?.error) detail = (parsed as { error: string }).error;
      } catch { /* keep the generic message */ }
    }
    throw new Error(detail);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

export function useMt5Import() {
  const qc = useQueryClient();
  const workerRef = useRef<Worker | null>(null);
  const textRef = useRef<string>("");
  const lastId = useRef(0);
  const aliveRef = useRef(true);
  const pending = useRef<Map<number, (r: Mt5ImportResponse) => void>>(new Map());

  const [isParsing, setIsParsing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress>({ done: 0, total: 0, current: null });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new Worker(new URL("../workers/mt5Import.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<Mt5ImportResponse>) => {
      pending.current.get(e.data.id)?.(e.data);
      pending.current.delete(e.data.id);
    };
    w.onerror = (ev) => {
      const msg = ev.message || "Import worker crashed";
      for (const resolve of pending.current.values()) {
        resolve({ id: -1, phase: "analyze", ok: false, error: msg });
      }
      pending.current.clear();
    };
    workerRef.current = w;
    return w;
  }, []);

  const ask = useCallback(
    (req: Omit<Mt5ImportRequest, "id">): Promise<Mt5ImportResponse> => {
      const worker = ensureWorker();
      const id = ++lastId.current;
      return new Promise((resolve) => {
        pending.current.set(id, resolve);
        worker.postMessage({ ...req, id } as Mt5ImportRequest);
      });
    },
    [ensureWorker],
  );

  /** Read + parse a file, or re-analyze the loaded file with a corrected offset. */
  const analyze = useCallback(
    async (file: File | null, offsetMinutes: number | null) => {
      setIsParsing(true);
      setError(null);
      try {
        if (file) textRef.current = await file.text();
        if (!textRef.current) throw new Error("No file loaded");
        const res = await ask({ phase: "analyze", text: textRef.current, offsetMinutes });
        if (!aliveRef.current) return;
        if (!res.ok || res.phase !== "analyze") throw new Error(res.error ?? "Parse failed");
        setPreview({
          fileName: file?.name ?? preview?.fileName ?? "history.csv",
          offsetMinutes: res.offsetMinutes,
          offsetConfident: res.offsetConfident,
          offsetSamples: res.offsetSamples,
          delimiter: res.delimiter,
          hadHeader: res.hadHeader,
          stepMs: res.stepMs,
          totalBars: res.totalBars,
          skipped: res.skipped,
          issues: res.issues,
          duplicates: res.duplicates,
          months: res.months ?? [],
        });
      } catch (e) {
        if (!aliveRef.current) return;
        setPreview(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (aliveRef.current) setIsParsing(false);
      }
    },
    [ask, preview?.fileName],
  );

  /** Encode with the confirmed offset and upload every month sequentially. */
  const commit = useCallback(
    async (symbol: string, offsetMinutes: number, months?: string[]) => {
      setIsUploading(true);
      setError(null);
      try {
        const res = await ask({ phase: "encode", text: textRef.current, offsetMinutes });
        if (!res.ok || res.phase !== "encode") throw new Error(res.error ?? "Encode failed");
        const wanted = months?.length ? new Set(months) : null;
        const list = (res.months ?? []).filter((m) => !wanted || wanted.has(m.month));
        setProgress({ done: 0, total: list.length, current: null });

        let bars = 0;
        for (const m of list) {
          if (!aliveRef.current) return;
          setProgress((p) => ({ ...p, current: m.month }));
          const out = await callIngest<{ barCount: number }>({
            action: "import",
            symbol,
            month: m.month,
            chunk: toBase64(m.bytes),
          });
          bars += out.barCount;
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
        await qc.invalidateQueries({ queryKey: ["bar-coverage"] });
        toast.success(
          `Imported ${list.length} month${list.length === 1 ? "" : "s"} of ${symbol} — ${bars.toLocaleString()} bars`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (aliveRef.current) setError(msg);
        toast.error(msg);
      } finally {
        if (aliveRef.current) {
          setIsUploading(false);
          setProgress({ done: 0, total: 0, current: null });
        }
      }
    },
    [ask, qc],
  );

  const reset = useCallback(() => {
    textRef.current = "";
    setPreview(null);
    setError(null);
  }, []);

  return { analyze, commit, reset, preview, isParsing, isUploading, progress, error };
}
