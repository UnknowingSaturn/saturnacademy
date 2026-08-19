// ============================================================================
// useHoldoutRun — the final, one-shot holdout evaluation.
//
// Rules this hook enforces mechanically, not by convention:
//   • It loads ONLY holdout-era bars (`assertHoldoutOnly`), so a holdout number
//     can never be contaminated by the months the sweep was fitted on.
//   • It runs exactly the configs the discovery study already froze: the top-3
//     FDR survivors carried in the report plus the named (taught) configs.
//   • It runs once. Re-running is possible, but the result is stamped with the
//     time and config set so a second look is visible as a second look.
// ============================================================================

import { useCallback, useRef, useState } from "react";
import { normalizeSymbol } from "../../shared/quant/symbolAliasing";
import type { InstrumentSpec } from "../../shared/quant/ict/instruments";
import {
  SWEEP, assertHoldoutOnly, buildConfigRow,
  type ConfigRow, type SweepCandidate,
} from "../../shared/quant/ict/sweep";
import { loadChunks, monthEndMs, monthStartMs } from "@/lib/backtest/barLoader";
import { SweepPool } from "@/lib/backtest/sweepPool";
import type { SweepReport } from "@/lib/backtest/summaryPack";
import { namedCandidates } from "./useIctSweep";
import type { SweepResponse } from "@/workers/ictSweep.worker";

export interface HoldoutRow extends ConfigRow {
  origin: "top_survivor" | "named";
  /** Discovery-era average R for the same config, when we have it. */
  discoveryAvgR: number | null;
  discoverySharpe: number | null;
}

export interface HoldoutResult {
  createdAt: string;
  symbol: string;
  fromMonth: string;
  toMonth: string;
  rows: HoldoutRow[];
}

export interface HoldoutState {
  phase: "idle" | "loading" | "running" | "done" | "error";
  error: string | null;
  progress: { done: number; total: number; label: string };
  result: HoldoutResult | null;
}

const IDLE: HoldoutState = {
  phase: "idle",
  error: null,
  progress: { done: 0, total: 0, label: "" },
  result: null,
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function useHoldoutRun() {
  const [state, setState] = useState<HoldoutState>(IDLE);
  const poolRef = useRef<SweepPool | null>(null);

  const reset = useCallback(() => setState(IDLE), []);

  const run = useCallback(
    (report: SweepReport, opts?: { toMonth?: string; specOverride?: Partial<InstrumentSpec> | null }) => {
      const symbol = normalizeSymbol(report.discoverySymbol.toUpperCase());
      const fromMonth = SWEEP.holdoutFromMonth;
      const toMonth = opts?.toMonth ?? currentMonth();

      void (async () => {
        const pool = new SweepPool();
        poolRef.current = pool;
        try {
          assertHoldoutOnly(fromMonth);
          if (toMonth < fromMonth) throw new Error(`No holdout months available before ${fromMonth}.`);

          const named = namedCandidates();
          const namedHashes = new Set(named.map((c) => c.hash));
          const candidates: Array<{ cand: SweepCandidate; origin: HoldoutRow["origin"] }> = [
            ...report.topCandidates
              .filter((c) => !namedHashes.has(c.hash))
              .map((cand) => ({ cand, origin: "top_survivor" as const })),
            ...named.map((cand) => ({ cand, origin: "named" as const })),
          ];
          if (!candidates.length) throw new Error("The study carries no frozen configs to hold out.");

          setState({
            ...IDLE,
            phase: "loading",
            progress: { done: 0, total: 1, label: `Loading ${symbol} ${fromMonth}→${toMonth}…` },
          });

          const workers = Math.min(pool.workers, candidates.length);
          const { chunks } = await loadChunks(symbol, fromMonth, toMonth, workers, (loaded, total) =>
            setState((s) => ({ ...s, progress: { done: loaded, total, label: "Loading holdout bars…" } })),
          );
          await pool.init(symbol, chunks, monthStartMs(fromMonth), monthEndMs(toMonth), opts?.specOverride ?? null);

          setState((s) => ({
            ...s,
            phase: "running",
            progress: { done: 0, total: candidates.length, label: "Holdout run…" },
          }));

          // Discovery-era reference for each config, keyed by canonical hash.
          const discovery = new Map(report.rows.map((r): [string, ConfigRow] => [r.hash, r]));
          const spanMs = monthEndMs(toMonth) - monthStartMs(fromMonth);
          const rows: HoldoutRow[] = [];

          for (const { cand, origin } of candidates) {
            const res = (await pool.one({ type: "trades", candidate: cand, cap: 5000 })) as SweepResponse;
            if (res.type !== "tradeLog") continue;
            const row = buildConfigRow(cand, res.trades, res.sessionsScanned, spanMs);
            const prior = discovery.get(cand.hash) ?? null;
            rows.push({
              ...row,
              origin,
              discoveryAvgR: prior ? prior.avgR : null,
              discoverySharpe: prior ? prior.netSharpe : null,
            });
            setState((s) => ({
              ...s,
              progress: { done: rows.length, total: candidates.length, label: "Holdout run…" },
            }));
          }

          setState({
            phase: "done",
            error: null,
            progress: { done: rows.length, total: candidates.length, label: "Holdout complete" },
            result: { createdAt: new Date().toISOString(), symbol, fromMonth, toMonth, rows },
          });
        } catch (err) {
          setState((s) => ({
            ...s,
            phase: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        } finally {
          pool.terminate();
          poolRef.current = null;
        }
      })();
    },
    [],
  );

  return { state, run, reset };
}
