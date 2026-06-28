// ============================================================================
// useOosSplit — runs the OOS dual-buildBuckets in a Web Worker so the slider
// stays responsive. Mirrors useStrategyLabSweep: monotonic request IDs, latest
// reply wins, terminate-on-unmount. R5.1 adds error/onmessageerror handling so
// a worker crash clears the spinner instead of hanging the panel.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OosSplitRequest,
  OosSplitResponse,
} from "@/workers/oosSplit.worker";

export interface OosSplitState {
  result: OosSplitResponse | null;
  isComputing: boolean;
  error: string | null;
}

export function useOosSplit(params: OosSplitRequest | null): OosSplitState {
  const [result, setResult] = useState<OosSplitResponse | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastId = useRef(0);

  const key = useMemo(() => {
    if (!params) return null;
    return JSON.stringify({
      n: params.trades.length,
      first: params.trades[0]?.id ?? null,
      last: params.trades[params.trades.length - 1]?.id ?? null,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      splitIso: params.splitIso,
      resolver: params.resolverMap,
      propFirm: params.propFirm,
      fieldKeys: params.fieldKeys,
      includeUnrealized: params.includeUnrealized,
    });
  }, [params]);

  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("@/workers/oosSplit.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current.onmessage = (e: MessageEvent<OosSplitResponse>) => {
        if (e.data.id !== lastId.current) return;
        setResult(e.data);
        setError(null);
        setIsComputing(false);
      };
      const onFail = (fallback: string) => (e: Event) => {
        const detail = (e as ErrorEvent).message || fallback;
        // eslint-disable-next-line no-console
        console.error("[useOosSplit] worker error:", detail);
        setError(detail);
        setIsComputing(false);
      };
      workerRef.current.onerror = onFail("OOS worker crashed");
      workerRef.current.onmessageerror = onFail("OOS worker message error");
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

  return { result, isComputing, error };
}
