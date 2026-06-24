// ============================================================================
// useStrategyLabSweep — wraps the MC worker behind a hook with cancellation.
// Returns `cells` (last completed sweep) and `isComputing` while a newer
// request is in flight. Older replies are dropped via monotonic request IDs.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  StrategyLabSweepCell,
  StrategyLabSweepRequest,
} from "@/workers/strategyLabMC.worker";

export interface SweepResult {
  cells: StrategyLabSweepCell[];
  isComputing: boolean;
}

export function useStrategyLabSweep(
  params: StrategyLabSweepRequest | null,
): SweepResult {
  const [cells, setCells] = useState<StrategyLabSweepCell[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const lastId = useRef(0);

  // Stable key for params — re-run only when meaningful inputs change.
  const key = useMemo(() => (params ? JSON.stringify(params) : null), [params]);

  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("@/workers/strategyLabMC.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current.onmessage = (e: MessageEvent<{ id: number; cells: StrategyLabSweepCell[] }>) => {
        if (e.data.id !== lastId.current) return;
        setCells(e.data.cells);
        setIsComputing(false);
      };
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
    workerRef.current.postMessage({ id, params });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { cells, isComputing };
}
