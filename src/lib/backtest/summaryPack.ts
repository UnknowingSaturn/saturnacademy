// ============================================================================
// Summary pack — the artefacts a sweep has to leave behind.
//
// Every file is small enough to paste into a chat, which is the whole point:
// the numbers should be arguable, not buried in a UI. The zip is built here
// with a minimal STORED-entry writer so no dependency is needed for what is
// ultimately a handful of text files.
// ============================================================================

import type { BacktestTrade } from "../../../shared/quant/ict/engine";
import type {
  ConfigRow, DsrResult, EraRow, FdrResult, SizingDecision, SlippageCell, YearRow,
  DiscretionPremium,
} from "../../../shared/quant/ict/sweep";
import type { NullDistribution } from "../../../shared/quant/ict/nulls";
import type { HourStat } from "@/workers/ictSweep.worker";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface RefConfigResult {
  key: string;
  label: string;
  hash: string;
  symbol: string;
  row: ConfigRow;
  trades: BacktestTrade[];
}

export interface NullReport {
  configKey: string;
  label: string;
  symbol: string;
  randomEntry: NullDistribution;
  shuffledDirection: NullDistribution | null;
  otherHours: NullDistribution;
  hours: HourStat[];
}

export interface AblationRow {
  rung: number;
  label: string;
  symbol: string;
  trades: number;
  winRate: number;
  avgR: number;
  netSharpe: number;
  maxDrawdownR: number;
  lookahead: boolean;
}

export interface SweepReport {
  createdAt: string;
  discoverySymbol: string;
  validationSymbol: string | null;
  fromMonth: string;
  toMonth: string;
  sizing: SizingDecision;
  sample: { gridSize: number; rawCount: number; canonicalCount: number; n: number; exhaustive: boolean };
  rows: ConfigRow[];
  fdr: FdrResult;
  survivors: ConfigRow[];
  validationRows: ConfigRow[];
  refs: RefConfigResult[];
  nulls: NullReport[];
  ablation: AblationRow[];
  discretion: Array<{ key: string; label: string; symbol: string; premium: DiscretionPremium }>;
  dsr: (DsrResult & { configKey: string }) | null;
  perYear: Array<{ key: string; symbol: string; rows: YearRow[] }>;
  era: Array<{ key: string; symbol: string; rows: EraRow[] }>;
  rollDay: Array<{ key: string; symbol: string; withRoll: number; withoutRoll: number; rollTrades: number }>;
  slippage: Array<{ key: string; symbol: string; cells: SlippageCell[] }>;
  funnel: Record<string, number>;
  timing: { benchmarkMedianSec: number; workers: number; sweepSeconds: number; totalSeconds: number };
}

// ---------------------------------------------------------------------------
// CSV / markdown writers
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (!rows.length) return "";
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "n/a");

function configRowRecord(r: ConfigRow): Record<string, unknown> {
  return {
    config_hash: r.hash,
    named_key: r.namedKey ?? "",
    windows: r.windowKeys.join("+"),
    trades: r.trades,
    trades_per_year: r.tradesPerYear.toFixed(1),
    day_coverage_pct: r.dayCoveragePct.toFixed(1),
    win_rate: r.winRate.toFixed(4),
    avg_r: r.avgR.toFixed(4),
    total_r: r.totalR.toFixed(2),
    gross_pnl: r.grossPnl.toFixed(2),
    net_pnl: r.netPnl.toFixed(2),
    gross_sharpe: r.grossSharpe.toFixed(3),
    net_sharpe: r.netSharpe.toFixed(3),
    max_dd_r: r.maxDrawdownR.toFixed(2),
    max_dd_cash: r.maxDrawdownCash.toFixed(2),
    profit_factor: Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(3) : "inf",
    ambiguous_pct: r.ambiguousPct.toFixed(2),
    roll_day_pct: r.rollDayPct.toFixed(2),
    first_trade: r.firstTradeDate ?? "",
    last_trade: r.lastTradeDate ?? "",
    ...Object.fromEntries(Object.entries(r.canonical).map(([k, v]) => [`p_${k}`, v as unknown])),
  };
}

export interface PackFile { name: string; content: string; mime: string }

