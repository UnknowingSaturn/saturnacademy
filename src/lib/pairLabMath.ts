// ============================================================================
// Pair Lab — quant math
//
// All functions in here are pure. They take an array of Trade rows (with their
// custom_fields jsonb) plus the user's custom-field key map, and produce
// per-bucket distributions and parameter recommendations.
//
// Design notes:
//   - Robust statistics only (median, quantiles, IQR). Means are easy to
//     manipulate with a single outlier; medians aren't.
//   - Kelly is scaled to 0.25 (quarter-Kelly) and clamped, because the sample
//     sizes here are tiny by quant standards.
//   - Confidence is exposed as a sample-size bucket so the UI can hide the
//     numeric output when N < 10.
// ============================================================================

import type { Trade } from "@/types/trading";
import { tickSizeForSymbol, pipSizeForSymbol } from "@/lib/symbolMapping";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PairLabFieldKeys {
  mfe: string | null;            // number (R-multiple)
  mae: string | null;            // number (PIPS for FX/metals/crypto/oil, POINTS for indices)
  idealStopLoss: string | null;  // number (PIPS for FX/metals/crypto/oil, POINTS for indices)
  idealStopLossPos: string | null; // select (initial_leg | last_leg)
  idealEntryWindow: string | null; // select (first_30min | last_30min)
}

export interface BucketKey {
  symbol: string;
  session: string;       // "Tokyo" | "London" | "NY AM" | "NY PM" | "All sessions"
}

export interface BucketStats {
  key: BucketKey;
  /** Raw broker symbols rolled up into this canonical key (for display). */
  rawSymbols: string[];
  n: number;
  wins: number;
  losses: number;
  winRate: number;            // 0–1
  expectedR: number;          // average R-multiple, mean of r_multiple_actual
  expectedRMedian: number;    // median R-multiple
  mfeP50: number | null;          // R-multiple
  mfeP75: number | null;          // R-multiple
  maeP50: number | null;          // R-multiple (per-trade ticks→R)
  maeP75: number | null;          // R-multiple
  maeP75Pips: number | null;      // pips, used for SL recommendation
  idealSlMedian: number | null;   // pips
  slInitialMedian: number | null; // pips
  slDrift: "too_wide" | "too_tight" | "aligned" | null;
  confidence: ConfidenceLevel;
  // Two-sided bootstrap CI on expectedR — null when n < 5.
  expectedRCi: [number, number] | null;
  // Longest run of consecutive losing trades observed in this bucket.
  worstLosingStreak: number;
  /** Number of (closed) trades in this bucket that have an explicit MFE custom-field value. */
  loggedMfeCount: number;
  /** Number of (closed) trades in this bucket that have an explicit MAE custom-field value AND convertible SL. */
  loggedMaeCount: number;
}

export interface Tp1Star {
  r: number;          // R-multiple target
  hitRate: number;    // 0–1, fraction of trades whose MFE ≥ r
  expectancyR: number;
}

export interface PropFirmContext {
  /** Account balance in money — used to translate DD limits to R. */
  balance: number;
  /** Daily loss limit as $ (already converted from % if needed). */
  dailyLossDollars: number | null;
  /** Max drawdown limit as $. */
  maxDrawdownDollars: number | null;
  /** User's planned risk per trade as a fraction (e.g. 0.01 for 1%). */
  riskPerTradeFrac: number;
  /** Hard cap on suggested risk %, e.g. account.risk_per_trade_cap or 2. */
  hardCapPct: number;
  firmName: string | null;
}

export interface BucketRecommendation {
  suggestedSlPips: number | null;
  tpLadderR: number[];            // ascending R targets, 1-3 entries (expected-R)
  tp1Star: Tp1Star | null;        // win-rate-maximizing TP target
  suggestedRiskPct: number | null;  // % of account, edge-only (Kelly)
  suggestedRiskPctPropFirm: number | null; // % of account, prop-firm-capped
  bindingConstraint: "kelly" | "prop_firm_dd" | "hard_cap" | null;
  edgeVsBaseline: {
    winRateDelta: number;        // percentage points
    expectedRDelta: number;
  } | null;
}

