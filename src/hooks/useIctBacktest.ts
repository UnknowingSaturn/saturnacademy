// ============================================================================
// useIctBacktest — Layer 4 orchestration.
//
//   bar_manifest (which months exist)
//     → coverage gate (refuse to run on months full of holes)
//     → download `.bin` chunks from the private `bars` bucket (cached per path)
//     → hand the ArrayBuffers to the backtest worker (transferred)
//     → persist the finished run to `backtest_runs` / `backtest_trades`
//     → latest request id wins
//
// Runs only when explicitly triggered (`run()`), because a multi-year 1-minute
// backtest downloads tens of MB; we never fire it on a slider drag.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSymbol } from "../../shared/quant/symbolAliasing";
import { configHash } from "../../shared/quant/ict/walkforward";
import type { EngineConfig } from "../../shared/quant/ict/engine";
import type { InstrumentSpec } from "../../shared/quant/ict/instruments";
import type {
  IctBacktestRequest,
  IctBacktestResponse,
  WalkForwardOptions,
} from "@/workers/ictBacktest.worker";

const BUCKET = "bars";

/**
 * A month with more holes than this is not tradeable data — the engine would
 * silently skip sessions and hand back a flattering, unrepresentative curve.
 * ~44,600 minutes in a month, so 6,000 ≈ 13% of the month missing.
 */
export const COVERAGE_GAP_LIMIT = 6000;

/** Module-level chunk cache: object path → bytes. Survives tab switches. */
const chunkCache = new Map<string, ArrayBuffer>();

export interface RunParams {
  symbol: string;
  /** Inclusive month bounds, "YYYY-MM". */
  fromMonth: string;
  toMonth: string;
  cfg: Partial<EngineConfig>;
  mode?: "single" | "walkforward";
  walkForward?: WalkForwardOptions;
  specOverride?: Partial<InstrumentSpec> | null;
  /**
   * Correlated instrument used by the SMT-divergence rule (e.g. GBPUSD or DXY
   * against EURUSD). Required only when `cfg.requireSmt` is on.
   */
  referenceSymbol?: string | null;

  /** Skip the data-quality gate (the UI asks before setting this). */
  ignoreCoverageGaps?: boolean;
  /** Persist to backtest_runs; off for throwaway parameter fiddling. */
  persist?: boolean;
  label?: string;
}

export interface CoverageWarning {
  months: string[];
  missingMinutes: number;
}

export interface BacktestState {
  result: IctBacktestResponse | null;
  isRunning: boolean;
  phase: "idle" | "loading" | "computing" | "saving";
  loaded: number;
  total: number;
  error: string | null;
  /** Set when the gate blocked the run; the UI offers "run anyway". */
  coverageWarning: CoverageWarning | null;
  savedRunId: string | null;
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

/** Persist the run + its fills. Failure here never invalidates the result. */
async function saveRun(
  p: RunParams,
  symbol: string,
  res: IctBacktestResponse,
): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;

  const config = { ...p.cfg, mode: p.mode ?? "single", walkForward: p.walkForward ?? null };
  const hash = configHash({ config, symbol, from: p.fromMonth, to: p.toMonth });