export function buildSummaryPack(rep: SweepReport): PackFile[] {
  const files: PackFile[] = [];
  const csv = (name: string, content: string) => files.push({ name, content, mime: "text/csv" });
  const md = (name: string, content: string) => files.push({ name, content, mime: "text/markdown" });

  csv("results_configs.csv", toCsv(rep.rows.map(configRowRecord)));

  files.push({
    name: "funnel_counts.json",
    mime: "application/json",
    content: JSON.stringify(
      {
        grid_size: rep.sample.gridSize,
        raw_configs: rep.sample.rawCount,
        canonical_configs: rep.sample.canonicalCount,
        sampled: rep.sample.n,
        exhaustive_enumeration: rep.sample.exhaustive,
        ...rep.funnel,
        fdr_q: rep.fdr.q,
        fdr_tested: rep.fdr.tested,
        fdr_survivors: rep.fdr.survivors.length,
      },
      null,
      2,
    ),
  });

  // Named configs report — both symbols, win rate next to the claimed band.
  const namedLines: string[] = [
    `# Named configs — ${rep.discoverySymbol}${rep.validationSymbol ? ` (discovery) / ${rep.validationSymbol} (validation)` : ""}`,
    "",
    `Range ${rep.fromMonth} → ${rep.toMonth}. Holdout untouched.`,
    "",
    "| Config | Symbol | Trades | Win rate | Claimed 70-80% band | Avg R | Net Sharpe | Net PnL | Max DD (R) |",
    "|---|---|---:|---:|---|---:|---:|---:|---:|",
  ];
  const namedRows = [...rep.rows, ...rep.validationRows].filter((r) => r.namedKey);
  for (const r of namedRows) {
    const inBand = r.winRate >= 0.7 && r.winRate <= 0.8;
    namedLines.push(
      `| ${r.namedKey} | ${rep.validationRows.includes(r) ? rep.validationSymbol : rep.discoverySymbol} | ${r.trades} | ${pct(r.winRate)} | ${inBand ? "inside" : "OUTSIDE"} | ${n2(r.avgR)} | ${n2(r.netSharpe)} | ${n2(r.netPnl)} | ${n2(r.maxDrawdownR)} |`,
    );
  }
  md("named_configs_report.md", namedLines.join("\n") + "\n");

  if (rep.validationRows.length) {
    csv("validation.csv", toCsv(rep.validationRows.map(configRowRecord)));
  }

  csv(
    "ablation_ladder.csv",
    toCsv(
      rep.ablation.map((a) => ({
        rung: a.rung,
        label: a.label,
        symbol: a.symbol,
        lookahead: a.lookahead ? "YES" : "",
        trades: a.trades,
        win_rate: a.winRate.toFixed(4),
        avg_r: a.avgR.toFixed(4),
        net_sharpe: a.netSharpe.toFixed(3),
        max_dd_r: a.maxDrawdownR.toFixed(2),
      })),
    ),
  );

  const nullLines: string[] = ["# Reference nulls", ""];
  for (const nrep of rep.nulls) {
    nullLines.push(`## ${nrep.label} — ${nrep.symbol}`, "");
    const block = (d: NullDistribution | null, name: string) => {
      if (!d) return;
      nullLines.push(
        `- **${name}** (${d.iterations} iterations): real avg R ${n2(d.real)} sits at the **${d.realPercentile.toFixed(1)}th percentile** of the null (null mean ${n2(d.mean)}, 5/50/95 = ${n2(d.p05)} / ${n2(d.p50)} / ${n2(d.p95)}). ${d.insideNull ? "**The real result sits inside this null distribution.**" : "Outside the null at the 95th percentile."}`,
      );
    };
    block(nrep.randomEntry, "Random entry, same windows");
    block(nrep.otherHours, "Other hours, same logic");
    block(nrep.shuffledDirection, "Shuffled direction");
    nullLines.push("");
  }
  md("null_summary.md", nullLines.join("\n") + "\n");

  const dLines: string[] = ["DISCRETION PREMIUM", ""];
  for (const d of rep.discretion) {
    const p = d.premium;
    dLines.push(
      `${d.label} (${d.symbol})`,
      `  Taking every setup:              ${p.allSetups.trades} trades, avg R ${n2(p.allSetups.avgR)}, net ${n2(p.allSetups.netPnl)}, Sharpe ${n2(p.allSetups.netSharpe)}`,
      `  Hindsight-perfect loser skipping: ${p.perfectSkip.trades} trades, avg R ${n2(p.perfectSkip.avgR)}, net ${n2(p.perfectSkip.netPnl)}, Sharpe ${n2(p.perfectSkip.netSharpe)}`,
      `  Losers you must skip IN ADVANCE to break even net: ${p.skipForBreakeven === null ? "not reachable" : pct(p.skipForBreakeven)}`,
      `  Losers you must skip IN ADVANCE to reach 1.0 net Sharpe: ${p.skipForSharpe1 === null ? "not reachable" : pct(p.skipForSharpe1)}`,
      "",
    );
  }
  files.push({ name: "discretion_premium.txt", content: dLines.join("\n") + "\n", mime: "text/plain" });

  csv(
    "era_split.csv",
    toCsv(
      rep.era.flatMap((e) =>
        e.rows.map((r) => ({
          config: e.key, symbol: e.symbol, era: r.era, trades: r.trades,
          avg_r: r.avgR.toFixed(4), win_rate: r.winRate.toFixed(4), net_sharpe: r.netSharpe.toFixed(3),
        })),
      ),
    ),
  );

  csv(
    "frequency_report.csv",
    toCsv([
      ...percentileRows(rep.rows),
      ...rep.rows.filter((r) => r.namedKey).map((r) => ({
        scope: `named:${r.namedKey}`,
        trades_per_year: r.tradesPerYear.toFixed(1),
        day_coverage_pct: r.dayCoveragePct.toFixed(1),
      })),
    ]),
  );

  csv(
    "per_year.csv",
    toCsv(
      rep.perYear.flatMap((p) =>
        p.rows.map((r) => ({
          config: p.key, symbol: p.symbol, year: r.year, trades: r.trades,
          avg_r: r.avgR.toFixed(4), total_r: r.totalR.toFixed(2), win_rate: r.winRate.toFixed(4),
        })),
      ),
    ),
  );

  csv(
    "slippage_sensitivity.csv",
    toCsv(
      rep.slippage.flatMap((s) =>
        s.cells.map((c) => ({
          config: s.key, symbol: s.symbol, stop_slippage_ticks: c.stopTicks,
          time_exit_slippage_ticks: c.timeTicks, avg_r: c.avgR.toFixed(4),
          net_pnl: c.netPnl.toFixed(2), net_sharpe: c.netSharpe.toFixed(3),
        })),
      ),
    ),
  );

  csv(
    "roll_day_sensitivity.csv",
    toCsv(
      rep.rollDay.map((r) => ({
        config: r.key, symbol: r.symbol, roll_day_trades: r.rollTrades,
        avg_r_with_roll_days: r.withRoll.toFixed(4), avg_r_without_roll_days: r.withoutRoll.toFixed(4),
      })),
    ),
  );

  const stats: string[] = ["STATISTICS", ""];
  if (rep.dsr) {
    stats.push(
      `Deflated Sharpe Ratio — ${rep.dsr.configKey}`,
      `  observed per-trade Sharpe : ${rep.dsr.observedSharpe.toFixed(4)}`,
      `  expected max of N noise   : ${rep.dsr.expectedMaxSharpe.toFixed(4)} (N = ${rep.dsr.trials} canonical configs)`,
      `  trade skew / kurtosis     : ${rep.dsr.skew.toFixed(3)} / ${rep.dsr.kurtosis.toFixed(3)} over ${rep.dsr.n} trades`,
      `  DSR (prob. the edge is real): ${(rep.dsr.dsr * 100).toFixed(1)}%`,
      "",
    );
  }
  stats.push(
    `Benjamini-Hochberg FDR at q=${rep.fdr.q}: ${rep.fdr.survivors.length} survivors of ${rep.fdr.tested} tested (p threshold ${rep.fdr.threshold.toExponential(2)}).`,
  );
  files.push({ name: "statistics.txt", content: stats.join("\n") + "\n", mime: "text/plain" });

  files.push({
    name: "timing_report.txt",
    mime: "text/plain",
    content: [
      `Workers                 : ${rep.timing.workers}`,
      `Benchmark median sec/cfg: ${rep.timing.benchmarkMedianSec.toFixed(3)}`,
      `Configs run             : ${rep.sample.n}`,
      `Sweep wall clock (s)    : ${rep.timing.sweepSeconds.toFixed(1)}`,
      `Total wall clock (s)    : ${rep.timing.totalSeconds.toFixed(1)}`,
      `Projected at sizing (min): ${rep.sizing.projectedMinutes.toFixed(1)}`,
      "",
    ].join("\n"),
  });

  return files;
}

function percentileRows(rows: ConfigRow[]): Array<Record<string, unknown>> {
  if (!rows.length) return [];
  const tpy = [...rows.map((r) => r.tradesPerYear)].sort((a, b) => a - b);
  const cov = [...rows.map((r) => r.dayCoveragePct)].sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.round(p * (arr.length - 1)))];
  return [0.05, 0.25, 0.5, 0.75, 0.95].map((p) => ({
    scope: `population_p${Math.round(p * 100)}`,
    trades_per_year: q(tpy, p).toFixed(1),
    day_coverage_pct: q(cov, p).toFixed(1),
  }));
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (STORED entries, no compression)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipFiles(files: PackFile[], folder = "analysis/summary/"): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(folder + f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  // Flatten into one buffer: TS's BlobPart type rejects Uint8Array views whose
  // backing buffer could be shared, and a single copy is cheap for text files.
  const parts = [...chunks, ...central, end];
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return new Blob([out], { type: "application/zip" });
}
