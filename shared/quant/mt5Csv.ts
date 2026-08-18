// ============================================================================
// MT5 M1 history import — CSV/TSV parser, server-time detection, month split.
//
// Primary data source for the backtest lab: the broker's OWN 1-minute history,
// exported from MetaTrader 5 (Symbols → Bars → Export, or a saved M1 chart).
// Using the same feed that filled the trades in the journal is what makes a
// backtest comparable to real results.
//
// Accepted shapes (all auto-detected):
//   <DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>
//   2024.01.02,00:00,16850.5,16852.0,16849.0,16851.5,132
//   2024-01-02 00:00:00;1.10412;1.10430;1.10405;1.10419;88
//
// MT5 stamps bars in BROKER SERVER TIME (usually UTC+2/+3). Everything
// downstream is UTC, so the offset is detected from the weekly close and can
// be overridden by the user.
//
// Dependency-free: consumed by Vite (client + worker) and Deno (edge).
// ============================================================================

import { makeSeries, type BarSeries } from "./bars";

export interface ParsedBar {
  ts: number; // epoch ms, still in FILE time until the offset is applied
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ParseIssue {
  line: number;
  reason: string;
}

export interface ParsedMt5Csv {
  bars: ParsedBar[];
  delimiter: string;
  hadHeader: boolean;
  /** Rows dropped, with the first few reasons. */
  skipped: number;
  issues: ParseIssue[];
  /** Modal bar spacing in ms (60000 for a genuine M1 export). */
  stepMs: number | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function detectDelimiter(line: string): string {
  const counts: Array<[string, number]> = [
    ["\t", (line.match(/\t/g) ?? []).length],
    [";", (line.match(/;/g) ?? []).length],
    [",", (line.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : /\s{2,}|\s/.test(line) ? " " : ",";
}

function splitCells(line: string, delim: string): string[] {
  const parts = delim === " " ? line.trim().split(/\s+/) : line.split(delim);
  return parts.map((p) => p.trim().replace(/^"|"$/g, ""));
}

const DATE_RE = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DATETIME_RE = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Epoch ms for a date/time treated as if it were UTC (offset applied later). */
function toEpoch(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

function parseTimestamp(cells: string[]): { ts: number; used: number } | null {
  const dt = DATETIME_RE.exec(cells[0]);
  if (dt) {
    return {
      ts: toEpoch(+dt[1], +dt[2], +dt[3], +dt[4], +dt[5], dt[6] ? +dt[6] : 0),
      used: 1,
    };
  }
  const date = DATE_RE.exec(cells[0]);
  const time = cells.length > 1 ? TIME_RE.exec(cells[1]) : null;
  if (date && time) {
    return {
      ts: toEpoch(+date[1], +date[2], +date[3], +time[1], +time[2], time[3] ? +time[3] : 0),
      used: 2,
    };
  }
  return null;
}

function num(v: string): number {
  // Tolerate thousands separators and comma decimals in localized exports.
  const cleaned = v.replace(/\s/g, "").replace(/(\d),(\d{3}\b)/g, "$1$2");
  return Number(cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned);
}

export function parseMt5Csv(text: string, maxIssues = 20): ParsedMt5Csv {
  const lines = text.split(/\r?\n/);
  let delimiter = ",";
  for (const l of lines) {
    if (l.trim()) { delimiter = detectDelimiter(l); break; }
  }

  const bars: ParsedBar[] = [];
  const issues: ParseIssue[] = [];
  let skipped = 0;
  let hadHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const cells = splitCells(raw, delimiter);
    const stamp = parseTimestamp(cells);
    if (!stamp) {
      if (bars.length === 0 && !hadHeader) { hadHeader = true; continue; } // header row
      skipped++;
      if (issues.length < maxIssues) issues.push({ line: i + 1, reason: "unparseable timestamp" });
      continue;
    }
    const rest = cells.slice(stamp.used);
    if (rest.length < 4) {
      skipped++;
      if (issues.length < maxIssues) issues.push({ line: i + 1, reason: "missing OHLC columns" });
      continue;
    }
    const open = num(rest[0]);
    const high = num(rest[1]);
    const low = num(rest[2]);
    const close = num(rest[3]);
    const volume = rest.length > 4 ? num(rest[4]) : 0;
    if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) {
      skipped++;
      if (issues.length < maxIssues) issues.push({ line: i + 1, reason: "non-numeric OHLC" });
      continue;
    }
    if (high < low || open > high || open < low || close > high || close < low) {
      skipped++;
      if (issues.length < maxIssues) issues.push({ line: i + 1, reason: "inconsistent OHLC" });
      continue;
    }
    bars.push({ ts: stamp.ts, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }

  bars.sort((a, b) => a.ts - b.ts);
  return { bars, delimiter, hadHeader, skipped, issues, stepMs: modalStep(bars) };
}

/** Most common positive gap between consecutive bars — the real timeframe. */
export function modalStep(bars: ParsedBar[]): number | null {
  if (bars.length < 3) return null;
  const tally = new Map<number, number>();
  const n = Math.min(bars.length, 5000);
  for (let i = 1; i < n; i++) {
    const d = bars[i].ts - bars[i - 1].ts;
    if (d > 0 && d <= 6 * 3600_000) tally.set(d, (tally.get(d) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [d, c] of tally) if (c > bestCount) { best = d; bestCount = c; }
  return best;
}

// ---------------------------------------------------------------------------
// Server-time offset detection
// ---------------------------------------------------------------------------

export interface OffsetDetection {
  /** Minutes to SUBTRACT from file timestamps to reach UTC. */
  offsetMinutes: number;
  /** Number of weekly closes the estimate is based on. */
  samples: number;
  confident: boolean;
}

/**
 * The FX/CFD week closes at 21:00 UTC on Friday (17:00 New York). Find the
 * weekly gaps, look at what clock time the file claims for that close, and the
 * difference is the broker's UTC offset.
 */
export function detectServerOffset(bars: ParsedBar[]): OffsetDetection {
  const CLOSE_MINUTE_UTC = 21 * 60;
  const marks: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const gap = bars[i].ts - bars[i - 1].ts;
    if (gap < 24 * 3600_000 || gap > 3 * DAY_MS) continue;
    const last = bars[i - 1].ts;
    // Last bar of the week: its stamp is the close minute (bar open), so the
    // close is one bar later.
    const minuteOfDay = Math.floor(((last + MINUTE_MS) % DAY_MS) / MINUTE_MS);
    marks.push(minuteOfDay);
  }
  if (marks.length === 0) return { offsetMinutes: 0, samples: 0, confident: false };

  // Circular median around the expected close.
  const diffs = marks
    .map((m) => {
      let d = m - CLOSE_MINUTE_UTC;
      while (d > 720) d -= 1440;
      while (d < -720) d += 1440;
      return d;
    })
    .sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  // Brokers sit on whole (occasionally half) hours.
  const offsetMinutes = Math.round(median / 30) * 30;
  const spread = diffs[diffs.length - 1] - diffs[0];
  return { offsetMinutes, samples: marks.length, confident: marks.length >= 3 && spread <= 120 };
}

// ---------------------------------------------------------------------------
// Month splitting
// ---------------------------------------------------------------------------

export function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

export interface MonthSlice {
  month: string;
  series: BarSeries;
}

/**
 * Apply the UTC offset, drop duplicate minutes (last write wins on a repeated
 * stamp) and split into one BarSeries per calendar month.
 */
export function toMonthlySeries(bars: ParsedBar[], offsetMinutes: number): {
  months: MonthSlice[];
  duplicates: number;
} {
  const shift = offsetMinutes * MINUTE_MS;
  const byMonth = new Map<string, Map<number, ParsedBar>>();
  let duplicates = 0;

  for (const b of bars) {
    const ts = b.ts - shift;
    const key = monthKey(ts);
    let bucket = byMonth.get(key);
    if (!bucket) { bucket = new Map(); byMonth.set(key, bucket); }
    if (bucket.has(ts)) duplicates++;
    bucket.set(ts, { ...b, ts });
  }

  const months: MonthSlice[] = [];
  for (const key of [...byMonth.keys()].sort()) {
    const rows = [...byMonth.get(key)!.values()].sort((a, b) => a.ts - b.ts);
    const series = makeSeries(rows.length);
    for (let i = 0; i < rows.length; i++) {
      series.ts[i] = rows[i].ts;
      series.open[i] = rows[i].open;
      series.high[i] = rows[i].high;
      series.low[i] = rows[i].low;
      series.close[i] = rows[i].close;
      series.volume[i] = rows[i].volume;
    }
    months.push({ month: key, series });
  }
  return { months, duplicates };
}