  const { data: run, error } = await supabase
    .from("backtest_runs")
    .insert({
      user_id: userId,
      label: p.label ?? `${symbol} ${p.fromMonth}→${p.toMonth}`,
      config: config as never,
      config_hash: hash,
      symbols: [symbol],
      date_from: `${p.fromMonth}-01`,
      date_to: `${p.toMonth}-01`,
      include_holdout: (p.mode ?? "single") === "walkforward",
      status: "complete",
      metrics: {
        summary: res.summary ?? null,
        stats: res.stats ?? null,
        walkForward: res.walkForward
          ? { ...res.walkForward, oosEquity: undefined }
          : null,
        barsScanned: res.barsScanned ?? 0,
      } as never,
      no_trade_log: (res.noTrades ?? []).slice(0, 500) as never,
      trade_count: res.summary?.trades ?? res.trades?.length ?? 0,
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(error?.message ?? "Could not save run");

  const trades = (res.trades ?? []).slice(0, 2000).map((t) => ({
    run_id: run.id,
    user_id: userId,
    symbol,
    session_date: t.sessionDate,
    window_key: t.windowKey,
    direction: t.direction,
    setup_ts: new Date(t.setupTs).toISOString(),
    entry_ts: new Date(t.entryTs).toISOString(),
    entry_price: t.entryPrice,
    stop_price: t.stopPrice,
    target_price: t.targetPrice,
    exit_ts: new Date(t.exitTs).toISOString(),
    exit_price: t.exitPrice,
    exit_reason: t.exitReason,
    bars_held: t.barsHeld,
    gross_pnl: t.grossPnl,
    net_pnl: t.netPnl,
    r_multiple: t.rMultiple,
    mae_points: t.maePoints,
    mfe_points: t.mfePoints,
    ambiguous_bar: t.ambiguousBar,
  }));
  if (trades.length) {
    const { error: tErr } = await supabase.from("backtest_trades").insert(trades);
    if (tErr) throw new Error(tErr.message);
  }
  return run.id;
}

export function useIctBacktest(): BacktestState & {
  run: (p: RunParams) => void;
  loadRun: (result: IctBacktestResponse) => void;
} {
  const [state, setState] = useState<BacktestState>({
    result: null,
    isRunning: false,
    phase: "idle",
    loaded: 0,
    total: 0,
    error: null,
    coverageWarning: null,
    savedRunId: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const lastId = useRef(0);
  const aliveRef = useRef(true);
  const paramsRef = useRef<Map<number, { p: RunParams; symbol: string }>>(new Map());

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
      const ctx = paramsRef.current.get(e.data.id);
      paramsRef.current.delete(e.data.id);

      if (!e.data.ok) {
        setState((s) => ({
          ...s,
          isRunning: false,
          phase: "idle",
          result: null,
          error: e.data.error ?? "Backtest failed",
        }));
        return;
      }

      setState((s) => ({
        ...s,
        isRunning: !!ctx?.p.persist,
        phase: ctx?.p.persist ? "saving" : "idle",
        result: e.data,
        error: null,
        savedRunId: null,
      }));

      if (ctx?.p.persist) {
        void saveRun(ctx.p, ctx.symbol, e.data)
          .then((id) => {
            if (!aliveRef.current || e.data.id !== lastId.current) return;
            setState((s) => ({ ...s, isRunning: false, phase: "idle", savedRunId: id }));
          })
          .catch((err: Error) => {
            if (!aliveRef.current || e.data.id !== lastId.current) return;
            // The result is still valid — surface the save failure separately.
            setState((s) => ({
              ...s,
              isRunning: false,
              phase: "idle",
              error: `Run finished but could not be saved: ${err.message}`,
            }));
          });
      }
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
      const symbol = normalizeSymbol(p.symbol.toUpperCase());
      paramsRef.current.set(id, { p, symbol });
      setState({
        result: null,
        isRunning: true,
        phase: "loading",
        loaded: 0,
        total: 0,
        error: null,
        coverageWarning: null,
        savedRunId: null,
      });

      void (async () => {
        try {
          const { data: months, error } = await supabase
            .from("bar_manifest")
            .select("month,object_path,bar_count,source,missing_minutes")
            .eq("symbol", symbol)
            .eq("timeframe", "1m")
            .gte("month", p.fromMonth)
            .lte("month", p.toMonth)
            .order("month", { ascending: true });
          if (error) throw new Error(error.message);
          // One chunk per month. When the same month exists from both the
          // broker upload and the vendor feed, the broker's own prices win —
          // they are the feed that filled the journalled trades.
          type Row = { month: string; object_path: string; source: string; missing_minutes: number | null };
          const byMonth = new Map<string, Row>();
          for (const r of (months ?? []) as Row[] & { bar_count?: number }[]) {
            if (((r as { bar_count?: number }).bar_count ?? 0) <= 0) continue;
            const prev = byMonth.get(r.month);
            if (!prev || (prev.source !== "broker" && r.source === "broker")) byMonth.set(r.month, r);
          }
          const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
          if (rows.length === 0) {
            throw new Error(
              `No bars for ${symbol} between ${p.fromMonth} and ${p.toMonth}. Import your MT5 history in Data coverage first.`,
            );
          }

          // Coverage gate — a month with big holes biases every statistic that
          // follows, so it blocks the run rather than quietly degrading it.
          if (!p.ignoreCoverageGaps) {
            const bad = rows.filter((r) => (r.missing_minutes ?? 0) > COVERAGE_GAP_LIMIT);
            if (bad.length) {
              const worst = Math.max(...bad.map((r) => r.missing_minutes ?? 0));
              if (id !== lastId.current || !aliveRef.current) return;
              setState((s) => ({
                ...s,
                isRunning: false,
                phase: "idle",
                coverageWarning: { months: bad.map((r) => r.month), missingMinutes: worst },
                error: null,
              }));
              return;
            }
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

          // SMT needs a second, correlated series over the same months.
          const refChunks: ArrayBuffer[] = [];
          const refSymbol = p.referenceSymbol ? normalizeSymbol(p.referenceSymbol.toUpperCase()) : null;
          if (refSymbol) {
            const refRows = await fetchManifest(refSymbol, p.fromMonth, p.toMonth);
            if (refRows.length === 0) {
              throw new Error(
                `No bars for the reference instrument ${refSymbol} between ${p.fromMonth} and ${p.toMonth}. Import its history in Data coverage, or turn the SMT rule off.`,
              );
            }
            for (const row of refRows) {
              if (id !== lastId.current) return;
              refChunks.push(await loadChunk(row.object_path));
            }
          }
          if (id !== lastId.current || !aliveRef.current) return;

          setState((s) => ({ ...s, phase: "computing" }));
          const req: IctBacktestRequest = {
            id,
            symbol,
            chunks,
            fromMs: monthStartMs(p.fromMonth),
            toMs: monthEndMs(p.toMonth),
            cfg: p.cfg,
            mode: p.mode ?? "single",
            walkForward: p.walkForward,
            specOverride: p.specOverride ?? null,
            referenceSymbol: refSymbol,
            referenceChunks: refChunks,
          };
          worker.postMessage(req, [...chunks, ...refChunks]);

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

  /** Re-display a stored run without recomputing it. */
  const loadRun = useCallback((result: IctBacktestResponse) => {
    lastId.current += 1;
    setState({
      result,
      isRunning: false,
      phase: "idle",
      loaded: 0,
      total: 0,
      error: null,
      coverageWarning: null,
      savedRunId: null,
    });
  }, []);

  return { ...state, run, loadRun };
}
