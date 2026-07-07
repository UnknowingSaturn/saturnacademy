// ============================================================================
// useRankerRiskMC — runs the ranker's per-strategy risk sweep in a worker.
//
// Fires post-rank (not blocking the initial table render) whenever the
// strategy R-samples, account balance, comfort setting, or prop-firm caps
// change. Results are keyed by strategyId and stable across re-renders
// thanks to the worker's deterministic seeding.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import type {
  RankerRiskMCRequest,
  RankerRiskMCResponse,
  StrategyRiskInput,
  StrategyRiskResult,
} from "@/workers/rankerRiskMC.worker";

export const RISK_GRID_DEFAULT = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3,
];

export interface UseRankerRiskMCOpts {
  strategies: StrategyRiskInput[];
  accountSize: number;
  comfortDdPct: number;
  /** Clip grid rungs above this cap (from user's sim_hard_cap_pct). */
  hardCapPct?: number;
  propFirm?: RankerRiskMCRequest["propFirm"];
  /** Skip firing (e.g. balance = 0). */
  enabled?: boolean;
}

export interface UseRankerRiskMCState {
  results: Record<string, StrategyRiskResult>;
  loading: boolean;
  error: string | null;
}

let seqCounter = 0;

export function useRankerRiskMC({
  strategies,
  accountSize,
  comfortDdPct,
  hardCapPct,
  propFirm,
  enabled = true,
}: UseRankerRiskMCOpts): UseRankerRiskMCState {
  const [state, setState] = useState<UseRankerRiskMCState>({
    results: {},
    loading: false,
    error: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const currentIdRef = useRef<number>(0);

  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../workers/rankerRiskMC.worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    const worker = workerRef.current;
    const handler = (e: MessageEvent<RankerRiskMCResponse>) => {
      if (e.data.id !== currentIdRef.current) return; // stale
      setState({
        results: e.data.results,
        loading: false,
        error: e.data.error ?? null,
      });
    };
    worker.addEventListener("message", handler);
    return () => {
      worker.removeEventListener("message", handler);
    };
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled || strategies.length === 0 || accountSize <= 0) {
      setState({ results: {}, loading: false, error: null });
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;

    const grid = RISK_GRID_DEFAULT.filter(
      (r) => hardCapPct == null || r <= hardCapPct,
    );
    if (grid.length === 0) {
      setState({ results: {}, loading: false, error: null });
      return;
    }

    seqCounter += 1;
    const id = seqCounter;
    currentIdRef.current = id;
    setState((s) => ({ ...s, loading: true, error: null }));

    const request: RankerRiskMCRequest = {
      strategies,
      grid,
      accountSize,
      comfortDdPct,
      ruinProbCap: 0.05,
      paths: 1500,
      propFirm: propFirm ?? null,
    };
    worker.postMessage({ id, params: request });
    // strategies is a fresh array each render — stringify a stable key so we
    // don't re-fire when it's referentially new but content-identical.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    accountSize,
    comfortDdPct,
    hardCapPct,
    JSON.stringify(propFirm ?? null),
    JSON.stringify(
      strategies.map((s) => [s.strategyId, s.currentRiskPct, s.rSample.length, s.rSample.reduce((a, b) => a + b, 0)]),
    ),
  ]);

  return state;
}
