/**
 * Sprint C1 — Math verification against live data.
 *
 * Approach: do every computation TWICE.
 *   1. From-scratch independent implementation, written here, that does not
 *      import the project's pairLabMath at all.
 *   2. The actual buildBuckets() / stat helpers shipped in shared/quant.
 *
 * Then diff per-bucket. If both sides agree to float epsilon, math is sound.
 */

import {
  buildBuckets,
  resolvePairLabFieldKeys,
  type PairLabFieldKeys,
} from "../src/lib/pairLabMath";
import {
  quantile,
  rawQuarterKellyPct,
  bootstrapMeanCi,
  wilsonCi,
} from "../shared/quant/stats";
import { buildSymbolResolver, normalizeSymbol } from "../shared/quant/symbolAliasing";
import { ticksToPips, pipLabelForSymbol } from "../shared/quant/symbolMapping";
import fs from "node:fs";

const trades = JSON.parse(fs.readFileSync("/tmp/verify/trades.json", "utf8"));
const aliases = JSON.parse(fs.readFileSync("/tmp/verify/aliases.json", "utf8") || "[]") || [];
const fields = JSON.parse(fs.readFileSync("/tmp/verify/fields.json", "utf8") || "[]") || [];

console.log(`Loaded ${trades.length} trades, ${aliases.length} aliases, ${fields.length} CF defs`);

const keys: PairLabFieldKeys = resolvePairLabFieldKeys(fields);
console.log("Resolved keys:", keys);

// -------- independent helpers (no project import) --------
function qIndep(xs: number[], q: number): number | null {
  const ys = xs.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!ys.length) return null;
  if (ys.length === 1) return ys[0];
  const pos = (ys.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos), w = pos - lo;
  return ys[lo] * (1 - w) + ys[hi] * w;
}
function meanIndep(xs: number[]): number {
  const ys = xs.filter((v) => Number.isFinite(v));
  return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : 0;
}
function kellyIndep(p: number, w: number, l: number): number | null {
  if (!(w > 0) || !(l > 0)) return null;
  const b = w / l;
  const k = (b * p - (1 - p)) / b;
  return k > 0 ? k * 0.25 * 100 : null;
}

// -------- shape trades for buildBuckets --------
const resolveSym = buildSymbolResolver(aliases);

const bucketed = buildBuckets(trades as any, keys, { closedOnly: true });
console.log(`buildBuckets → ${bucketed.perCell.length} cells, baseline n=${bucketed.baseline.n}`);

// -------- independent recomputation per cell --------
type Row = { symbol: string; session: string; netPnl: number; r: number | null;
             cf: Record<string, any>; rawSymbol: string };
const rows: Row[] = trades.map((t: any) => ({
  rawSymbol: t.symbol,
  symbol: resolveSym(t.symbol),
  session: t.session || "Unknown",
  netPnl: Number(t.net_pnl),
  r: t.r_multiple_actual != null ? Number(t.r_multiple_actual) : null,
  cf: t.custom_fields ?? {},
}));

const SESSION_LABELS: Record<string,string> = {
  tokyo:"Tokyo", asia:"Tokyo", london:"London", ny_am:"NY AM", ny_pm:"NY PM",
  ny:"NY AM", new_york:"NY AM", new_york_am:"NY AM", new_york_pm:"NY PM",
};
const normSess = (s: string) => SESSION_LABELS[s?.toLowerCase?.()] ?? s ?? "Unknown";
rows.forEach((r) => { r.session = normSess(r.session); });

const cellMap = new Map<string, Row[]>();
for (const r of rows) {
  const k = `${r.symbol}|${r.session}`;
  (cellMap.get(k) ?? cellMap.set(k, []).get(k))!.push(r);
}

let pass = 0, fail = 0;
const EPS = 1e-6;
const near = (a: number | null, b: number | null) =>
  (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < Math.max(EPS, Math.abs(a) * 1e-9));