export interface BucketReport extends BucketStats {
  recommendation: BucketRecommendation;
  // Best / worst trades for citation (most positive / most negative R).
  topTradeIds: string[];
  bottomTradeIds: string[];
}

// ----------------------------------------------------------------------------
// Field key resolution. Keys are per-user (e.g. cf_mfe_envl); match by label
// first, then by stable prefix, so other users with different generated keys
// still work.
// ----------------------------------------------------------------------------

interface CustomFieldDef {
  key: string;
  label: string;
}

const LABEL_MAP: Array<{ alias: keyof PairLabFieldKeys; labels: string[]; prefixes: string[] }> = [
  { alias: "mfe",              labels: ["mfe (rr)", "mfe", "max favourable excursion", "max favorable excursion"], prefixes: ["cf_mfe"] },
  { alias: "mae",              labels: ["mae", "max adverse excursion"],                                            prefixes: ["cf_mae"] },
  { alias: "idealStopLoss",    labels: ["ideal stop-loss", "ideal stop loss", "ideal sl"],                          prefixes: ["cf_ideal_stop_loss_rnv7", "cf_ideal_stop_loss"] },
  { alias: "idealStopLossPos", labels: ["ideal stop-loss position", "ideal stop loss position"],                    prefixes: ["cf_ideal_stop_loss_position"] },
  { alias: "idealEntryWindow", labels: ["ideal entry window"],                                                      prefixes: ["cf_ideal_entry_window"] },
];

export function resolvePairLabFieldKeys(defs: CustomFieldDef[]): PairLabFieldKeys {
  const out: PairLabFieldKeys = {
    mfe: null, mae: null,
    idealStopLoss: null, idealStopLossPos: null, idealEntryWindow: null,
  };
  for (const entry of LABEL_MAP) {
    // Prefer exact-position match (idealStopLoss vs idealStopLossPos) by
    // checking the more specific entry first — order in LABEL_MAP matters.
    const byLabel = defs.find((d) => entry.labels.includes((d.label || "").trim().toLowerCase()));
    if (byLabel) { out[entry.alias] = byLabel.key; continue; }
    const byPrefix = defs.find((d) => entry.prefixes.some((p) => (d.key || "").startsWith(p)));
    if (byPrefix) out[entry.alias] = byPrefix.key;
  }
  // Disambiguate: "Ideal Stop-Loss" prefix also matches "Ideal Stop-Loss Position".
  // If both ended up pointing at the same key, prefer the more specific one for Pos.
  if (out.idealStopLoss && out.idealStopLoss === out.idealStopLossPos) {
    out.idealStopLoss = null;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Robust statistics
// ----------------------------------------------------------------------------

export function quantile(values: number[], q: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const w = pos - lo;
  return xs[lo] * (1 - w) + xs[hi] * w;
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

// Bootstrap mean CI (2.5% / 97.5%) with `iters` resamples.
// Deterministic seed so the UI doesn't flicker between renders.
export function bootstrapMeanCi(values: number[], iters = 500): [number, number] | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  let seed = xs.length * 1000003;
  const rand = () => {
    // xorshift32
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1_000_000) / 1_000_000;
  };
  const means: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rand() * xs.length)];
    means[i] = sum / xs.length;
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

// Quarter-Kelly with a hard clamp. Returns null when the edge is non-positive.
export function quarterKellyPct(winRate: number, avgWinR: number, avgLossR: number): number | null {
  if (!(avgWinR > 0) || !(avgLossR > 0)) return null;
  const b = avgWinR / avgLossR;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return null;
  const quarter = kelly * 0.25 * 100; // percent of account
  return Math.max(0.25, Math.min(1.5, quarter));
}

// ----------------------------------------------------------------------------
// Bucket build + stats
// ----------------------------------------------------------------------------

