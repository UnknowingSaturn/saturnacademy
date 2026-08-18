// GENERATED FILE — DO NOT EDIT.
// Vendored copy of shared/quant/sessions.ts for the Deno edge bundler.
// Edit the canonical file at shared/quant/ and run `npm run quant:sync`.
// ============================================================================
// Session + killzone labeling for the backtest engine.
//
// CONTRACT:
//   - Every timestamp handled here is epoch-ms UTC. Nothing is stored or
//     compared in local time.
//   - New York wall-clock is derived through `Intl.DateTimeFormat` with the
//     `America/New_York` zone, so DST (spring forward / fall back) is handled
//     by the runtime's tz database. NO hardcoded UTC offsets anywhere.
//   - Session windows are defined in ET minutes-from-midnight, matching how
//     the journal's `session_definitions` rows are authored.
//
// Instrument classes differ in what a "session date" means:
//   fx / metals  → the week runs Sun 17:00 ET → Fri 17:00 ET; a bar at or
//                  after 17:00 ET belongs to the NEXT session date.
//   index CFD    → cash-hours instrument; the session date is simply the ET
//                  calendar date (no rollover), and RTH is 09:30–16:00 ET.
//
// Dependency-free (Vite + Deno).
// ============================================================================

export type SessionInstrumentClass = "fx" | "index";

const NY_TZ = "America/New_York";

const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface NyWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Minutes since ET midnight. */
  minuteOfDay: number;
  /** ET calendar date as YYYY-MM-DD. */
  dateKey: string;
  /** 0 = Sunday … 6 = Saturday, in ET. */
  weekday: number;
}

/** Convert an epoch-ms UTC instant to New York wall-clock parts (DST-correct). */
export function toNewYork(ms: number): NyWallClock {
  const parts = nyFormatter.formatToParts(new Date(ms));
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
  for (const p of parts) {
    switch (p.type) {
      case "year": year = Number(p.value); break;
      case "month": month = Number(p.value); break;
      case "day": day = Number(p.value); break;
      case "hour": hour = Number(p.value); break;
      case "minute": minute = Number(p.value); break;
      case "second": second = Number(p.value); break;
    }
  }
  const dateKey = `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
  // Weekday of the ET calendar date (constructed at UTC noon so the date
  // component cannot slip across a boundary).
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return { year, month, day, hour, minute, second, minuteOfDay: hour * 60 + minute, dateKey, weekday };
}

/** ET offset in minutes for an instant (negative west of UTC), DST-correct. */
export function nyOffsetMinutes(ms: number): number {
  const w = toNewYork(ms);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * Session date for a bar. FX/metals roll at 17:00 ET; index CFDs use the ET
 * calendar date as-is.
 */
export function sessionDate(ms: number, cls: SessionInstrumentClass): string {
  const w = toNewYork(ms);
  if (cls === "index") return w.dateKey;
  if (w.minuteOfDay >= 17 * 60) return addDays(w.dateKey, 1);
  return w.dateKey;
}

/** True when the instant falls inside the instrument's tradeable week. */
export function isTradingTime(ms: number, cls: SessionInstrumentClass): boolean {
  const w = toNewYork(ms);
  if (cls === "index") {
    // Index CFDs: weekdays only, exclude the 17:00-18:00 ET break.
    if (w.weekday === 0 || w.weekday === 6) return false;
    return !(w.minuteOfDay >= 17 * 60 && w.minuteOfDay < 18 * 60);
  }
  // FX week: Sunday from 17:00 ET through Friday 17:00 ET.
  if (w.weekday === 6) return false;
  if (w.weekday === 0) return w.minuteOfDay >= 17 * 60;
  if (w.weekday === 5) return w.minuteOfDay < 17 * 60;
  return true;
}

// ---------------------------------------------------------------------------
// Killzones / trade windows
// ---------------------------------------------------------------------------

export interface TradeWindow {
  key: string;
  label: string;
  /** ET minutes-from-midnight, [startMin, endMin). */
  startMin: number;
  endMin: number;
}

export const KILLZONES: Readonly<Record<string, TradeWindow>> = {
  london: { key: "london", label: "London killzone", startMin: 3 * 60, endMin: 4 * 60 },
  ny_am: { key: "ny_am", label: "NY AM killzone", startMin: 10 * 60, endMin: 11 * 60 },
  ny_pm: { key: "ny_pm", label: "NY PM killzone", startMin: 14 * 60, endMin: 15 * 60 },
};

export const RTH: TradeWindow = { key: "rth", label: "Regular trading hours", startMin: 9 * 60 + 30, endMin: 16 * 60 };

export function inWindow(ms: number, w: TradeWindow): boolean {
  const m = toNewYork(ms).minuteOfDay;
  return m >= w.startMin && m < w.endMin;
}

export function isRth(ms: number): boolean {
  return inWindow(ms, RTH);
}

/**
 * Map a killzone key to the journal's session vocabulary so backtest results
 * and journal trades bucket identically.
 */
export function journalSessionKey(windowKey: string): string {
  switch (windowKey) {
    case "london": return "london";
    case "ny_am": return "new_york_am";
    case "ny_pm": return "new_york_pm";
    default: return windowKey;
  }
}

// ---------------------------------------------------------------------------
// Date helpers (pure string math on YYYY-MM-DD)
// ---------------------------------------------------------------------------

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function pad4(n: number): string { return String(n).padStart(4, "0"); }
