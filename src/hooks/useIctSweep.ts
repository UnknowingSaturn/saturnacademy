// ============================================================================
// useIctSweep — Layer 5 orchestration.
//
//   benchmark (50 configs, full pipeline)
//     → sizing rule + STOP for the user's go-ahead
//     → sampled sweep on the discovery symbol (pooled, checkpointed)
//     → FDR over the sampled population, survivors
//     → reference nulls, ablation ladder, discretion premium, statistics
//     → raw validation of survivors + named configs on the second symbol
//     → summary pack (saved + downloadable)
//
// Nothing here re-selects on validation results and nothing loads the holdout.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSymbol } from "../../shared/quant/symbolAliasing";
import type { BacktestTrade, EngineConfig } from "../../shared/quant/ict/engine";
import type { InstrumentSpec } from "../../shared/quant/ict/instruments";
import { instrumentSpec, withSpecOverrides } from "../../shared/quant/ict/instruments";
import { engineConfigFor, namedConfig, windowsForKeys } from "../../shared/quant/ict/configs";
import {
  SWEEP, assertNoHoldout, benjaminiHochberg, buildConfigRow, deflatedSharpeRatio,
  discretionPremium, eraSplit, isRollDay, makeCandidate, perYear, pValueMeanPositive,
  sampleConfigs, sizeSweep, slippageSensitivity,
  type ConfigRow, type SizingDecision, type SweepCandidate,
} from "../../shared/quant/ict/sweep";
import { describeNull } from "../../shared/quant/ict/nulls";
import { loadChunks, monthEndMs, monthStartMs } from "@/lib/backtest/barLoader";
import { SweepPool, defaultWorkerCount } from "@/lib/backtest/sweepPool";
import { clearShards, loadShards, runKeyFor, saveShard } from "@/lib/backtest/shardStore";
import {
  buildSummaryPack, zipFiles,
  type AblationRow, type NullReport, type PackFile, type RefConfigResult, type SweepReport,
} from "@/lib/backtest/summaryPack";
import type { SweepResponse } from "@/workers/ictSweep.worker";

const BENCHMARK_N = 50;
const BATCH_SIZE = 25;
const NULL_ITERATIONS = 1000;
const FDR_Q = 0.1;

export interface SweepParams {
  discoverySymbol: string;
  validationSymbol: string | null;
  fromMonth: string;
  toMonth: string;
  seed: number;
  specOverride?: Partial<InstrumentSpec> | null;
}

export type SweepPhase =
  | "idle" | "loading" | "benchmarking" | "awaiting_go"
  | "sweeping" | "analysing" | "validating" | "done" | "error";

export interface SweepProgress { done: number; total: number; label: string }

export interface SweepState {
  phase: SweepPhase;
  error: string | null;
  progress: SweepProgress;
  sizing: SizingDecision | null;
  gridSize: number;
  resumed: number;
  report: SweepReport | null;
  files: PackFile[];
  savedRunId: string | null;
}

const INITIAL: SweepState = {
  phase: "idle",
  error: null,
  progress: { done: 0, total: 0, label: "" },
  sizing: null,
  gridSize: 0,
  resumed: 0,
  report: null,
  files: [],
  savedRunId: null,
};

// ---------------------------------------------------------------------------
// Ablation ladder — as_taught_5m parameters throughout.
// ---------------------------------------------------------------------------

