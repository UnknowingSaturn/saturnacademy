// Single source of truth for the per-hour "setup landscape" value.
//
// Storage: this lives on the custom field `cf_ideal_entry_window_*` so users
// can rename / hide it like any other property. The value vocabulary is the
// 9-state encoding below: each of the two halves of the hour is independently
// `none` / `worked` / `failed`, giving 3 × 3 = 9 combinations.
//
// A tag means "the setup printed in that half" — `worked` if it played out,
// `failed` if it printed but failed to follow through. This is decoupled from
// the trade's own W/L: a losing trade can still tag a half as `worked` if the
// setup was valid (you just didn't capitalise). Leave the field blank when no
// qualifying setup printed that hour.

import type { Trade } from "@/types/trading";

export type IdealWindowValue =
  | "none"
  | "first_worked"
  | "second_worked"
  | "both_worked"
  | "first_failed"
  | "second_failed"
  | "both_failed"
  | "first_worked_second_failed"
  | "first_failed_second_worked";

export const IDEAL_WINDOW_VALUES: IdealWindowValue[] = [
  "none",
  "first_worked",
  "second_worked",
  "both_worked",
  "first_failed",
  "second_failed",
  "both_failed",
  "first_worked_second_failed",
  "first_failed_second_worked",
];

// Legacy values still accepted on read for backward compatibility with rows
// written before the 9-state vocabulary. Not offered in the picker UI.
const LEGACY_IDEAL_WINDOW_VALUES = new Set<string>(["mixed"]);

export interface IdealWindowOption {
  value: IdealWindowValue;
  label: string;
  /** Hex color rendered by BadgeSelect via customColor. */
  color: string;
}

// Colors come from semantic design tokens so light/dark themes stay in sync
// with the rest of the heatmap. `--heat-positive` = worked, `--heat-negative`
// = failed, `--chart-trail` = mixed-half outcomes, `--muted-foreground` = none.
export const IDEAL_WINDOW_OPTIONS: IdealWindowOption[] = [
  { value: "none",                       label: "None",              color: "hsl(var(--muted-foreground))" },
  { value: "first_worked",               label: "1st ✓",             color: "hsl(var(--heat-positive))" },
  { value: "second_worked",              label: "2nd ✓",             color: "hsl(var(--heat-positive))" },
  { value: "both_worked",                label: "Both ✓",            color: "hsl(var(--heat-positive))" },
  { value: "first_failed",               label: "1st ✗",             color: "hsl(var(--heat-negative))" },
  { value: "second_failed",              label: "2nd ✗",             color: "hsl(var(--heat-negative))" },
  { value: "both_failed",                label: "Both ✗",            color: "hsl(var(--heat-negative))" },
  { value: "first_worked_second_failed", label: "1st ✓ · 2nd ✗",     color: "hsl(var(--chart-trail))" },
  { value: "first_failed_second_worked", label: "1st ✗ · 2nd ✓",     color: "hsl(var(--chart-trail))" },
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

/** Decode the 9-state value into independent boolean flags for math/UI. */
export function decode(value: IdealWindowValue | string | null | undefined): DecodedIdealWindow {
  switch (value) {
    case "first_worked":               return { ...EMPTY, firstWorked: true };
    case "second_worked":              return { ...EMPTY, secondWorked: true };
    case "both_worked":                return { ...EMPTY, firstWorked: true, secondWorked: true };
    case "first_failed":               return { ...EMPTY, firstFailed: true };
    case "second_failed":              return { ...EMPTY, secondFailed: true };
    case "both_failed":                return { ...EMPTY, firstFailed: true, secondFailed: true };
    case "first_worked_second_failed": return { ...EMPTY, firstWorked: true, secondFailed: true };
    case "first_failed_second_worked": return { ...EMPTY, firstFailed: true, secondWorked: true };
    // Legacy "mixed" was an ambiguous 1✓/1✗ split. Map it to first_worked +
    // second_failed by convention so existing rows still feed the math.
    case "mixed":                      return { ...EMPTY, firstWorked: true, secondFailed: true };
    default:                           return { ...EMPTY };
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
