// ============================================================================
// useOosSplit — runs the OOS dual-buildBuckets in a Web Worker so the slider
// stays responsive. Mirrors useStrategyLabSweep: monotonic request IDs, latest
// reply wins, terminate-on-unmount.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OosSplitRequest,
  OosSplitResponse,
} from "@/workers/oosSplit.worker";

export interface OosSplitState {
  result: OosSplitResponse | null;
  isComputing: boolean;
}

export function useOosSplit(params: OosSplitRequest | null): OosSplitState {
  const [result, setResult] = useState<OosSplitResponse | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const lastId = useRef(0);

  // Stable key — re-run only when meaningful inputs change. Trades is the
  // costly piece; identity-stable in usePairLab's memo, so JSON.stringify on
  // the rest plus a length+first/last id check is enough.
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
      // J6 fix: toggle was excluded so the OOS panel kept stale results when
      // the user flipped "Include unrealized" in the header.
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

  return { result, isComputing };
}