function ablationLadder(): Array<{ label: string; patch: Partial<EngineConfig>; windowKeys: string[]; lookahead: boolean }> {
  const taught = namedConfig("as_taught_5m");
  const base = { ...(taught?.patch ?? {}) } as Partial<EngineConfig>;
  const fullSession = ["rth"];
  const rungs: Array<{ label: string; patch: Partial<EngineConfig>; windowKeys: string[]; lookahead: boolean }> = [];

  const fvgOnly: Partial<EngineConfig> = {
    ...base,
    requireSweep: false, requireMss: false, requireDisplacement: false,
    biasMode: "none", stopMode: "gap",
  };
  rungs.push({ label: "1. FVG entry only (full session)", patch: fvgOnly, windowKeys: fullSession, lookahead: false });

  const plusSweep: Partial<EngineConfig> = { ...fvgOnly, requireSweep: true, sweepUniverse: "bsl_ssl_15m" };
  rungs.push({ label: "2. + sweep required (bsl_ssl_15m)", patch: plusSweep, windowKeys: fullSession, lookahead: false });

  const plusDisp: Partial<EngineConfig> = {
    ...plusSweep, requireDisplacement: true,
    displacementMode: base.displacementMode ?? "atr",
    displacementAtrMultiple: base.displacementAtrMultiple ?? 1.5,
    stopMode: base.stopMode ?? "displacement_swing",
  };
  rungs.push({ label: "3. + displacement required", patch: plusDisp, windowKeys: fullSession, lookahead: false });

  rungs.push({
    label: "4. + window restriction (Silver Bullet hours)",
    patch: plusDisp,
    windowKeys: ["london", "ny_am", "ny_pm"],
    lookahead: false,
  });

  rungs.push({
    label: "5. + 15m bias (full as_taught_5m)",
    patch: { ...plusDisp, biasMode: "structure_15m", biasSwingTimeframe: 15 },
    windowKeys: ["london", "ny_am", "ny_pm"],
    lookahead: false,
  });

  rungs.push({
    label: "6. + perfect bias instead (LOOKAHEAD)",
    patch: { ...plusDisp, biasMode: "perfect" },
    windowKeys: ["london", "ny_am", "ny_pm"],
    lookahead: true,
  });

  return rungs;
}

