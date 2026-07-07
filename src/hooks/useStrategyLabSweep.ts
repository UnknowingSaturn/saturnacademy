// ============================================================================
// useStrategyLabSweep — wraps the MC worker behind a hook with cancellation.
// Returns `cells` (last completed sweep) and `isComputing` while a newer
// request is in flight. Older replies are dropped via monotonic request IDs.
// R5.1 adds error/onmessageerror handling so a worker crash clears the
// spinner instead of hanging the Strategy Lab.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  StrategyLabSweepCell,
  StrategyLabSweepRequest,
} from "@/workers/strategyLabMC.worker";

export interface SweepResult {
  cells: StrategyLabSweepCell[];
  isComputing: boolean;
  error: string | null;
}

export function useStrategyLabSweep(
  params: StrategyLabSweepRequest | null,
): SweepResult {
  const [cells, setCells] = useState<StrategyLabSweepCell[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastId = useRef(0);

  // S2.8: ~5KB JSON.stringify on every render created 10–30 ms slider jank.
  // Hash only structural fingerprints of `rSample`; pair with scalar params so
  // genuine sweep-config changes still bust the cache.
  const key = useMemo(() => {
    if (!params) return null;
    const { rSample, ...rest } = (params as any) ?? {};
    let sampleKey: string | null = null;
    if (Array.isArray(rSample) && rSample.length > 0) {
      let sum = 0;
      // E4 fix (mirror of E1 in useRankerRiskMC): append Σ(r²) so two samples
      // with identical (n, first, last, Σr) but different mid-values don't
      // collide and skip a legitimate MC re-run.
      let sumSq = 0;
      for (let i = 0; i < rSample.length; i++) {
        const v = rSample[i];
        sum += v;
        sumSq += v * v;
      }
      sampleKey = `${rSample.length}|${rSample[0]}|${rSample[rSample.length - 1]}|${sum.toFixed(6)}|${sumSq.toFixed(6)}`;
    } else if (Array.isArray(rSample)) {
      sampleKey = "0";
    }
    return `${sampleKey ?? "ns"}::${JSON.stringify(rest)}`;
  }, [params]);

  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("@/workers/strategyLabMC.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current.onmessage = (e: MessageEvent<{ id: number; cells: StrategyLabSweepCell[]; error?: string }>) => {
        if (e.data.id !== lastId.current) return;
        // S1.2 fix: worker now posts {cells:[], error} on crash; previously
        // setError(null) swallowed it and the heatmap silently went empty.
        if (e.data.error) {
          setError(e.data.error);
          setCells([]);
          setIsComputing(false);
          return;
        }
        setCells(e.data.cells);
        setError(null);
        setIsComputing(false);
      };
      const onFail = (fallback: string) => (e: Event) => {
        const detail = (e as ErrorEvent).message || fallback;
        // eslint-disable-next-line no-console
        console.error("[useStrategyLabSweep] worker error:", detail);
        setError(detail);
        setIsComputing(false);
      };
      workerRef.current.onerror = onFail("Strategy Lab worker crashed");
      workerRef.current.onmessageerror = onFail("Strategy Lab worker message error");
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!params || !workerRef.current) return;
    lastId.current += 1;
    const id = lastId.current;
    setIsComputing(true);
    setError(null);
    workerRef.current.postMessage({ id, params });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { cells, isComputing, error };
}
