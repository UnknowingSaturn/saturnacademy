// ============================================================================
// PairLabWalkForwardContext — single source of truth for walk-forward + scope
// state across all Pair Lab analysis tabs (Ideal Windows, Analyze grid,
// Strategy Lab, Out-of-Sample, Strategy Ranker).
//
// Owning the lens / as-of / profile / scope / includeUnrealized centrally
// means every panel reads from the same window — when the user slides the
// as-of date in one tab, every other tab re-derives on the same cutoff.
// ============================================================================

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { resolveWindow, type WalkForwardState } from "@/components/pair-lab/WalkForwardControls";
import type { SymbolGroup } from "@/hooks/useSymbolGroups";

export interface PairLabWalkForwardValue {
  wf: WalkForwardState;
  setWf: (next: WalkForwardState) => void;
  /** Bounds for the as-of slider (epoch ms). */
  minMs: number;
  maxMs: number;
  /** Resolved ISO window from wf. */
  dateFrom: string | null;
  dateTo: string;
  /** Active profile filter — null means "any". */
  profile: string | null;
  /** Scope key: "all" | "grp:<id>" | "sym:<SYMBOL>". */
  scope: string;
  includeUnrealized: boolean;
  propFirmMode: boolean;
  /** S3.5: threaded through context so child panels don't re-subscribe. */
  groups: SymbolGroup[];
}

const Ctx = createContext<PairLabWalkForwardValue | null>(null);

export function PairLabWalkForwardProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: Omit<PairLabWalkForwardValue, "dateFrom" | "dateTo">;
}) {
  const resolved = useMemo(() => resolveWindow(value.wf), [value.wf]);
  // M1 fix: depend on the individual stable primitives instead of the parent's
  // (always-new) `value` object literal. Without this every PairLab render
  // produced a new context identity, forcing all six consumers to re-render.
  const merged = useMemo<PairLabWalkForwardValue>(
    () => ({ ...value, dateFrom: resolved.dateFrom, dateTo: resolved.dateTo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      value.wf,
      value.setWf,
      value.minMs,
      value.maxMs,
      value.profile,
      value.scope,
      value.includeUnrealized,
      value.propFirmMode,
      value.groups,
      resolved.dateFrom,
      resolved.dateTo,
    ],
  );
  return <Ctx.Provider value={merged}>{children}</Ctx.Provider>;
}

export function usePairLabWalkForward(): PairLabWalkForwardValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePairLabWalkForward must be used within PairLabWalkForwardProvider");
  return v;
}

/** Non-throwing variant for components that may render outside the provider. */
export function useOptionalPairLabWalkForward(): PairLabWalkForwardValue | null {
  return useContext(Ctx);
}