function namedCandidates(): SweepCandidate[] {
  const out: SweepCandidate[] = [];
  for (const key of SWEEP.namedKeys) {
    const nc = namedConfig(key);
    const patch = engineConfigFor(key);
    if (!nc || !patch) continue;
    out.push(makeCandidate(patch, nc.windowKeys, key));
  }
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function avgR(trades: BacktestTrade[]): number {
  return trades.length ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length : 0;
}

function perTradeSharpe(trades: BacktestTrade[]): number {
  if (trades.length < 2) return 0;
  const rs = trades.map((t) => t.rMultiple);
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  const v = rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1);
  return v > 0 ? m / Math.sqrt(v) : 0;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIctSweep() {
  const [state, setState] = useState<SweepState>(INITIAL);
  const poolRef = useRef<SweepPool | null>(null);
  const paramsRef = useRef<SweepParams | null>(null);
  const benchRef = useRef<{ sizing: SizingDecision; startedAt: number } | null>(null);
  const aliveRef = useRef(true);
  const cancelRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      poolRef.current?.terminate();
      poolRef.current = null;
    };
  }, []);

  const patch = useCallback((p: Partial<SweepState>) => {
    if (aliveRef.current) setState((s) => ({ ...s, ...p }));
  }, []);

  const fail = useCallback(
    (err: unknown) => {
      patch({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    },
    [patch],
  );

  /** Stage 1 — load bars into a fresh pool and time 50 configs end to end. */
  const benchmark = useCallback(
    (p: SweepParams) => {
      cancelRef.current = false;
      paramsRef.current = p;
      const symbol = normalizeSymbol(p.discoverySymbol.toUpperCase());
      setState({ ...INITIAL, phase: "loading", progress: { done: 0, total: 0, label: "Loading bar data…" } });

      void (async () => {
        try {
          assertNoHoldout(p.toMonth);
          const workers = defaultWorkerCount();
          const { chunks } = await loadChunks(symbol, p.fromMonth, p.toMonth, workers, (done, total) =>
            patch({ progress: { done, total, label: `Loading bar data — ${done}/${total} months` } }),
          );

          const pool = new SweepPool(workers);
          poolRef.current?.terminate();
          poolRef.current = pool;
          await pool.init(symbol, chunks, monthStartMs(p.fromMonth), monthEndMs(p.toMonth), p.specOverride);
          if (cancelRef.current) return;

          patch({ phase: "benchmarking", progress: { done: 0, total: BENCHMARK_N, label: "Benchmarking 50 configs…" } });
          const sample = sampleConfigs(BENCHMARK_N, p.seed ^ 0x5eed);
          const started = performance.now();
          let done = 0;
          const perConfig: number[] = [];
          await pool.runBatches(sample.candidates, 5, (rows) => {
            done += rows.length;
            patch({ progress: { done, total: BENCHMARK_N, label: "Benchmarking 50 configs…" } });
          });
          const elapsed = (performance.now() - started) / 1000;
          // Wall clock across the pool → per-config cost on ONE worker.
          const medianSec = perConfig.length
            ? median(perConfig)
            : (elapsed * pool.workers) / Math.max(1, sample.candidates.length);

          const sizing = sizeSweep(medianSec, pool.workers);
          benchRef.current = { sizing, startedAt: performance.now() };
          patch({
            phase: "awaiting_go",
            sizing,
            gridSize: sample.gridSize,
            progress: { done: BENCHMARK_N, total: BENCHMARK_N, label: "Benchmark complete" },
          });
        } catch (err) {
          fail(err);
        }
      })();
    },
    [patch, fail],
  );

  /** Stage 2+ — the actual sweep and everything downstream. */
  const launch = useCallback(() => {
    const p = paramsRef.current;
    const bench = benchRef.current;
    const pool = poolRef.current;
    if (!p || !bench || !pool) return;
    cancelRef.current = false;
    const t0 = performance.now();
    const discovery = normalizeSymbol(p.discoverySymbol.toUpperCase());
    const validation = p.validationSymbol ? normalizeSymbol(p.validationSymbol.toUpperCase()) : null;

    void (async () => {
      try {
        const n = bench.sizing.n;
        const sample = sampleConfigs(n, p.seed);
        const named = namedCandidates();
        const namedHashes = new Set(named.map((c) => c.hash));
        const population = [...sample.candidates.filter((c) => !namedHashes.has(c.hash)), ...named];

        const runKey = runKeyFor({
          symbol: discovery, fromMonth: p.fromMonth, toMonth: p.toMonth,
          seed: p.seed, n, gridSize: sample.gridSize,
        });
        const stored: ConfigRow[] = await loadShards(runKey).catch(() => [] as ConfigRow[]);
        const storedByHash = new Map(stored.map((r): [string, ConfigRow] => [r.hash, r]));
        const todo = population.filter((c) => !storedByHash.has(c.hash));

        patch({
          phase: "sweeping",
          resumed: stored.length,
          gridSize: sample.gridSize,
          progress: { done: stored.length, total: population.length, label: "Sweeping…" },
        });

        const rows: ConfigRow[] = [...stored];
        const sweepStart = performance.now();
        await pool.runBatches(todo, BATCH_SIZE, async (batchRows) => {
          rows.push(...batchRows);
          await saveShard(runKey, batchRows).catch(() => undefined);
          patch({
            progress: { done: rows.length, total: population.length, label: "Sweeping…" },
          });
        });
        const sweepSeconds = (performance.now() - sweepStart) / 1000;
        if (cancelRef.current) {
          patch({ phase: "idle", progress: { done: 0, total: 0, label: "Cancelled" } });
          return;
        }

        // ---- FDR over the sampled population ------------------------------
        patch({ phase: "analysing", progress: { done: 0, total: 6, label: "Statistics…" } });

        const byHash = new Map(rows.map((r) => [r.hash, r]));
        const candByHash = new Map(population.map((c) => [c.hash, c]));

        // p-value needs the R series; recompute from row-level stats using the
        // t-approximation is not possible, so we re-run the top slice only.
        // Ranking is by net Sharpe, which the rows already carry.
        const ranked = [...rows].sort((a, b) => b.netSharpe - a.netSharpe);
        const testable = ranked.filter((r) => r.trades >= 30);
        const topSlice = testable.slice(0, Math.min(200, testable.length));

        const tradeLogs = new Map<string, BacktestTrade[]>();
        const sessionsByHash = new Map<string, number>();
        let step = 0;
        for (const r of topSlice) {
          const cand = candByHash.get(r.hash);
          if (!cand) continue;
          const res = (await pool.one({ type: "trades", candidate: cand, cap: 5000 })) as SweepResponse;
          if (res.type === "tradeLog") {
            tradeLogs.set(r.hash, res.trades);
            sessionsByHash.set(r.hash, res.sessionsScanned);
          }
          if (++step % 20 === 0) {
            patch({ progress: { done: step, total: topSlice.length, label: "Collecting trade logs…" } });
          }
        }

        const pvalues = topSlice
          .filter((r) => tradeLogs.has(r.hash))
          .map((r) => ({ hash: r.hash, p: pValueMeanPositive(tradeLogs.get(r.hash)!.map((t) => t.rMultiple)) }));
        const fdr = benjaminiHochberg(pvalues, FDR_Q);
        const survivorSet = new Set(fdr.survivors);
        const survivors = ranked.filter((r) => survivorSet.has(r.hash));

        // ---- reference configs --------------------------------------------
        const bestRealistic = survivors.find((r) => !r.namedKey) ?? survivors[0] ?? testable[0] ?? rows[0];
        const medianSharpe = testable.length
          ? testable[Math.floor(testable.length / 2)]
          : rows[Math.floor(rows.length / 2)];

        const refDefs: Array<{ key: string; label: string; row: ConfigRow | undefined }> = [
          { key: "as_taught_5m", label: "As taught (5m)", row: rows.find((r) => r.namedKey === "as_taught_5m") },
          { key: "silver_bullet", label: "Silver Bullet", row: rows.find((r) => r.namedKey === "silver_bullet") },
          { key: "best_survivor", label: "Best realistic survivor", row: bestRealistic },
          { key: "median_sharpe", label: "Median-Sharpe config", row: medianSharpe },
        ];

        const refs: RefConfigResult[] = [];
        for (const def of refDefs) {
          if (!def.row) continue;
          const cand = candByHash.get(def.row.hash);
          if (!cand) continue;
          let trades = tradeLogs.get(def.row.hash);
          if (!trades) {
            const res = (await pool.one({ type: "trades", candidate: cand, cap: 5000 })) as SweepResponse;
            trades = res.type === "tradeLog" ? res.trades : [];
            tradeLogs.set(def.row.hash, trades);
          }
          refs.push({ key: def.key, label: def.label, hash: def.row.hash, symbol: discovery, row: def.row, trades });
        }

        // ---- nulls ---------------------------------------------------------
        patch({ progress: { done: 0, total: refs.length, label: "Reference nulls…" } });
        const nulls: NullReport[] = [];
        let ni = 0;
        for (const ref of refs) {
          const cand = candByHash.get(ref.hash);
          if (!cand) continue;
          const nres = (await pool.one({ type: "nulls", candidate: cand, iterations: NULL_ITERATIONS })) as SweepResponse;
          const hres = (await pool.one({ type: "hours", candidate: cand })) as SweepResponse;
          if (nres.type !== "nullResult" || hres.type !== "hoursResult") continue;
          const real = nres.realAvgR;
          nulls.push({
            configKey: ref.key,
            label: ref.label,
            symbol: discovery,
            randomEntry: describeNull("Random entry, same windows", nres.randomEntry, real),
            shuffledDirection: describeNull("Shuffled direction", nres.shuffledDirection, real),
            otherHours: describeNull("Other hours, same logic", hres.hours.filter((h) => h.trades >= 5).map((h) => h.avgR), real),
            hours: hres.hours,
          });
          patch({ progress: { done: ++ni, total: refs.length, label: "Reference nulls…" } });
        }

        // ---- ablation ladder -----------------------------------------------
        patch({ progress: { done: 0, total: 6, label: "Ablation ladder…" } });
        const ablation: AblationRow[] = [];
        const ladder = ablationLadder();
        for (let i = 0; i < ladder.length; i++) {
          const rung = ladder[i];
          const cand = makeCandidate(rung.patch, rung.windowKeys);
          const res = (await pool.one({ type: "trades", candidate: cand, cap: 5000 })) as SweepResponse;
          if (res.type !== "tradeLog") continue;
          const row = buildConfigRow(cand, res.trades, res.sessionsScanned, monthEndMs(p.toMonth) - monthStartMs(p.fromMonth));
          ablation.push({
            rung: i + 1, label: rung.label, symbol: discovery, trades: row.trades,
            winRate: row.winRate, avgR: row.avgR, netSharpe: row.netSharpe,
            maxDrawdownR: row.maxDrawdownR, lookahead: rung.lookahead,
          });
          patch({ progress: { done: i + 1, total: ladder.length, label: "Ablation ladder…" } });
        }

        // ---- discretion, slices, statistics ---------------------------------
        const spec = withSpecOverrides(instrumentSpec(discovery), p.specOverride);
        const discretion = refs
          .filter((r) => r.key !== "median_sharpe")
          .map((r) => ({ key: r.key, label: r.label, symbol: discovery, premium: discretionPremium(r.trades) }));

        const dsrRef = refs.find((r) => r.key === "best_survivor") ?? refs[0];
        const sharpeVar = variance(rows.filter((r) => r.trades >= 30).map((r) => r.netSharpe));
        const dsr = dsrRef
          ? {
              ...deflatedSharpeRatio(
                perTradeSharpe(dsrRef.trades),
                dsrRef.trades.map((t) => t.rMultiple),
                sharpeVar,
                sample.canonicalCount || population.length,
              ),
              configKey: dsrRef.label,
            }
          : null;

        const perYearOut = refs.map((r) => ({ key: r.label, symbol: discovery, rows: perYear(r.trades) }));
        const eraOut = refs.map((r) => ({ key: r.label, symbol: discovery, rows: eraSplit(r.trades) }));
        const rollDay = refs.map((r) => {
          const without = r.trades.filter((t) => !isRollDay(t.sessionDate));
          return {
            key: r.label, symbol: discovery,
            withRoll: avgR(r.trades), withoutRoll: avgR(without),
            rollTrades: r.trades.length - without.length,
          };
        });
        const slippage = refs.map((r) => ({
          key: r.label, symbol: discovery, cells: slippageSensitivity(r.trades, spec.tickValue),
        }));

        // ---- validation symbol ----------------------------------------------
        let validationRows: ConfigRow[] = [];
        if (validation) {
          patch({ phase: "validating", progress: { done: 0, total: 1, label: `Validating on ${validation}…` } });
          const workers = defaultWorkerCount();
          const { chunks } = await loadChunks(validation, p.fromMonth, p.toMonth, workers, (done, total) =>
            patch({ progress: { done, total, label: `Loading ${validation} — ${done}/${total} months` } }),
          );
          const vPool = new SweepPool(workers);
          await vPool.init(validation, chunks, monthStartMs(p.fromMonth), monthEndMs(p.toMonth), null);
          try {
            const toValidate = [
              ...survivors.slice(0, 100).map((r) => candByHash.get(r.hash)).filter(Boolean) as SweepCandidate[],
              ...named,
            ];
            const vRows: ConfigRow[] = [];
            await vPool.runBatches(toValidate, BATCH_SIZE, (batch) => {
              vRows.push(...batch);
              patch({ progress: { done: vRows.length, total: toValidate.length, label: `Validating on ${validation}…` } });
            });
            validationRows = vRows;

            // Ablation + nulls repeat raw on the validation symbol.
            for (let i = 0; i < ladder.length; i++) {
              const rung = ladder[i];
              const cand = makeCandidate(rung.patch, rung.windowKeys);
              const res = (await vPool.one({ type: "trades", candidate: cand, cap: 5000 })) as SweepResponse;
              if (res.type !== "tradeLog") continue;
              const row = buildConfigRow(cand, res.trades, res.sessionsScanned, monthEndMs(p.toMonth) - monthStartMs(p.fromMonth));
              ablation.push({
                rung: i + 1, label: rung.label, symbol: validation, trades: row.trades,
                winRate: row.winRate, avgR: row.avgR, netSharpe: row.netSharpe,
                maxDrawdownR: row.maxDrawdownR, lookahead: rung.lookahead,
              });
            }
            for (const key of ["as_taught_5m", "silver_bullet"]) {
              const cand = named.find((c) => c.namedKey === key);
              if (!cand) continue;
              const nres = (await vPool.one({ type: "nulls", candidate: cand, iterations: NULL_ITERATIONS })) as SweepResponse;
              const hres = (await vPool.one({ type: "hours", candidate: cand })) as SweepResponse;
              if (nres.type !== "nullResult" || hres.type !== "hoursResult") continue;
              nulls.push({
                configKey: key,
                label: namedConfig(key)?.label ?? key,
                symbol: validation,
                randomEntry: describeNull("Random entry, same windows", nres.randomEntry, nres.realAvgR),
                shuffledDirection: null,
                otherHours: describeNull("Other hours, same logic", hres.hours.filter((h) => h.trades >= 5).map((h) => h.avgR), nres.realAvgR),
                hours: hres.hours,
              });
            }
          } finally {
            vPool.terminate();
          }
        }

        // ---- report + pack ----------------------------------------------------
        const report: SweepReport = {
          createdAt: new Date().toISOString(),
          discoverySymbol: discovery,
          validationSymbol: validation,
          fromMonth: p.fromMonth,
          toMonth: p.toMonth,
          sizing: bench.sizing,
          sample: {
            gridSize: sample.gridSize,
            rawCount: sample.rawCount,
            canonicalCount: sample.canonicalCount,
            n: population.length,
            exhaustive: sample.exhaustive,
          },
          rows,
          fdr,
          survivors,
          validationRows,
          refs,
          nulls,
          ablation,
          discretion,
          dsr,
          perYear: perYearOut,
          era: eraOut,
          rollDay,
          slippage,
          funnel: {
            configs_run: rows.length,
            resumed_from_checkpoint: stored.length,
            with_min_30_trades: testable.length,
            p_value_tested: pvalues.length,
            fdr_survivors: survivors.length,
            validated_on_second_symbol: validationRows.length,
          },
          timing: {
            benchmarkMedianSec: bench.sizing.medianSecPerConfig,
            workers: bench.sizing.workers,
            sweepSeconds,
            totalSeconds: (performance.now() - t0) / 1000,
          },
        };

        const files = buildSummaryPack(report);
        patch({ phase: "done", report, files, progress: { done: rows.length, total: rows.length, label: "Complete" } });
        void persistSweep(report, files).then((id) => patch({ savedRunId: id })).catch(() => undefined);
        void clearShards(runKey).catch(() => undefined);
      } catch (err) {
        fail(err);
      }
    })();
  }, [patch, fail]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    poolRef.current?.stop();
    patch({ phase: "idle", progress: { done: 0, total: 0, label: "Cancelled" } });
  }, [patch]);

  const reset = useCallback(() => {
    cancelRef.current = true;
    poolRef.current?.terminate();
    poolRef.current = null;
    setState(INITIAL);
  }, []);

  const downloadPack = useCallback(() => {
    if (!state.files.length) return;
    const blob = zipFiles(state.files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sweep_${state.report?.discoverySymbol ?? "run"}_${state.report?.fromMonth ?? ""}_${state.report?.toMonth ?? ""}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.files, state.report]);

  return { ...state, benchmark, launch, cancel, reset, downloadPack };
}

// ---------------------------------------------------------------------------
// Persistence — the run row plus the pack, so a sweep can be reopened later.
// ---------------------------------------------------------------------------

async function persistSweep(report: SweepReport, files: PackFile[]): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;

  const { data: run, error } = await supabase
    .from("backtest_runs")
    .insert({
      user_id: userId,
      label: `Sweep ${report.discoverySymbol} ${report.fromMonth}→${report.toMonth}`,
      config: {
        kind: "sweep",
        sample: report.sample,
        sizing: report.sizing,
        validationSymbol: report.validationSymbol,
      } as never,
      config_hash: `sweep:${report.discoverySymbol}:${report.fromMonth}:${report.toMonth}:${report.sample.n}`,
      symbols: [report.discoverySymbol, ...(report.validationSymbol ? [report.validationSymbol] : [])],
      date_from: `${report.fromMonth}-01`,
      date_to: `${report.toMonth}-01`,
      include_holdout: false,
      status: "complete",
      metrics: {
        funnel: report.funnel,
        fdr: { q: report.fdr.q, tested: report.fdr.tested, survivors: report.fdr.survivors.length },
        dsr: report.dsr,
        timing: report.timing,
        nulls: report.nulls.map((n) => ({
          config: n.configKey, symbol: n.symbol,
          randomEntryPercentile: n.randomEntry.realPercentile,
          otherHoursPercentile: n.otherHours.realPercentile,
          shuffledPercentile: n.shuffledDirection?.realPercentile ?? null,
        })),
        ablation: report.ablation,
      } as never,
      no_trade_log: [] as never,
      trade_count: report.refs.reduce((a, r) => a + r.trades.length, 0),
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(error?.message ?? "Could not save sweep");

  // Pack files live next to the bars, under the user's own prefix.
  for (const f of files) {
    await supabase.storage
      .from("bars")
      .upload(`${userId}/sweeps/${run.id}/${f.name}`, new Blob([f.content], { type: f.mime }), {
        upsert: true,
        contentType: f.mime,
      });
  }
  return run.id;
}
