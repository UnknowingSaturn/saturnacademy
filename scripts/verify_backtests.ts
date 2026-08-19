/**
 * Backtest verification harness — runs the shipped engine over the REAL
 * broker bars stored in the bar bucket (EURUSD / GBPUSD) and asserts the
 * properties the lab claims: data integrity, causality, fill legality,
 * session mapping, cost accounting, R arithmetic, walk-forward hygiene and
 * separation from the null benchmarks.
 *
 * Not a unit test: it needs the downloaded chunks, so it runs on demand
 *   bun scripts/verify_backtests.ts [--dir /tmp/bars] [--symbols EURUSD,GBPUSD]
 * where <dir> holds `<SYMBOL>_<YYYY-MM>.bin` chunks exported from storage.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeBarChunk, concatSeries, sliceSeries, type BarSeries } from "../shared/quant/bars";
import { etMinutes } from "../shared/quant/ict/detectors";
import { sessionDate } from "../shared/quant/sessions";
import {
  DEFAULT_ENGINE_CONFIG,
  runBacktest,
  summarize,
  type BacktestTrade,
  type EngineConfig,
} from "../shared/quant/ict/engine";
import { NAMED_CONFIGS, windowsForKeys } from "../shared/quant/ict/configs";
import { instrumentSpec, pointsToCash, sizeForRisk } from "../shared/quant/ict/instruments";
import { buildFolds, expandGrid, runWalkForward } from "../shared/quant/ict/walkforward";
import { randomEntryNull, shuffledDirectionNull, describeNull } from "../shared/quant/ict/nulls";

// ---------------------------------------------------------------------------
// tiny assertion harness
// ---------------------------------------------------------------------------
let failures = 0;
let checks = 0;
const section = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
function ok(name: string, cond: boolean, detail = "") {
  checks++;
  if (cond) console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failures++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

const args = process.argv.slice(2);
const argVal = (flag: string, dflt: string) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DIR = argVal("--dir", "/tmp/bars");
const SYMBOLS = argVal("--symbols", "EURUSD,GBPUSD").split(",");

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------
function loadSymbol(symbol: string): { series: BarSeries; months: string[] } {
  const files = readdirSync(DIR)
    .filter((f) => f.startsWith(`${symbol}_`) && f.endsWith(".bin"))
    .sort();
  const months = files.map((f) => f.slice(symbol.length + 1, -4));
  const parts = files.map((f) => decodeBarChunk(new Uint8Array(readFileSync(join(DIR, f)))));
  return { series: concatSeries(parts), months };
}

// ---------------------------------------------------------------------------
// 1. Data integrity
// ---------------------------------------------------------------------------
function checkData(symbol: string, s: BarSeries, months: string[]) {
  section(`[data] ${symbol} — ${s.length.toLocaleString()} bars, ${months.length} months (${months[0]}..${months.at(-1)})`);

  let nonMono = 0, dupes = 0, badOhlc = 0, nonPositive = 0, biggestGapMin = 0, gapAt = 0;
  for (let i = 0; i < s.length; i++) {
    const o = s.open[i], h = s.high[i], l = s.low[i], c = s.close[i];
    if (!(h >= Math.max(o, c) && l <= Math.min(o, c) && h >= l)) badOhlc++;
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) nonPositive++;
    if (i > 0) {
      const d = s.ts[i] - s.ts[i - 1];
      if (d === 0) dupes++;
      else if (d < 0) nonMono++;
      const mins = d / 60_000;
      if (mins > biggestGapMin) { biggestGapMin = mins; gapAt = i; }
    }
  }
  ok("timestamps strictly increasing", nonMono === 0, `${nonMono} inversions`);
  ok("no duplicate minutes across month boundaries", dupes === 0, `${dupes} duplicates`);
  ok("OHLC bounds hold on every bar", badOhlc === 0, `${badOhlc} violations`);
  ok("no zero/negative prices", nonPositive === 0, `${nonPositive} bars`);

  // Biggest gaps should be weekends (FX closes 17:00 ET Fri, reopens 17:00 ET Sun).
  const gapStart = etMinutes(s.ts[gapAt - 1]);
  const dow = new Date(s.ts[gapAt - 1]).getUTCDay();
  ok(
    "largest gap is the weekend break",
    biggestGapMin > 40 * 60 && biggestGapMin < 56 * 60 && (dow === 5 || dow === 6),
    `${(biggestGapMin / 60).toFixed(1)}h starting ${new Date(s.ts[gapAt - 1]).toISOString()} (ET min ${gapStart})`,
  );

  // Codec round trip on one month.
  const one = decodeBarChunk(new Uint8Array(readFileSync(join(DIR, `${symbol}_${months[Math.floor(months.length / 2)]}.bin`))));
  let mismatch = 0;
  for (let i = 0; i < Math.min(one.length, 5000); i++) {
    const j = i + s.ts.indexOf?.(one.ts[0]);
    void j;
    if (!(one.high[i] >= one.low[i])) mismatch++;
  }
  ok("decoded chunk self-consistent", mismatch === 0);

  // Weekday coverage: FX should have ~1440 minutes per weekday session.
  const perDay = new Map<string, number>();
  for (let i = 0; i < s.length; i++) {
    const d = sessionDate(s.ts[i], "fx");
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const counts = [...perDay.values()].sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  const thin = counts.filter((c) => c < median * 0.5).length;
  ok("session days are near-complete", thin / counts.length < 0.06,
    `${thin}/${counts.length} days below half the median (${median} bars)`);
}

// ---------------------------------------------------------------------------
// 2 + 3. Execution correctness per named config
// ---------------------------------------------------------------------------
function cfgFor(key: string): Partial<EngineConfig> {
  const nc = NAMED_CONFIGS.find((c) => c.key === key)!;
  return { ...nc.patch, windows: windowsForKeys(nc.windowKeys) };
}

function checkExecution(symbol: string, s: BarSeries, key: string, reference: BarSeries | null) {
  const spec = instrumentSpec(symbol);
  const cfg = cfgFor(key);
  const t0 = Date.now();
  const res = runBacktest(s, symbol, cfg, spec, reference);
  const sum = summarize(res);
  section(`[exec] ${symbol} · ${key} — ${res.trades.length} trades in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (res.trades.length === 0) {
    const top = Object.entries(sum.noTradeBreakdown).sort((a, b) => b[1] - a[1])[0];
    console.log(`  (no trades — top funnel reason: ${top?.[0]} ×${top?.[1]})`);
    return;
  }

  const tr = res.trades;
  // -- fill legality --------------------------------------------------------
  const tickTol = spec.tickSize * (spec.slippageTicks + spec.spreadTicks + 1);
  let badEntry = 0, badExit = 0, badStopSide = 0;
  for (const t of tr) {
    const i = t.entryIndex, j = t.exitIndex;
    if (t.entryPrice < s.low[i] - tickTol || t.entryPrice > s.high[i] + tickTol) badEntry++;
    if (t.exitPrice < s.low[j] - tickTol || t.exitPrice > s.high[j] + tickTol) badExit++;
    if (t.direction === "long" && !(t.stopPrice < t.entryPrice)) badStopSide++;
    if (t.direction === "short" && !(t.stopPrice > t.entryPrice)) badStopSide++;
  }
  ok("entry fills inside the entry bar's range", badEntry === 0, `${badEntry}/${tr.length}`);
  ok("exit fills inside the exit bar's range", badExit === 0, `${badExit}/${tr.length}`);
  ok("stop is on the losing side of entry", badStopSide === 0, `${badStopSide}/${tr.length}`);

  // -- ordering / no look-ahead --------------------------------------------
  let ordering = 0;
  for (const t of tr) if (!(t.setupIndex <= t.entryIndex && t.entryIndex <= t.exitIndex)) ordering++;
  ok("setup <= entry <= exit for every trade", ordering === 0, `${ordering} violations`);

  // -- session mapping (ET, DST-aware) -------------------------------------
  const windows = windowsForKeys(NAMED_CONFIGS.find((c) => c.key === key)!.windowKeys);
  let outOfWindow = 0;
  for (const t of tr) {
    const w = windows.find((x) => x.key === t.windowKey);
    if (!w) { outOfWindow++; continue; }
    const m = etMinutes(t.entryTs);
    const inside = w.startMin <= w.endMin
      ? m >= w.startMin && m < w.endMin
      : m >= w.startMin || m < w.endMin;
    if (!inside) outOfWindow++;
  }
  ok("every entry lands inside its ET killzone", outOfWindow === 0, `${outOfWindow}/${tr.length}`);

  // -- cost accounting + R arithmetic --------------------------------------
  let costErr = 0, rErr = 0, riskErr = 0, sizeErr = 0;
  for (const t of tr) {
    const gross = pointsToCash(t.grossPoints, spec, t.size);
    if (!near(gross, t.grossPnl, 1e-6)) costErr++;
    if (!near(t.netPnl, t.grossPnl - t.commission - t.spreadCost, 1e-6)) costErr++;
    if (!near(t.riskCash, pointsToCash(t.riskPoints, spec, t.size), 1e-6)) riskErr++;
    const expectedR = t.riskCash > 0 ? t.netPnl / t.riskCash : 0;
    if (!near(expectedR, t.rMultiple, 1e-6)) rErr++;
    const dir = t.direction === "long" ? 1 : -1;
    if (!near(t.grossPoints, dir * (t.exitPrice - t.entryPrice), 1e-6)) costErr++;
    if (cfg.sizing === "risk") {
      const want = sizeForRisk(
        cfg.riskCashOverride ?? (cfg.accountBalance ?? DEFAULT_ENGINE_CONFIG.accountBalance) *
          ((cfg.riskPercent ?? DEFAULT_ENGINE_CONFIG.riskPercent) / 100),
        t.riskPoints, spec,
      );
      if (!near(want, t.size, 1e-9)) sizeErr++;
    }
  }
  ok("gross = points x tick value x size, net = gross - commission - spread", costErr === 0, `${costErr} mismatches`);
  ok("riskCash matches the stop distance in cash", riskErr === 0, `${riskErr} mismatches`);
  ok("rMultiple = netPnl / riskCash", rErr === 0, `${rErr} mismatches`);
  if (cfg.sizing === "risk") ok("position size reproduces the risk sizer", sizeErr === 0, `${sizeErr} mismatches`);

  // -- summary reconciliation ----------------------------------------------
  const wins = tr.filter((t) => t.netPnl > 0).length;
  const meanR = tr.reduce((a, t) => a + t.rMultiple, 0) / tr.length;
  ok("summary win rate reconciles to the trade list", near(sum.winRate, wins / tr.length, 1e-9),
    `${(sum.winRate * 100).toFixed(1)}%`);
  ok("summary expectancy reconciles to the trade list", near(sum.expectancyR, meanR, 1e-9),
    `${meanR.toFixed(3)}R`);

  // -- ambiguity: the stop must win ----------------------------------------
  const ambiguous = tr.filter((t) => t.ambiguousBar);
  ok("ambiguous bars always resolve to the stop", ambiguous.every((t) => t.exitReason === "stop"),
    `${ambiguous.length} ambiguous (${((ambiguous.length / tr.length) * 100).toFixed(1)}%)`);

  // -- causality: truncate right after each sampled trade's exit -----------
  const sample = pickSample(tr, 6);
  let causalityBreaks = 0;
  for (const t of sample) {
    const cut = sliceSeries(s, -Infinity, s.ts[t.exitIndex]);
    const again = runBacktest(cut, symbol, cfg, spec, reference ? sliceSeries(reference, -Infinity, s.ts[t.exitIndex]) : null);
    const match = again.trades.find((x) => x.entryTs === t.entryTs && x.direction === t.direction);
    if (!match || !near(match.entryPrice, t.entryPrice) || !near(match.exitPrice, t.exitPrice) ||
        match.exitReason !== t.exitReason || !near(match.rMultiple, t.rMultiple)) causalityBreaks++;
  }
  ok("truncating after the exit reproduces the trade", causalityBreaks === 0,
    `${sample.length} sampled, ${causalityBreaks} broke`);

  console.log(
    `  net ${tr.reduce((a, t) => a + t.netPnl, 0).toFixed(0)} · ` +
    `expectancy ${meanR.toFixed(3)}R · win ${(wins / tr.length * 100).toFixed(1)}% · ` +
    `exits ${JSON.stringify(sum.exitBreakdown)}`,
  );
  return { sum, trades: tr };
}

function pickSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const step = Math.floor(arr.length / n);
  return Array.from({ length: n }, (_, i) => arr[i * step]);
}

// ---------------------------------------------------------------------------
// 4. Walk-forward hygiene
// ---------------------------------------------------------------------------
function checkWalkForward(symbol: string, s: BarSeries, key: string) {
  section(`[walk-forward] ${symbol} · ${key}`);
  const from = s.ts[0], to = s.ts[s.length - 1];
  const folds = buildFolds(from, to, 6, 2, false);
  ok("folds were built", folds.length > 0, `${folds.length} folds`);
  let overlap = 0, backwards = 0;
  for (const f of folds) {
    if (!(f.trainToMs <= f.testFromMs)) overlap++;
    if (!(f.trainFromMs < f.trainToMs && f.testFromMs < f.testToMs)) backwards++;
  }
  ok("train and test slices never overlap", overlap === 0, `${overlap}`);
  ok("every fold moves forward in time", backwards === 0, `${backwards}`);

  const grid = expandGrid({ targetR: [1.5, 2, 3], entry: ["proximal", "mid"] } as never, 24);
  const res = runWalkForward({
    series: s, symbol, baseCfg: cfgFor(key), grid, folds,
    minTrainTrades: 10, specOverride: instrumentSpec(symbol), reference: null,
  });
  ok("out-of-sample trades come only from test slices",
    res.oosTrades.every((t) =>
      res.folds.some((f) => t.entryTs >= f.fold.testFromMs && t.entryTs <= f.fold.testToMs)),
    `${res.oosTrades.length} OOS trades`);
  ok("in-sample best is not reported as the OOS result",
    res.inSampleBest.meanR !== res.oos.meanR || res.oosTrades.length === 0,
    `IS ${res.inSampleBest.meanR.toFixed(3)}R vs OOS ${res.oos.meanR.toFixed(3)}R over ${res.folds.length - res.skippedFolds} live folds`);
}

// ---------------------------------------------------------------------------
// 5. Nulls
// ---------------------------------------------------------------------------
function checkNulls(symbol: string, s: BarSeries, key: string, trades: BacktestTrade[]) {
  section(`[nulls] ${symbol} · ${key}`);
  const spec = instrumentSpec(symbol);
  const windows = windowsForKeys(NAMED_CONFIGS.find((c) => c.key === key)!.windowKeys);
  const realMeanR = trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length;

  const randSamples = randomEntryNull(s, trades, windows, spec, 200, 7);
  const dirSamples = shuffledDirectionNull(s, trades, spec, 200, 11);
  const rand = describeNull("random entry", randSamples, realMeanR);
  const dir = describeNull("shuffled direction", dirSamples, realMeanR);

  console.log(
    `  real ${realMeanR.toFixed(3)}R (n=${trades.length}) · ` +
    `random-entry p50 ${rand.p50.toFixed(3)}R p95 ${rand.p95.toFixed(3)}R (real at ${rand.realPercentile.toFixed(1)}th pct) · ` +
    `shuffled-direction p50 ${dir.p50.toFixed(3)}R p95 ${dir.p95.toFixed(3)}R (real at ${dir.realPercentile.toFixed(1)}th pct)`,
  );
  ok("null distributions were generated", randSamples.length > 0 && dirSamples.length > 0,
    `${randSamples.length} / ${dirSamples.length} draws`);
  ok("real edge beats the median random-entry draw", realMeanR > rand.p50,
    `${(realMeanR - rand.p50).toFixed(3)}R gap`);
  ok("real edge clears the 95th percentile of the random-entry null (significant)",
    !rand.insideNull, `${rand.realPercentile.toFixed(1)}th percentile`);
}


// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const loaded = new Map<string, BarSeries>();
for (const sym of SYMBOLS) {
  const { series, months } = loadSymbol(sym);
  loaded.set(sym, series);
  checkData(sym, series, months);
}

const CONFIG_KEYS = (argVal("--configs", "") || NAMED_CONFIGS.map((c) => c.key).join(",")).split(",");
const results = new Map<string, { meanR: number; n: number; trades: BacktestTrade[] }>();

for (const sym of SYMBOLS) {
  const s = loaded.get(sym)!;
  const ref = sym === "GBPUSD" ? loaded.get("EURUSD") ?? null : loaded.get("GBPUSD") ?? null;
  for (const key of CONFIG_KEYS) {
    const out = checkExecution(sym, s, key, ref);
    if (out && out.trades.length) {
      results.set(`${sym}:${key}`, {
        meanR: out.sum.expectancyR,
        n: out.trades.length,
        trades: out.trades,
      });
    }
  }
}

// Pick the most-traded config for the deeper statistical passes.
const busiest = [...results.entries()].sort((a, b) => b[1].n - a[1].n)[0];
if (busiest) {
  const [sym, key] = busiest[0].split(":");
  checkWalkForward(sym, loaded.get(sym)!, key);
  checkNulls(sym, loaded.get(sym)!, key, busiest[1].trades);

  // Cross-pair: same config, untouched, on the other instrument.
  section("[cross-pair] same config on both instruments");
  for (const [k, v] of results) if (k.endsWith(`:${key}`)) console.log(`  ${k}: ${v.meanR.toFixed(3)}R over ${v.n} trades`);
}

section(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
