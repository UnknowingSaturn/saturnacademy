// Deno port of src/lib/pairLabMath.ts — pure-functional pieces only.
// Trade rows are duck-typed (any) since edge functions have raw DB rows.
//
// Field keys: we follow the same prefix-and-label resolver as the client so
// the edge function reads the same custom_fields as the UI does.
//
// UNIT CONTRACT (2026-06):
//   cf_mae and cf_ideal_stop_loss are stored in broker TICKS (TradingView
//   position-calc output). Convert with `ticksToPips()` before comparing
//   against pip-denominated SL distances. The slUnit field on each
//   BucketReport surfaces the human-readable label.
//
// Intentional divergence from src/lib/pairLabMath.ts:
//   - server version uses duck-typed `any` rows (raw DB shape)
//   - client version has PropFirmContext, perRow, edgeVsBaseline (UI-only)

import { tickSizeForSymbol, pipSizeForSymbol, pipLabelForSymbol, ticksToPips } from "./symbolMapping.ts";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PairLabFieldKeys {
  mfe: string | null;
  mae: string | null;
  idealStopLoss: string | null;
  idealStopLossPos: string | null;
  idealEntryWindow: string | null;
}

interface CustomFieldDef { key: string; label: string }

export interface PropFirmContext {
  /** prop firm id (e.g. "ftmo"), for labelling. */
  firm: string;
  /** balance starting value, used to translate % rules to R cap. */
  balance: number;
  /** Daily loss limit as $. */
  dailyLossDollars: number | null;
  /** Max drawdown as $. */
  maxDrawdownDollars: number | null;
  /** Profit target as $. */
  profitTargetDollars: number | null;
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
    const byLabel = defs.find((d) => entry.labels.includes((d.label || "").trim().toLowerCase()));
    if (byLabel) { out[entry.alias] = byLabel.key; continue; }
    const byPrefix = defs.find((d) => entry.prefixes.some((p) => (d.key || "").startsWith(p)));
    if (byPrefix) out[entry.alias] = byPrefix.key;
  }
  if (out.idealStopLoss && out.idealStopLoss === out.idealStopLossPos) {
    out.idealStopLoss = null;
  }
  return out;
}

// --- robust stats ---
export function quantile(values: number[], q: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos), w = pos - lo;
  return xs[lo] * (1 - w) + xs[hi] * w;
}
export function median(values: number[]): number | null { return quantile(values, 0.5); }
export function mean(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}
export function bootstrapMeanCi(values: number[], iters = 400): [number, number] | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 5) return null;
  let seed = xs.length * 1000003;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
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
export function quarterKellyPct(winRate: number, avgWinR: number, avgLossR: number): number | null {
  if (!(avgWinR > 0) || !(avgLossR > 0)) return null;
  const b = avgWinR / avgLossR, p = winRate, q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return null;
  return Math.max(0.25, Math.min(1.5, kelly * 0.25 * 100));
}

const SESSION_LABELS: Record<string, string> = {
  tokyo: "Tokyo", asia: "Tokyo", london: "London",
  ny_am: "NY AM", new_york_am: "NY AM", ny_pm: "NY PM", new_york_pm: "NY PM",
  new_york: "NY AM", ny: "NY AM",
};
export function normalizeSession(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  return SESSION_LABELS[String(raw).toLowerCase()] ?? raw;
}

