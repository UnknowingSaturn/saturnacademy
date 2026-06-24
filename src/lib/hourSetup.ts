// Shared options for the per-hour setup-landscape fields on `trades`:
//   • ideal_entry_window — which half(s) had a setup that WORKED
//   • failed_setup_half  — which half(s) had a setup that PRINTED BUT FAILED
//
// Both columns share the same 4-value vocabulary so a single picker shape
// works everywhere; only the palette differs (green for worked, red for
// failed). Single source of truth for the journal table, the detail
// sidebar, the calendar, and the Pair Lab.

export type HourLandscape = 'none' | 'first' | 'second' | 'both';

export interface HourLandscapeOption {
  value: HourLandscape;
  label: string;
  /** Hex color used by `BadgeSelect` via its `customColor` prop. */
  color: string;
}

// "Worked" palette — used by the `ideal_entry_window` field.
export const WORKED_WINDOW_OPTIONS: HourLandscapeOption[] = [
  { value: 'none',   label: 'None',   color: '#64748b' },
  { value: 'first',  label: 'First',  color: '#10b981' },
  { value: 'second', label: 'Second', color: '#059669' },
  { value: 'both',   label: 'Both',   color: '#047857' },
];

// "Failed" palette — used by the `failed_setup_half` field.
export const FAILED_WINDOW_OPTIONS: HourLandscapeOption[] = [
  { value: 'none',   label: 'None',   color: '#64748b' },
  { value: 'first',  label: 'First',  color: '#f87171' },
  { value: 'second', label: 'Second', color: '#ef4444' },
  { value: 'both',   label: 'Both',   color: '#b91c1c' },
];

const toBadge = (opts: HourLandscapeOption[]) =>
  opts.map(o => ({ value: o.value, label: o.label, color: 'primary' as const, customColor: o.color }));

export const WORKED_WINDOW_BADGE_OPTIONS = toBadge(WORKED_WINDOW_OPTIONS);
export const FAILED_WINDOW_BADGE_OPTIONS = toBadge(FAILED_WINDOW_OPTIONS);

/** Convenience predicate: does `landscape` cover the given half? */
export function halfMatches(landscape: HourLandscape | null | undefined, half: 'first' | 'second'): boolean {
  if (!landscape || landscape === 'none') return false;
  if (landscape === 'both') return true;
  return landscape === half;
}