const SESSION_LABELS: Record<string, string> = {
  tokyo: "Tokyo",
  asia: "Tokyo",
  london: "London",
  ny_am: "NY AM",
  ny_pm: "NY PM",
  ny: "NY AM",
};

export function normalizeSession(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  return SESSION_LABELS[String(raw).toLowerCase()] ?? raw;
}

function getCf(trade: any, key: string | null): unknown {
  if (!key) return undefined;
  const cf = trade?.custom_fields;
  if (!cf || typeof cf !== "object") return undefined;
  return cf[key];
}

function numericCf(trade: any, key: string | null): number | null {
  const v = getCf(trade, key);
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function multiSelectCf(trade: any, key: string | null): string[] {
  const v = getCf(trade, key);
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

/** Parse strings like "1:2", "1R", "2", "TP2" → R-multiple. Mirrors simulator. */
function parseTpLabelLocal(s: string): number | null {
  if (!s) return null;
  const clean = s.trim().toUpperCase();
  const ratio = clean.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratio) {
    const a = Number(ratio[1]), b = Number(ratio[2]);
    if (a > 0) return b / a;
  }
  const tp = clean.match(/^TP\s*(\d+(?:\.\d+)?)$/);
  if (tp) return Number(tp[1]);
  const num = clean.match(/^(\d+(?:\.\d+)?)R?$/);
  if (num) return Number(num[1]);
  return null;
}

function confidenceFor(n: number): ConfidenceLevel {
  // Tightened 2026-06: "high" requires n≥50 — at n=30 the 95% CI on win-rate
  // is still ±18pp, too loose to gate real-money parameter changes.
  if (n >= 50) return "high";
  if (n >= 15) return "medium";
  return "low";
}

export interface BuildBucketsOpts {
  /** Optional filter — only trades with a matching planned profile. */
  profile?: string | null;
  /** Optional filter — only trades whose actual_profile matches. */
  actualProfile?: string | null;
  /** Closed trades only when true (default). */
  closedOnly?: boolean;
  /** Map a raw broker symbol to its canonical name. Default = identity. */
  symbolResolver?: (raw: string) => string;
  /** When supplied, recommendation includes a prop-firm-aware risk cap. */
  propFirm?: PropFirmContext | null;
}

export function buildBuckets(
  trades: Trade[],
  keys: PairLabFieldKeys,
  opts: BuildBucketsOpts = {},
): { perCell: BucketReport[]; perRow: BucketReport[]; baseline: BucketReport } {
  const closedOnly = opts.closedOnly !== false;
  const resolveSym = opts.symbolResolver ?? ((s: string) => s);
  const filtered = trades.filter((t) => {
    if (closedOnly && t.is_open) return false;
    if (t.is_archived) return false;
    if (opts.profile && t.profile !== opts.profile) return false;
    if (opts.actualProfile && t.actual_profile !== opts.actualProfile) return false;
    return true;
  });

  // Baseline = all symbols, all sessions (used for edge deltas).
  const baseline = computeBucket(
    { symbol: "All", session: "All sessions" },
    filtered,
    keys,
    null,
    opts.propFirm ?? null,
  );

  // Per-cell (canonicalSymbol × session) and per-row (canonicalSymbol × "All sessions").
  const cellMap = new Map<string, Trade[]>();
  const rowMap = new Map<string, Trade[]>();
  const cellRawSymbols = new Map<string, Set<string>>();
  const rowRawSymbols = new Map<string, Set<string>>();
  for (const t of filtered) {
    if (!t.symbol) continue;
    const canonical = resolveSym(t.symbol);
    const sess = normalizeSession(t.session);
    const cellKey = `${canonical}__${sess}`;
    if (!cellMap.has(cellKey)) { cellMap.set(cellKey, []); cellRawSymbols.set(cellKey, new Set()); }
    cellMap.get(cellKey)!.push(t);
    cellRawSymbols.get(cellKey)!.add(t.symbol);
    if (!rowMap.has(canonical)) { rowMap.set(canonical, []); rowRawSymbols.set(canonical, new Set()); }
    rowMap.get(canonical)!.push(t);
    rowRawSymbols.get(canonical)!.add(t.symbol);
  }

  const perCell: BucketReport[] = [];
  cellMap.forEach((rows, cellKey) => {
    const [symbol, session] = cellKey.split("__");
    const report = computeBucket({ symbol, session }, rows, keys, baseline, opts.propFirm ?? null);
    report.rawSymbols = Array.from(cellRawSymbols.get(cellKey) ?? []).sort();
    perCell.push(report);
  });
  const perRow: BucketReport[] = [];
  rowMap.forEach((rows, symbol) => {
    const report = computeBucket(
      { symbol, session: "All sessions" },
      rows,
      keys,
      baseline,
      opts.propFirm ?? null,
    );
    report.rawSymbols = Array.from(rowRawSymbols.get(symbol) ?? []).sort();
    perRow.push(report);
  });

  perCell.sort((a, b) => (b.n - a.n) || a.key.symbol.localeCompare(b.key.symbol));
  perRow.sort((a, b) => b.n - a.n);
  return { perCell, perRow, baseline };
}

/** Longest run of consecutive losing trades (net_pnl < 0), ordered by entry_time. */
function longestLossStreak(rows: Trade[]): number {
  const sorted = [...rows]
    .filter((t) => t.net_pnl != null && t.entry_time)
    .sort((a, b) => String(a.entry_time).localeCompare(String(b.entry_time)));
  let run = 0;
  let worst = 0;
  for (const t of sorted) {
    if ((t.net_pnl ?? 0) < 0) {
      run += 1;
      if (run > worst) worst = run;
    } else {
      run = 0;
    }
  }
  return worst;
}

/** Empirical hit rate of MFE ≥ r for trades that have MFE recorded. */
function computeTp1Star(mfes: number[], avgLossR: number): Tp1Star | null {
  if (mfes.length < 5) return null;
  const candidates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  let best: Tp1Star | null = null;
  for (const r of candidates) {
    const hits = mfes.filter((v) => v >= r).length;
    const hitRate = hits / mfes.length;
    if (hitRate < 0.4) continue; // need a real chance of being hit
    // log scaling avoids 0.25R always winning the "win rate" race.
    const score = hitRate * Math.log(1 + r);
    const expectancyR = hitRate * r - (1 - hitRate) * avgLossR;
    if (!best || score > best.hitRate * Math.log(1 + best.r)) {
      best = { r, hitRate, expectancyR };
    }
  }
  return best;
}

function computeBucket(
  key: BucketKey,
  rows: Trade[],
  keys: PairLabFieldKeys,
  baseline: BucketReport | null,
  propFirm: PropFirmContext | null,
): BucketReport {
  const closed = rows.filter((t) => t.net_pnl != null);

  // Normalize win/loss using r_multiple_actual when available, falling back
  // to sign(net_pnl) only when r_actual is missing. Keeps grid + simulator
  // consistent.
  const sideOf = (t: Trade): 1 | -1 | 0 => {
    if (t.r_multiple_actual != null) {
      if (t.r_multiple_actual > 0) return 1;
      if (t.r_multiple_actual < 0) return -1;
      return 0;
    }
    const p = t.net_pnl ?? 0;
    return p > 0 ? 1 : p < 0 ? -1 : 0;
  };
  const wins = closed.filter((t) => sideOf(t) === 1);
  const losses = closed.filter((t) => sideOf(t) === -1);

  const rActuals = closed.map((t) => t.r_multiple_actual).filter((v): v is number => v != null);
  const winR = wins.map((t) => t.r_multiple_actual).filter((v): v is number => v != null && v > 0);
  const lossR = losses
    .map((t) => t.r_multiple_actual)
    .filter((v): v is number => v != null && v < 0)
    .map((v) => Math.abs(v));

  const mfes = rows.map((t) => numericCf(t as any, keys.mfe)).filter((v): v is number => v != null);

  // MAE is logged in PIPS (or POINTS for indices). Convert per-trade to
  // R-multiple for display by dividing by SL distance in the same unit.
  const maesR: number[] = [];
  const maesPips: number[] = [];
  for (const t of rows) {
    const maePips = numericCf(t as any, keys.mae);
    if (maePips == null || !t.symbol) continue;
    const pip = pipSizeForSymbol(t.symbol);
    if (!(pip > 0)) continue;
    maesPips.push(Math.abs(maePips));
    if (t.sl_initial != null && t.entry_price != null) {
      const slDistPips = Math.abs(t.entry_price - t.sl_initial) / pip;
      if (slDistPips > 0) maesR.push(Math.abs(maePips) / slDistPips);
    }
  }

  // Ideal SL is logged in PIPS (or POINTS for indices).
  const idealSls: number[] = [];
  for (const t of rows) {
    const idealPips = numericCf(t as any, keys.idealStopLoss);
    if (idealPips == null || !t.symbol) continue;
    idealSls.push(Math.abs(idealPips));
  }

  // SL initial distance in pips per trade (symbol-aware).
  const slInitials: number[] = [];
  for (const t of rows) {
    if (t.sl_initial == null || t.entry_price == null || !t.symbol) continue;
    const pip = pipSizeForSymbol(t.symbol);
    if (!(pip > 0)) continue;
    slInitials.push(Math.abs(t.entry_price - t.sl_initial) / pip);
  }

  const tpDist: Record<string, number> = {};
  for (const t of rows) {
    for (const v of multiSelectCf(t as any, keys.tpReached)) {
      tpDist[v] = (tpDist[v] ?? 0) + 1;
    }
  }
  const mostCommonTpHit = Object.entries(tpDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const n = closed.length;
  const winRate = n > 0 ? wins.length / n : 0;
  const expectedR = mean(rActuals);
  const expectedRMedian = median(rActuals) ?? 0;

  const idealMed = median(idealSls);
  const slInitMed = median(slInitials);
  let slDrift: BucketStats["slDrift"] = null;
  if (idealMed != null && slInitMed != null) {
    const ratio = idealMed / slInitMed;
    if (ratio < 0.8) slDrift = "too_wide";
    else if (ratio > 1.2) slDrift = "too_tight";
    else slDrift = "aligned";
  }

  const stats: BucketStats = {
    key,
    rawSymbols: [],
    n,
    wins: wins.length,
    losses: losses.length,
    winRate,
    expectedR,
    expectedRMedian,
    mfeP50: median(mfes),
    mfeP75: quantile(mfes, 0.75),
    maeP50: median(maesR),
    maeP75: quantile(maesR, 0.75),
    maeP75Pips: quantile(maesPips, 0.75),
    idealSlMedian: idealMed,
    slInitialMedian: slInitMed,
    slDrift,
    tpHitDistribution: tpDist,
    mostCommonTpHit,
    confidence: confidenceFor(n),
    expectedRCi: bootstrapMeanCi(rActuals),
    worstLosingStreak: longestLossStreak(rows),
    loggedMfeCount: closed.filter((t) => numericCf(t as any, keys.mfe) != null).length,
    loggedMaeCount: closed.filter((t) => {
      const v = numericCf(t as any, keys.mae);
      return v != null && t.sl_initial != null && t.entry_price != null;
    }).length,
  };


  const recommendation = buildRecommendation(stats, winR, lossR, mfes, baseline, propFirm);

  const sorted = [...closed].sort(
    (a, b) => (b.r_multiple_actual ?? 0) - (a.r_multiple_actual ?? 0),
  );
  const topTradeIds = sorted.slice(0, 3).map((t) => t.id);
  const bottomTradeIds = sorted.slice(-3).reverse().map((t) => t.id);

  return { ...stats, recommendation, topTradeIds, bottomTradeIds };
}

function buildRecommendation(
  s: BucketStats,
  winR: number[],
  lossR: number[],
  mfes: number[],
  baseline: BucketReport | null,
  propFirm: PropFirmContext | null,
): BucketRecommendation {
  // SL: max of (p75(MAE pips) × 1.15, median(ideal SL pips)). Both in pips.
  let suggestedSlPips: number | null = null;
  const maeCandidate = s.maeP75Pips != null ? s.maeP75Pips * 1.15 : null;
  if (maeCandidate != null || s.idealSlMedian != null) {
    suggestedSlPips = Math.max(maeCandidate ?? 0, s.idealSlMedian ?? 0);
  }

  // Expected-R TP ladder, capped by the most-common TP hit so we never
  // recommend a target the user has never reached in practice. Reuses the
  // simulator's full TP-label parser ("1:2", "TP2", "2R", …).
  const ladder: number[] = [];
  const cap = (() => {
    if (!s.mostCommonTpHit) return Infinity;
    const parsed = parseTpLabelLocal(s.mostCommonTpHit);
    return parsed != null && parsed > 0 ? parsed : Infinity;
  })();
  const p70 = quantile(winR, 0.3);
  const p50 = quantile(winR, 0.5);
  const p25 = quantile(winR, 0.75);
  for (const v of [p70, p50, p25]) {
    if (v == null || v <= 0) continue;
    ladder.push(Math.min(v, cap));
  }
  const tpLadderR = Array.from(new Set(ladder.map((v) => Math.round(v * 4) / 4))).slice(0, 3);


  // Kelly sizing.
  const avgWinR = winR.length > 0 ? winR.reduce((a, v) => a + v, 0) / winR.length : 0;
  const avgLossR = lossR.length > 0 ? lossR.reduce((a, v) => a + v, 0) / lossR.length : 1;
  const suggestedRiskPct = s.n >= 10 ? quarterKellyPct(s.winRate, avgWinR, avgLossR) : null;

  // TP1* — win-rate-maximizing target from MFE distribution.
  const tp1Star = computeTp1Star(mfes, avgLossR || 1);

  // Prop-firm-aware risk cap.
  let suggestedRiskPctPropFirm: number | null = null;
  let bindingConstraint: BucketRecommendation["bindingConstraint"] = null;
  if (propFirm && propFirm.balance > 0 && propFirm.dailyLossDollars != null) {
    // Worst plausible losing streak: use observed worst, but assume at
    // least 3 to avoid sizing off a single trade's history.
    const streak = Math.max(3, s.worstLosingStreak || 0);
    // Daily loss budget translated to % of account.
    const dailyBudgetPct = (propFirm.dailyLossDollars / propFirm.balance) * 100;
    // Distribute the budget across `streak` consecutive full-stop losses.
    const ddCappedPct = dailyBudgetPct / streak;
    suggestedRiskPctPropFirm = Math.max(0.1, Math.min(propFirm.hardCapPct, ddCappedPct));

    if (suggestedRiskPct == null) {
      bindingConstraint = "prop_firm_dd";
    } else if (suggestedRiskPctPropFirm < suggestedRiskPct) {
      bindingConstraint = suggestedRiskPctPropFirm >= propFirm.hardCapPct - 0.001
        ? "hard_cap"
        : "prop_firm_dd";
    } else {
      bindingConstraint = "kelly";
    }
  } else if (suggestedRiskPct != null) {
    bindingConstraint = "kelly";
  }

  let edgeVsBaseline: BucketRecommendation["edgeVsBaseline"] = null;
  if (baseline && baseline.n > 0 && s.key.symbol !== "All") {
    edgeVsBaseline = {
      winRateDelta: (s.winRate - baseline.winRate) * 100,
      expectedRDelta: s.expectedR - baseline.expectedR,
    };
  }

  return {
    suggestedSlPips,
    tpLadderR,
    tp1Star,
    suggestedRiskPct,
    suggestedRiskPctPropFirm,
    bindingConstraint,
    edgeVsBaseline,
  };
}
