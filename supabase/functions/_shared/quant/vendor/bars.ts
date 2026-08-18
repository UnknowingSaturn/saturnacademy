// GENERATED FILE — DO NOT EDIT.
// Vendored copy of shared/quant/bars.ts for the Deno edge bundler.
// Edit the canonical file at shared/quant/ and run `npm run quant:sync`.
// ============================================================================
// Bar chunk codec — columnar binary format for 1-minute OHLCV series.
//
// One chunk = one (symbol, timeframe, month). Stored in the private `bars`
// storage bucket at `{source}/{symbol}/{timeframe}/{YYYY-MM}.bin` and indexed
// by the `bar_manifest` table (the bytes never travel through Postgres).
//
// LAYOUT (little-endian):
//   magic   u32   0x42415231 ("BAR1")
//   version u16   1
//   flags   u16   reserved (0)
//   count   u32   number of bars
//   then 6 contiguous Float64 columns of `count` values each:
//     ts (epoch ms), open, high, low, close, volume
//
// Columnar (not row-interleaved) so a consumer can decode straight into
// Float64Array views with zero per-bar object allocation — the execution
// engine walks these arrays directly.
//
// Dependency-free: consumed by Vite (client + worker) and Deno (edge).
// ============================================================================

export const BAR_CHUNK_MAGIC = 0x42415231;
export const BAR_CHUNK_VERSION = 1;
const HEADER_BYTES = 12;

/** Columnar bar series. All arrays share the same length. */
export interface BarSeries {
  ts: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  length: number;
}

export function emptySeries(): BarSeries {
  const z = new Float64Array(0);
  return { ts: z, open: z, high: z, low: z, close: z, volume: z, length: 0 };
}

export function makeSeries(n: number): BarSeries {
  return {
    ts: new Float64Array(n),
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
    volume: new Float64Array(n),
    length: n,
  };
}

export function encodeBarChunk(series: BarSeries): Uint8Array {
  const n = series.length;
  const bytes = HEADER_BYTES + n * 6 * 8;
  const buf = new ArrayBuffer(bytes);
  const view = new DataView(buf);
  view.setUint32(0, BAR_CHUNK_MAGIC, true);
  view.setUint16(4, BAR_CHUNK_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, n, true);

  const cols = [series.ts, series.open, series.high, series.low, series.close, series.volume];
  for (let c = 0; c < cols.length; c++) {
    // Column offsets are 8-byte aligned because HEADER_BYTES (12) is not —
    // write through a DataView rather than a typed-array view on the buffer.
    const base = HEADER_BYTES + c * n * 8;
    const col = cols[c];
    for (let i = 0; i < n; i++) view.setFloat64(base + i * 8, col[i], true);
  }
  return new Uint8Array(buf);
}

export function decodeBarChunk(bytes: Uint8Array): BarSeries {
  if (bytes.byteLength < HEADER_BYTES) return emptySeries();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== BAR_CHUNK_MAGIC) throw new Error("bar chunk: bad magic");
  const version = view.getUint16(4, true);
  if (version !== BAR_CHUNK_VERSION) throw new Error(`bar chunk: unsupported version ${version}`);
  const n = view.getUint32(8, true);
  const expected = HEADER_BYTES + n * 6 * 8;
  if (bytes.byteLength < expected) throw new Error("bar chunk: truncated payload");

  const out = makeSeries(n);
  const cols = [out.ts, out.open, out.high, out.low, out.close, out.volume];
  for (let c = 0; c < cols.length; c++) {
    const base = HEADER_BYTES + c * n * 8;
    const col = cols[c];
    for (let i = 0; i < n; i++) col[i] = view.getFloat64(base + i * 8, true);
  }
  return out;
}

/** Concatenate chunks in chronological order into one series. */
export function concatSeries(parts: BarSeries[]): BarSeries {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = makeSeries(total);
  let o = 0;
  for (const p of parts) {
    out.ts.set(p.ts, o);
    out.open.set(p.open, o);
    out.high.set(p.high, o);
    out.low.set(p.low, o);
    out.close.set(p.close, o);
    out.volume.set(p.volume, o);
    o += p.length;
  }
  return out;
}

/** Inclusive slice by index range. */
export function sliceSeries(s: BarSeries, from: number, to: number): BarSeries {
  const a = Math.max(0, from);
  const b = Math.min(s.length, to);
  const n = Math.max(0, b - a);
  return {
    ts: s.ts.subarray(a, a + n),
    open: s.open.subarray(a, a + n),
    high: s.high.subarray(a, a + n),
    low: s.low.subarray(a, a + n),
    close: s.close.subarray(a, a + n),
    volume: s.volume.subarray(a, a + n),
    length: n,
  };
}

/** First index with ts >= target (binary search). Returns s.length when none. */
export function indexAtOrAfter(s: BarSeries, targetMs: number): number {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.ts[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Data-quality report
// ---------------------------------------------------------------------------

export interface BarQualityReport {
  barCount: number;
  firstTs: number | null;
  lastTs: number | null;
  duplicateTs: number;
  outOfOrder: number;
  zeroVolumeBars: number;
  /** high < low, or open/close outside the high-low range. */
  invalidBars: number;
  /** Gaps in the minute grid, counted only between the first and last bar of a UTC weekday run. */
  missingMinutes: number;
  /** UTC dates (YYYY-MM-DD) that are weekdays with no bars at all. */
  missingDays: string[];
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export function assessBarQuality(s: BarSeries, stepMs = MINUTE_MS): BarQualityReport {
  const rep: BarQualityReport = {
    barCount: s.length,
    firstTs: s.length ? s.ts[0] : null,
    lastTs: s.length ? s.ts[s.length - 1] : null,
    duplicateTs: 0,
    outOfOrder: 0,
    zeroVolumeBars: 0,
    invalidBars: 0,
    missingMinutes: 0,
    missingDays: [],
  };
  if (!s.length) return rep;

  const daysWithBars = new Set<string>();
  for (let i = 0; i < s.length; i++) {
    const h = s.high[i];
    const l = s.low[i];
    const o = s.open[i];
    const c = s.close[i];
    if (!(h >= l) || o > h || o < l || c > h || c < l) rep.invalidBars++;
    if (!(s.volume[i] > 0)) rep.zeroVolumeBars++;
    daysWithBars.add(utcDateKey(s.ts[i]));

    if (i > 0) {
      const d = s.ts[i] - s.ts[i - 1];
      if (d === 0) rep.duplicateTs++;
      else if (d < 0) rep.outOfOrder++;
      // Only count intra-day gaps: a weekend / session close is not a data hole.
      else if (d > stepMs && d < 6 * 3600_000) rep.missingMinutes += Math.round(d / stepMs) - 1;
    }
  }

  // Weekdays inside the covered range with zero bars.
  for (let t = floorUtcDay(s.ts[0]); t <= s.ts[s.length - 1]; t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const key = utcDateKey(t);
    if (!daysWithBars.has(key)) rep.missingDays.push(key);
  }

  return rep;
}

function floorUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Canonical storage path for a chunk. */
export function barChunkPath(source: string, symbol: string, timeframe: string, month: string): string {
  return `${source}/${symbol.toUpperCase()}/${timeframe}/${month}.bin`;
}
