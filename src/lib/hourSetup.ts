// Shared options for the per-hour setup landscape fields
// (`first_half_setup` / `second_half_setup` on the `trades` table).
//
// These are retrospective observations: "did a valid setup print in this half
// of the hour, and did it work?". Decoupled from R / execution timing — the
// Pair Lab Timing tab reads them directly to compute per-pair hit rates.
//
// Single source of truth so the journal table, the detail sidebar, and any
// future review surface stay perfectly in sync.

import type { HourSetupOutcome } from "@/types/trading";

export interface HourSetupOption {
  value: HourSetupOutcome;
  label: string;
  /** Hex color rendered by `BadgeSelect` via its `customColor` prop. */
  color: string;
  /** Tailwind class for non-BadgeSelect contexts (calendar badges, etc). */
  toneClass: string;
}

export const HOUR_SETUP_OPTIONS: HourSetupOption[] = [
  { value: "none",   label: "None",   color: "#64748b", toneClass: "text-muted-foreground" },
  { value: "worked", label: "Worked", color: "#10b981", toneClass: "text-profit" },
  { value: "failed", label: "Failed", color: "#ef4444", toneClass: "text-loss" },
];

/** BadgeSelect-shaped options (customColor + primary tone). */
export const HOUR_SETUP_BADGE_OPTIONS = HOUR_SETUP_OPTIONS.map(o => ({
  value: o.value,
  label: o.label,
  color: "primary" as const,
  customColor: o.color,
}));