const failures: string[] = [];
for (const cell of bucketed.perCell) {
  const key = `${cell.key.symbol}|${cell.key.session}`;
  const mine = cellMap.get(key);
  if (!mine || mine.length === 0) {
    failures.push(`${key}: project has cell, independent has nothing`);
    fail++; continue;
  }
  // n / wins / losses
  const wins = mine.filter((r) => (r.r ?? r.netPnl) > 0).length;
  const losses = mine.filter((r) => (r.r ?? r.netPnl) < 0).length;
  const winRate = wins / mine.length;

  // MFE p50/p75 in R (cf key)
  const mfeKey = keys.mfe;
  const maeKey = keys.mae;
  const mfeVals = mfeKey ? mine.map((r) => Number(r.cf[mfeKey])).filter(Number.isFinite) : [];
  const maeValsTicks = maeKey ? mine.map((r) => Number(r.cf[maeKey])).filter(Number.isFinite) : [];
  // Server's MAE p75 widen is in pips; convert ticks→pips using canonical symbol.
  const maePips = maeValsTicks.map((t) => ticksToPips(cell.key.symbol, t));

  const indep_n = mine.length;
  const indep_wr = winRate;
  const indep_mfeP50 = qIndep(mfeVals, 0.5);
  const indep_mfeP75 = qIndep(mfeVals, 0.75);
  const indep_maeP75Pips = qIndep(maePips, 0.75);

  const proj_n = cell.n;
  const proj_wr = cell.winRate;
  const proj_mfeP50 = cell.mfeP50 ?? null;
  const proj_mfeP75 = cell.mfeP75 ?? null;
  const proj_maeP75Pips = cell.maeP75Pips ?? null;

  const checks: Array<[string, number | null, number | null]> = [
    ["n", indep_n, proj_n],
    ["winRate", indep_wr, proj_wr],
    ["mfeP50", indep_mfeP50, proj_mfeP50],
    ["mfeP75", indep_mfeP75, proj_mfeP75],
    ["maeP75Pips", indep_maeP75Pips, proj_maeP75Pips],
  ];
  const bad = checks.filter(([_, a, b]) => !near(a, b));
  if (bad.length) {
    failures.push(`${key} (n=${indep_n}): ` + bad.map(([k, a, b]) => `${k} indep=${a} proj=${b}`).join("; "));
    fail++;
  } else {
    pass++;
  }
}

console.log(`\n==== per-cell stat check ====\nPASS: ${pass}\nFAIL: ${fail}`);
if (failures.length) {
  console.log("\nFAILURES (first 20):");
  failures.slice(0, 20).forEach((f) => console.log("  ", f));
}

// -------- Kelly sanity on baseline --------
const allR = rows.map((r) => r.r).filter((v): v is number => v != null);
const wRs = allR.filter((v) => v > 0);
const lRs = allR.filter((v) => v < 0).map((v) => -v);
const wrAll = wRs.length / allR.length;
const avgW = meanIndep(wRs);
const avgL = meanIndep(lRs);
const kIndep = kellyIndep(wrAll, avgW, avgL);
const kProj = rawQuarterKellyPct(wrAll, avgW, avgL);
console.log(`\nBaseline Kelly: indep=${kIndep?.toFixed(4)} proj=${kProj?.toFixed(4)} agree=${near(kIndep, kProj)}`);

// Quantile sanity at multiple points
const ps = [0.1, 0.25, 0.5, 0.75, 0.9];
console.log(`\nQuantile spot check on baseline R (n=${allR.length}):`);
for (const q of ps) {
  const a = qIndep(allR, q);
  const b = quantile(allR, q);
  console.log(`  q=${q} indep=${a?.toFixed(6)} proj=${b?.toFixed(6)} agree=${near(a, b)}`);
}

// Wilson CI sanity
const wins0 = rows.filter((r) => (r.r ?? r.netPnl) > 0).length;
const ciIndep = (() => {
  const n = rows.length, z = 1.96, p = wins0 / n;
  const d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const m = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - m), Math.min(1, c + m)] as [number, number];
})();
const ciProj = wilsonCi(wins0, rows.length);
console.log(`\nWilson CI on baseline winRate: indep=[${ciIndep[0].toFixed(6)},${ciIndep[1].toFixed(6)}] proj=[${ciProj?.[0].toFixed(6)},${ciProj?.[1].toFixed(6)}] agree=${near(ciIndep[0], ciProj![0]) && near(ciIndep[1], ciProj![1])}`);

// Bootstrap mean CI determinism
const ci1 = bootstrapMeanCi(allR);
const ci2 = bootstrapMeanCi(allR);
console.log(`\nBootstrap mean CI determinism: ci1=${JSON.stringify(ci1)} ci2=${JSON.stringify(ci2)} stable=${ci1?.[0] === ci2?.[0] && ci1?.[1] === ci2?.[1]}`);

console.log(`\n${fail === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${fail} bucket(s) failed`}`);