function getCf(t: any, key: string | null): unknown {
  if (!key) return undefined;
  const cf = t?.custom_fields;
  if (!cf || typeof cf !== "object") return undefined;
  return cf[key];
}
export function numericCf(t: any, key: string | null): number | null {
  const v = getCf(t, key);
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function multiSelectCf(t: any, key: string | null): string[] {
  const v = getCf(t, key);
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}

export function parseTpLabel(s: string): number | null {
  if (!s) return null;
  const clean = s.trim().toUpperCase();
  const ratio = clean.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (ratio) { const a = Number(ratio[1]), b = Number(ratio[2]); if (a > 0) return b / a; }
  const tp = clean.match(/^TP\s*(\d+(?:\.\d+)?)$/);
  if (tp) return Number(tp[1]);
  const num = clean.match(/^(\d+(?:\.\d+)?)R?$/);
  if (num) return Number(num[1]);
  return null;
}

export interface BucketKey { symbol: string; session: string }
export interface Tp1Star { r: number; hitRate: number; expectancyR: number }

export interface BucketReport {
  key: BucketKey;
  n: number;
  wins: number;
  losses: number;
  winRate: number;
  expectedR: number;
  expectedRMedian: number;
  expectedRCi: [number, number] | null;
  mfeP50: number | null;
  mfeP75: number | null;
  maeP50: number | null;
  maeP75: number | null;
  maeP75Pips: number | null;
  idealSlMedianPips: number | null;
  slInitialMedianPips: number | null;
  slDrift: "too_wide" | "too_tight" | "aligned" | null;
  confidence: ConfidenceLevel;
  suggestedSlPips: number | null;
  /** "pips" for FX/metals/crypto/oil, "points" for indices. */
  slUnit: "pips" | "points";
  tpLadderR: number[];
  tp1Star: Tp1Star | null;
  suggestedRiskPct: number | null;
  /** Prop-firm-aware cap on suggested risk (% of balance). null when no prop-firm context. */
  suggestedRiskPctPropFirmCap: number | null;
  worstLosingStreak: number;
  loggedMfeCount: number;
  loggedMaeCount: number;
  topTradeIds: string[];
  bottomTradeIds: string[];
}

function confidenceFor(n: number): ConfidenceLevel {
  // Tightened 2026-06: "high" requires n≥50 — at n=30 the 95% CI on win-rate
  // is still ±18pp, too loose to gate real-money parameter changes.
  if (n >= 50) return "high";
  if (n >= 15) return "medium";
  return "low";
}
function longestLossStreak(rows: any[]): number {
  const sorted = [...rows]
    .filter((t) => t.net_pnl != null && t.entry_time)
    .sort((a, b) => String(a.entry_time).localeCompare(String(b.entry_time)));
  let run = 0, worst = 0;
  for (const t of sorted) {
    if ((t.net_pnl ?? 0) < 0) { run += 1; if (run > worst) worst = run; }
    else run = 0;
  }
  return worst;
}
function computeTp1Star(mfes: number[], avgLossR: number): Tp1Star | null {
  if (mfes.length < 5) return null;
  const candidates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
  let best: Tp1Star | null = null;
  for (const r of candidates) {
    const hits = mfes.filter((v) => v >= r).length;
    const hitRate = hits / mfes.length;
    if (hitRate < 0.4) continue;
    const score = hitRate * Math.log(1 + r);
    const expectancyR = hitRate * r - (1 - hitRate) * avgLossR;
    if (!best || score > best.hitRate * Math.log(1 + best.r)) {
      best = { r, hitRate, expectancyR };
    }
  }
  return best;
}

/** Convert a stored `cf_mae` / `cf_ideal_stop_loss` value (TICKS) into the per-trade R-multiple, given the trade's SL distance. */
function ticksToR(ticks: number, t: any): number | null {
  if (t.sl_initial == null || t.entry_price == null || !t.symbol) return null;
  const pip = pipSizeForSymbol(t.symbol);
  if (!(pip > 0)) return null;
  const slDistPips = Math.abs(t.entry_price - t.sl_initial) / pip;
  if (!(slDistPips > 0)) return null;
  const pips = ticksToPips(t.symbol, Math.abs(ticks));
  return pips / slDistPips;
}

export function computeBucket(
  key: BucketKey,
  rows: any[],
  keys: PairLabFieldKeys,
  propFirm?: PropFirmContext | null,
): BucketReport {
  const closed = rows.filter((t) => t.net_pnl != null);
  const sideOf = (t: any): 1 | -1 | 0 => {
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
  const lossR = losses.map((t) => t.r_multiple_actual)
    .filter((v): v is number => v != null && v < 0)
    .map((v) => Math.abs(v));

  const mfes = rows.map((t) => numericCf(t, keys.mfe)).filter((v): v is number => v != null);

  // MAE is logged in PIPS (or POINTS for indices) per the unit contract above.
  const maesR: number[] = [];
  const maesPips: number[] = [];
  for (const t of rows) {
    const maePips = numericCf(t, keys.mae);
    if (maePips == null || !t.symbol) continue;
    maesPips.push(Math.abs(maePips));
    const r = pipsToR(maePips, t);
    if (r != null) maesR.push(r);
  }

  const idealSls: number[] = [];
  for (const t of rows) {
    const idealPips = numericCf(t, keys.idealStopLoss);
    if (idealPips == null || !t.symbol) continue;
    idealSls.push(Math.abs(idealPips));
  }

  const slInitials: number[] = [];
  for (const t of rows) {
    if (t.sl_initial == null || t.entry_price == null || !t.symbol) continue;
    const pip = pipSizeForSymbol(t.symbol);
    if (!(pip > 0)) continue;
    slInitials.push(Math.abs(t.entry_price - t.sl_initial) / pip);
  }

  const n = closed.length;
  const winRate = n > 0 ? wins.length / n : 0;
  const expectedR = mean(rActuals);
  const idealMed = median(idealSls);
  const slInitMed = median(slInitials);
  let slDrift: BucketReport["slDrift"] = null;
  if (idealMed != null && slInitMed != null && slInitMed > 0) {
    const ratio = idealMed / slInitMed;
    if (ratio < 0.8) slDrift = "too_wide";
    else if (ratio > 1.2) slDrift = "too_tight";
    else slDrift = "aligned";
  }

  const maeP75Pips = quantile(maesPips, 0.75);
  let suggestedSlPips: number | null = null;
  const maeCandidate = maeP75Pips != null ? maeP75Pips * 1.15 : null;
  if (maeCandidate != null || idealMed != null) {
    suggestedSlPips = Math.max(maeCandidate ?? 0, idealMed ?? 0);
  }
  const ladder: number[] = [];
  for (const v of [quantile(winR, 0.3), quantile(winR, 0.5), quantile(winR, 0.75)]) {
    if (v == null || v <= 0) continue;
    ladder.push(v);
  }
  const tpLadderR = Array.from(new Set(ladder.map((v) => Math.round(v * 4) / 4))).slice(0, 3);

  const avgWinR = winR.length > 0 ? winR.reduce((a, v) => a + v, 0) / winR.length : 0;
  const avgLossR = lossR.length > 0 ? lossR.reduce((a, v) => a + v, 0) / lossR.length : 1;
  const suggestedRiskPct = n >= 10 ? quarterKellyPct(winRate, avgWinR, avgLossR) : null;
  const tp1Star = computeTp1Star(mfes, avgLossR || 1);

  // Prop-firm cap: the lower of (daily loss limit / max DD) translated to a
  // single-trade risk %. Conservative — assumes 3-loss safety margin.
  let suggestedRiskPctPropFirmCap: number | null = null;
  if (propFirm && propFirm.balance > 0) {
    const limits: number[] = [];
    if (propFirm.dailyLossDollars && propFirm.dailyLossDollars > 0) {
      limits.push((propFirm.dailyLossDollars / propFirm.balance) * 100 / 3);
    }
    if (propFirm.maxDrawdownDollars && propFirm.maxDrawdownDollars > 0) {
      limits.push((propFirm.maxDrawdownDollars / propFirm.balance) * 100 / 5);
    }
    if (limits.length > 0) suggestedRiskPctPropFirmCap = +Math.min(...limits).toFixed(2);
  }

  const sorted = [...closed].sort((a, b) => (b.r_multiple_actual ?? 0) - (a.r_multiple_actual ?? 0));
  const topTradeIds = sorted.slice(0, 3).map((t) => t.id);
  const bottomTradeIds = sorted.slice(-3).reverse().map((t) => t.id);

  const slUnit = key.symbol && key.symbol !== "All" ? pipLabelForSymbol(key.symbol) : "pips";

  return {
    key,
    n,
    wins: wins.length,
    losses: losses.length,
    winRate,
    expectedR,
    expectedRMedian: median(rActuals) ?? 0,
    expectedRCi: bootstrapMeanCi(rActuals),
    mfeP50: median(mfes),
    mfeP75: quantile(mfes, 0.75),
    maeP50: median(maesR),
    maeP75: quantile(maesR, 0.75),
    maeP75Pips,
    idealSlMedianPips: idealMed,
    slInitialMedianPips: slInitMed,
    slDrift,
    confidence: confidenceFor(n),
    suggestedSlPips,
    slUnit,
    tpLadderR,
    tp1Star,
    suggestedRiskPct,
    suggestedRiskPctPropFirmCap,
    worstLosingStreak: longestLossStreak(rows),
    loggedMfeCount: closed.filter((t) => numericCf(t, keys.mfe) != null).length,
    loggedMaeCount: closed.filter((t) => {
      const v = numericCf(t, keys.mae);
      return v != null && t.sl_initial != null && t.entry_price != null;
    }).length,
    topTradeIds,
    bottomTradeIds,
  };
}

export function buildBuckets(
  trades: any[],
  keys: PairLabFieldKeys,
  propFirm?: PropFirmContext | null,
): {
  perCell: BucketReport[];
  baseline: BucketReport;
} {
  const closed = trades.filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null);
  const baseline = computeBucket({ symbol: "All", session: "All sessions" }, closed, keys, propFirm);
  const cellMap = new Map<string, any[]>();
  for (const t of closed) {
    if (!t.symbol) continue;
    const sess = normalizeSession(t.session);
    const k = `${t.symbol}__${sess}`;
    if (!cellMap.has(k)) cellMap.set(k, []);
    cellMap.get(k)!.push(t);
  }
  const perCell: BucketReport[] = [];
  cellMap.forEach((rows, k) => {
    const [symbol, session] = k.split("__");
    perCell.push(computeBucket({ symbol, session }, rows, keys, propFirm));
  });
  perCell.sort((a, b) => b.expectedR * b.n - a.expectedR * a.n);
  return { perCell, baseline };
}
