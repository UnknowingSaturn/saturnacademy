// Single source of truth for the per-hour "setup landscape" value.
//
// Storage: this lives on the custom field `cf_ideal_entry_window_*` so users
// can rename / hide it like any other property. The value vocabulary is the
// 7-state combined worked-and-failed encoding below.

import type { Trade } from "@/types/trading";

export type IdealWindowValue =
  | "none"
  | "first_worked"
  | "second_worked"
  | "both_worked"
  | "first_failed"
  | "second_failed"
  | "mixed";

export const IDEAL_WINDOW_VALUES: IdealWindowValue[] = [
  "none",
  "first_worked",
  "second_worked",
  "both_worked",
  "first_failed",
  "second_failed",
  "mixed",
];

export interface IdealWindowOption {
  value: IdealWindowValue;
  label: string;
  /** Hex color rendered by BadgeSelect via customColor. */
  color: string;
}

export const IDEAL_WINDOW_OPTIONS: IdealWindowOption[] = [
  { value: "none",          label: "None",        color: "#64748B" },
  { value: "first_worked",  label: "1st half ✓",  color: "#10B981" },
  { value: "second_worked", label: "2nd half ✓",  color: "#059669" },
  { value: "both_worked",   label: "Both ✓",      color: "#047857" },
  { value: "first_failed",  label: "1st half ✗",  color: "#EF4444" },
  { value: "second_failed", label: "2nd half ✗",  color: "#DC2626" },
  { value: "mixed",         label: "Mixed",       color: "#F59E0B" },
];

export const IDEAL_WINDOW_BADGE_OPTIONS = IDEAL_WINDOW_OPTIONS.map(o => ({
  value: o.value,
  label: o.label,
  color: "primary" as const,
  customColor: o.color,
}));

export interface DecodedIdealWindow {
  firstWorked: boolean;
  secondWorked: boolean;
  firstFailed: boolean;
  secondFailed: boolean;
}

const EMPTY: DecodedIdealWindow = {
  firstWorked: false,
  secondWorked: false,
  firstFailed: false,
  secondFailed: false,
};

/** Decode the 7-state value into independent boolean flags for math/UI. */
export function decode(value: IdealWindowValue | string | null | undefined): DecodedIdealWindow {
  switch (value) {
    case "first_worked":  return { ...EMPTY, firstWorked: true };
    case "second_worked": return { ...EMPTY, secondWorked: true };
    case "both_worked":   return { firstWorked: true, secondWorked: true, firstFailed: false, secondFailed: false };
    case "first_failed":  return { ...EMPTY, firstFailed: true };
    case "second_failed": return { ...EMPTY, secondFailed: true };
    // "mixed" = one half worked, the other failed. We don't know which is which
    // without an extra field, so count it as a 1✓/1✗ split: each half gets one
    // tally, but on opposite columns. We split it as 1st-worked + 2nd-failed by
    // convention so co-occurrence math still has a signal.
    case "mixed":         return { firstWorked: true, secondWorked: false, firstFailed: false, secondFailed: true };
    default:              return { ...EMPTY };
  }
}

/** Look up the user's `cf_ideal_entry_window_*` key on a Trade's custom_fields. */
export function readIdealWindow(trade: Trade | { custom_fields?: any } | null | undefined): IdealWindowValue | null {
  const cf = (trade as any)?.custom_fields;
  if (!cf || typeof cf !== "object") return null;
  for (const k of Object.keys(cf)) {
    if (k.startsWith("cf_ideal_entry_window")) {
      const v = cf[k];
      if (typeof v === "string" && (IDEAL_WINDOW_VALUES as string[]).includes(v)) {
        return v as IdealWindowValue;
      }
    }
  }
  return null;
}

/** True if the value has any "worked" signal in either half. */
export function hasWorked(value: IdealWindowValue | null | undefined): boolean {
  const d = decode(value ?? null);
  return d.firstWorked || d.secondWorked;
}

/** True if the value has any "failed" signal in either half. */
export function hasFailed(value: IdealWindowValue | null | undefined): boolean {
  const d = decode(value ?? null);
  return d.firstFailed || d.secondFailed;
}
