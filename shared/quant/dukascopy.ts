// ============================================================================
// Dukascopy historical feed — instrument catalogue + bi5 candle decoding.
//
// URL shape (NOTE: month is ZERO-BASED — 2024/04/15 is 15 May 2024):
//   https://datafeed.dukascopy.com/datafeed/{INSTRUMENT}/{yyyy}/{MM0}/{dd}/BID_candles_min_1.bi5
//
// Payload: LZMA-alone compressed, decompressing to N × 24-byte BIG-ENDIAN
// records: [u32 secondsFromDayStart, i32 open, i32 close, i32 low, i32 high,
// f32 volume]. Prices are integers scaled by the instrument's decimal factor.
//
// This module is pure (no fetch, no decompression) so it can be unit-tested
// and shared by Vite and Deno. The edge ingest function supplies the already
// decompressed bytes.
// ============================================================================

export interface DukascopyInstrument {
  /** Dukascopy path segment. */
  code: string;
  /** Canonical symbol used everywhere else in the app. */
  symbol: string;
  /** Price integers are divided by this. */
  priceDivisor: number;
  /** Earliest month with usable 1m data, 'YYYY-MM'. */
  since: string;
}

/**
 * Instruments matching the journal's traded universe. Aliases like `NASUSD`,
 * `US100.cash` or `SP500` normalise onto these canonical symbols through
 * `symbolAliasing.ts`.
 */
export const DUKASCOPY_INSTRUMENTS: readonly DukascopyInstrument[] = [
  { code: "EURUSD", symbol: "EURUSD", priceDivisor: 1e5, since: "2010-01" },
  { code: "GBPUSD", symbol: "GBPUSD", priceDivisor: 1e5, since: "2010-01" },
  { code: "USDJPY", symbol: "USDJPY", priceDivisor: 1e3, since: "2010-01" },
  { code: "XAUUSD", symbol: "XAUUSD", priceDivisor: 1e3, since: "2010-01" },
  { code: "XAGUSD", symbol: "XAGUSD", priceDivisor: 1e3, since: "2010-01" },
  { code: "USA500IDXUSD", symbol: "SPXUSD", priceDivisor: 1e3, since: "2012-01" },
  { code: "USATECHIDXUSD", symbol: "NASUSD", priceDivisor: 1e3, since: "2012-01" },
];

export function instrumentForSymbol(symbol: string): DukascopyInstrument | null {
  const s = symbol.toUpperCase();
  return DUKASCOPY_INSTRUMENTS.find((i) => i.symbol === s || i.code === s) ?? null;
}

/** Dukascopy uses zero-based months in its paths. */
export function dukascopyDayUrl(code: string, year: number, month1: number, day: number): string {
  const m0 = String(month1 - 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `https://datafeed.dukascopy.com/datafeed/${code}/${year}/${m0}/${dd}/BID_candles_min_1.bi5`;
}

export interface DecodedBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Decode one decompressed day payload.
 *
 * `dayStartMs` is the UTC midnight of the requested day: record timestamps are
 * offsets in seconds from it. Flat, zero-volume filler rows (Dukascopy emits a
 * full 1440-row grid even on closed days) are dropped.
 */
export function decodeDukascopyDay(raw: Uint8Array, dayStartMs: number, priceDivisor: number): DecodedBar[] {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const count = Math.floor(raw.byteLength / 24);
  const out: DecodedBar[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * 24;
    const secs = view.getUint32(o, false);
    const open = view.getInt32(o + 4, false) / priceDivisor;
    const close = view.getInt32(o + 8, false) / priceDivisor;
    const low = view.getInt32(o + 12, false) / priceDivisor;
    const high = view.getInt32(o + 16, false) / priceDivisor;
    const volume = view.getFloat32(o + 20, false);
    // Filler rows: no ticks traded in that minute.
    if (!(volume > 0)) continue;
    if (!(open > 0) || !(high > 0) || !(low > 0) || !(close > 0)) continue;
    out.push({ ts: dayStartMs + secs * 1000, open, high, low, close, volume });
  }
  return out;
}

/** Days (UTC) of a 'YYYY-MM' month. */
export function monthDays(month: string): Array<{ year: number; month: number; day: number; dayStartMs: number }> {
  const [y, m] = month.split("-").map(Number);
  const days: Array<{ year: number; month: number; day: number; dayStartMs: number }> = [];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= last; d++) {
    days.push({ year: y, month: m, day: d, dayStartMs: Date.UTC(y, m - 1, d) });
  }
  return days;
}

/** Inclusive list of 'YYYY-MM' between two months. */
export function monthRange(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
