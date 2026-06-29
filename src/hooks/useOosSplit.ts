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
    // S2.9: previous key was only {first,last,n} → swapping a middle trade
    // while length + endpoints stayed identical (account-scope change with
    // overlapping book-ends) served a stale OOS split. Roll a fingerprint
    // over every trade id + entry_time so any in-list mutation invalidates.
    let hash = 2166136261 >>> 0; // FNV-1a 32-bit seed
    for (const t of params.trades) {
      const idStr = String((t as any).id ?? "");
      const tsStr = String((t as any).entry_time ?? "");
      for (let i = 0; i < idStr.length; i++) {
        hash = (hash ^ idStr.charCodeAt(i)) >>> 0;
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      for (let i = 0; i < tsStr.length; i++) {
        hash = (hash ^ tsStr.charCodeAt(i)) >>> 0;
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    return JSON.stringify({
      n: params.trades.length,
      hash: hash.toString(16),
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
        // S1.1 fix: worker error payload posts {trainBaseline:null, ...}; the
        // panel destructures `.n` and white-screens. Surface the error instead.
        if (e.data.error || !e.data.trainBaseline || !e.data.testBaseline) {
          setError(e.data.error ?? "OOS worker returned no baseline");
          setIsComputing(false);
          return;
        }
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
