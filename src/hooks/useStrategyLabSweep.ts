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
