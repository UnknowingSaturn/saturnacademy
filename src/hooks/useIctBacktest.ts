// ============================================================================
// useIctBacktest — Layer 4 orchestration.
//
//   bar_manifest (which months exist)
//     → download `.bin` chunks from the private `bars` bucket (cached per path)
//     → hand the ArrayBuffers to the backtest worker (transferred)
//     → latest request id wins
//
// Runs only when explicitly triggered (`run()`), because a multi-year 1-minute
// backtest downloads tens of MB; we never fire it on a slider drag.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EngineConfig } from "../../shared/quant/ict/engine";
import type {
  IctBacktestRequest,
  IctBacktestResponse,
} from "@/workers/ictBacktest.worker";

const BUCKET = "bars";

/** Module-level chunk cache: object path → bytes. Survives tab switches. */
const chunkCache = new Map<string, ArrayBuffer>();

export interface RunParams {
  symbol: string;
  /** Inclusive month bounds, "YYYY-MM". */
  fromMonth: string;
  toMonth: string;
  cfg: Partial<EngineConfig>;
}

export interface BacktestState {
  result: IctBacktestResponse | null;
  isRunning: boolean;
  phase: "idle" | "loading" | "computing";
  loaded: number;
  total: number;
  error: string | null;
}

async function loadChunk(path: string): Promise<ArrayBuffer> {
  const cached = chunkCache.get(path);
  if (cached) return cached.slice(0); // worker transfers ⇒ hand out a copy

  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(`Failed to download ${path}: ${error?.message ?? "no data"}`);
  }
  const buf = await data.arrayBuffer();
  chunkCache.set(path, buf);
  return buf.slice(0);
}

function monthStartMs(month: string): number {
  return Date.parse(`${month}-01T00:00:00Z`);
}
function monthEndMs(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return Date.parse(
    `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00Z`,
  ) - 1;
}

export function useIctBacktest(): BacktestState & { run: (p: RunParams) => void } {
  const [state, setState] = useState<BacktestState>({
    result: null,
    isRunning: false,
    phase: "idle",
    loaded: 0,
    total: 0,
    error: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const lastId = useRef(0);
  const aliveRef = useRef(true);

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
    const w = new Worker(
      new URL("../workers/ictBacktest.worker.ts", import.meta.url),
      { type: "module" },
    );
    w.onmessage = (e: MessageEvent<IctBacktestResponse>) => {
      if (!aliveRef.current) return;
      if (e.data.id !== lastId.current) return; // stale
      setState((s) => ({
        ...s,
        isRunning: false,
        phase: "idle",
        result: e.data.ok ? e.data : null,
        error: e.data.ok ? null : e.data.error ?? "Backtest failed",
      }));
    };
    const fail = (msg: string) => {
      if (!aliveRef.current) return;
      setState((s) => ({ ...s, isRunning: false, phase: "idle", error: msg }));
    };
    w.onerror = (ev) => fail(ev.message || "Backtest worker crashed");
    w.onmessageerror = () => fail("Backtest worker sent an unreadable message");
    workerRef.current = w;
    return w;
  }, []);

  const run = useCallback(
    (p: RunParams) => {
      const id = ++lastId.current;
      const worker = ensureWorker();
      setState({
        result: null,
        isRunning: true,
        phase: "loading",
        loaded: 0,
        total: 0,
        error: null,
      });

      void (async () => {
        try {
          const { data: months, error } = await supabase
            .from("bar_manifest")
            .select("month,object_path,bar_count")
            .eq("symbol", p.symbol.toUpperCase())
            .eq("timeframe", "1m")
            .gte("month", p.fromMonth)
            .lte("month", p.toMonth)
            .order("month", { ascending: true });
          if (error) throw new Error(error.message);
          const rows = (months ?? []).filter((r) => (r.bar_count ?? 0) > 0);
          if (rows.length === 0) {
            throw new Error(
              `No ingested bars for ${p.symbol} between ${p.fromMonth} and ${p.toMonth}. Queue the months in Data coverage first.`,
            );
          }
          if (id !== lastId.current) return;
          setState((s) => ({ ...s, total: rows.length }));

          const chunks: ArrayBuffer[] = [];
          for (const row of rows) {
            if (id !== lastId.current) return; // superseded
            chunks.push(await loadChunk(row.object_path));
            if (!aliveRef.current) return;
            setState((s) => ({ ...s, loaded: s.loaded + 1 }));
          }
          if (id !== lastId.current || !aliveRef.current) return;

          setState((s) => ({ ...s, phase: "computing" }));
          const req: IctBacktestRequest = {
            id,
            symbol: p.symbol.toUpperCase(),
            chunks,
            fromMs: monthStartMs(p.fromMonth),
            toMs: monthEndMs(p.toMonth),
            cfg: p.cfg,
          };
          worker.postMessage(req, chunks);
        } catch (err) {
          if (id !== lastId.current || !aliveRef.current) return;
          setState((s) => ({
            ...s,
            isRunning: false,
            phase: "idle",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      })();
    },
    [ensureWorker],
  );

  return { ...state, run };
}
