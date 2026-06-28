// ============================================================================
// Out-of-sample worker.
//
// Runs the dual buildBuckets(train|test) pair off the main thread so the OOS
// split slider stays responsive. Parent posts a serializable request and the
// worker replies with `{ id, baseline, deltas }`. Latest `id` wins.
//
// `symbolResolver` cannot be serialized, so the parent pre-computes a raw →
// canonical map from the in-scope trades and the worker reconstructs the
// resolver as `(s) => map[s] ?? s`.
// ============================================================================

import {
  buildBuckets,
  type BucketReport,
  type PairLabFieldKeys,
  type PropFirmContext,
} from "@/lib/pairLabMath";
import type { Trade } from "@/types/trading";

export interface OosSplitRequest {
  trades: Trade[];
  fieldKeys: PairLabFieldKeys;
  resolverMap: Record<string, string>;
  propFirm: PropFirmContext | null;
  dateFrom: string | null;
  dateTo: string;
  splitIso: string;
  // F4 fix: parent must pass the toggle through so train/test agree with the
  // main grid. Default false matches buildBuckets' default.
  includeUnrealized: boolean;
  // Q3 fix: forward the recent-N drift window so OOS bucket build matches
  // the main grid's drift signal instead of silently defaulting to 10.
  recentN?: number;
}

export interface OosSplitDelta {
  symbol: string;
  session: string;
  train: BucketReport;
  test: BucketReport;
  overfit: boolean;
}

export interface OosSplitResponse {
  id: number;
  trainBaseline: BucketReport;
  testBaseline: BucketReport;
  deltas: OosSplitDelta[];
  error?: string;
}

// Q2: overfit requires CI non-overlap (train CI lower-bound > test CI upper-bound)
// OR a > 0.25R absolute swing crossing zero. Stops single-noise crossings
// being flagged when the bootstrap CIs overlap heavily.
function isOverfit(tr: BucketReport, te: BucketReport): boolean {
  if (!Number.isFinite(tr.expectedR) || !Number.isFinite(te.expectedR)) return false;
  if (!(tr.expectedR > 0 && te.expectedR <= 0)) return false;
  const delta = tr.expectedR - te.expectedR;
  if (delta < 0.25) return false;
  if (tr.expectedRCi && te.expectedRCi) {
    // CIs overlap → ambiguous, skip the flag.
    if (tr.expectedRCi[0] <= te.expectedRCi[1]) return false;
  }
  return true;
}

self.onmessage = (e: MessageEvent<{ id: number; params: OosSplitRequest }>) => {
  const { id, params } = e.data;
  try {
    const resolver = (s: string) => params.resolverMap[s] ?? s;

    // J5 fix: buildBuckets' dateFrom/dateTo are both INCLUSIVE. A trade at
    // exactly `splitIso` would land in both train and test halves, leaking IS
    // signal into OOS. Shift the test window's lower bound by +1 ms so the
    // boundary trade is counted once (in train).
    const testFromIso = new Date(Date.parse(params.splitIso) + 1).toISOString();

    const trainRes = buildBuckets(params.trades, params.fieldKeys, {
      symbolResolver: resolver,
      propFirm: params.propFirm,
      closedOnly: true,
      dateFrom: params.dateFrom,
      dateTo: params.splitIso,
      includeUnrealized: params.includeUnrealized,
      recentN: params.recentN,
    });
    const testRes = buildBuckets(params.trades, params.fieldKeys, {
      symbolResolver: resolver,
      propFirm: params.propFirm,
      closedOnly: true,
      dateFrom: testFromIso,
      dateTo: params.dateTo,
      includeUnrealized: params.includeUnrealized,
      recentN: params.recentN,
    });

    const cellKey = (b: BucketReport) => `${b.key.symbol}__${b.key.session}`;
    const testMap = new Map(testRes.perCell.map((b) => [cellKey(b), b]));
    const deltas: OosSplitDelta[] = [];
    for (const tr of trainRes.perCell) {
      const te = testMap.get(cellKey(tr));
      // O3 fix: require ≥10 trades per side before reporting a delta — 5 was
      // below the bootstrap-CI usability threshold (DATA_TIER_INSUFFICIENT_N).
      if (!te || tr.n < 10 || te.n < 10) continue;
      deltas.push({
        symbol: tr.key.symbol,
        session: tr.key.session,
        train: tr,
        test: te,
        overfit: isOverfit(tr, te),
      });
    }
    deltas.sort(
      (a, b) => (b.overfit ? 1 : 0) - (a.overfit ? 1 : 0) || b.train.n - a.train.n,
    );

    const resp: OosSplitResponse = {
      id,
      trainBaseline: trainRes.baseline,
      testBaseline: testRes.baseline,
      deltas,
    };
    (self as unknown as Worker).postMessage(resp);
  } catch (err) {
    // Q11 parity: never leave the parent stuck in a loading state.
    (self as unknown as Worker).postMessage({
      id,
      trainBaseline: null,
      testBaseline: null,
      deltas: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
