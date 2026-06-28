import { useCallback, useEffect, useState } from "react";
import { pipLabelForSymbol, pipSizeForSymbol, tickSizeForSymbol } from "@/lib/symbolMapping";

/**
 * Pair-Lab "display unit" preference. Pure presentation — storage and math
 * keep using broker ticks under the hood (see shared/quant/symbolMapping.ts).
 *
 * - `native` (default): pips on FX/metals/crypto/oil, points on indices.
 *   Matches TradingView's measure tool and how traders verbally quote
 *   distances ("NAS100 dropped 200 points").
 * - `ticks`: raw broker units. Useful when the trader wants to paste a
 *   number straight into an MQL5 EA input — MT5's `OrderSend` takes a price
 *   distance derived from `Point()`, which equals one tick.
 */
export type DistanceUnit = "native" | "ticks";

const STORAGE_KEY = "pairLab.distanceUnit";

function readInitial(): DistanceUnit {
  if (typeof window === "undefined") return "native";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "ticks" ? "ticks" : "native";
  } catch {
    return "native";
  }
}

export function useDistanceUnit(): {
  unit: DistanceUnit;
  setUnit: (u: DistanceUnit) => void;
  toggle: () => void;
} {
  const [unit, setUnitState] = useState<DistanceUnit>(readInitial);
  // Cross-tab + cross-component sync via a local event (no React Context
  // needed; the preference is read by ~5 leaf components on the same screen).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setUnitState(readInitial());
    };
    const onLocal = () => setUnitState(readInitial());
    window.addEventListener("storage", onStorage);
    window.addEventListener("pairlab:distance-unit", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pairlab:distance-unit", onLocal);
    };
  }, []);
  const setUnit = useCallback((u: DistanceUnit) => {
    try { window.localStorage.setItem(STORAGE_KEY, u); } catch { /* ignore */ }
    setUnitState(u);
    window.dispatchEvent(new Event("pairlab:distance-unit"));
  }, []);
  const toggle = useCallback(() => {
    setUnit(unit === "native" ? "ticks" : "native");
  }, [unit, setUnit]);
  return { unit, setUnit, toggle };
}

/**
 * Format a distance value (already expressed in pips for FX or points for
 * indices — i.e. the `slUnit` returned by Pair-Lab math) according to the
 * user's display preference.
 *
 * @param symbol  raw broker symbol, or null for an aggregate bucket. When
 *   null we fall back to the explicit `nativeUnit` argument and treat the
 *   tick conversion as a no-op (multi-symbol buckets have no single tick).
 * @param valueNative  number in the symbol's native unit (pips/points). Pass
 *   null/undefined to get an em-dash.
 * @param nativeUnit   "pips" | "points" — the label that would be used in
 *   native mode. Usually sourced from BucketReport.slUnit.
 * @param mode    user preference from useDistanceUnit().
 * @param digits  decimal precision (default 0).
 */
export function formatDistance(
  symbol: string | null | undefined,
  valueNative: number | null | undefined,
  nativeUnit: "pips" | "points",
  mode: DistanceUnit,
  digits = 0,
): string {
  if (valueNative == null || !Number.isFinite(valueNative)) return "—";
  if (mode === "native" || !symbol || symbol === "All") {
    return `${valueNative.toFixed(digits)} ${nativeUnit}`;
  }
  // Native -> ticks. native_per_tick = pipSize / tickSize:
  //   FX 5-digit: 0.0001 / 0.00001 = 10  (so 1 pip = 10 ticks)
  //   Index:      1.0    / 1.0     = 1   (1 point = 1 tick)
  const tick = tickSizeForSymbol(symbol);
  const pip = pipSizeForSymbol(symbol);
  if (!(tick > 0) || !(pip > 0)) return `${valueNative.toFixed(digits)} ${nativeUnit}`;
  const ticks = (valueNative * pip) / tick;
  return `${ticks.toFixed(digits)} t`;
}

/** Convenience: native unit for a symbol (delegates to pipLabelForSymbol). */
export function nativeUnitForSymbol(symbol: string | null | undefined): "pips" | "points" {
  if (!symbol || symbol === "All") return "pips";
  return pipLabelForSymbol(symbol);
}
