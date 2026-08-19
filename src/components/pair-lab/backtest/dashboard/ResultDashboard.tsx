// ============================================================================
// ResultDashboard — the whole study on one 1080p board.
//
// Reads only what the sweep already computed; it never recomputes statistics,
// so what you see here is exactly what the summary pack contains.
// ============================================================================

import { useMemo } from "react";
import type { SweepReport } from "@/lib/backtest/summaryPack";
import type { BacktestTrade } from "../../../../../shared/quant/ict/engine";
import {
  Board1080, Panel, Empty, Histogram, BarRows, Scatter, Heatmap, EquityCurves, KeyValue,
} from "./Panel1080";

const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "n/a");
const pctS = (v: number) => `${(v * 100).toFixed(1)}%`;

function equity(trades: BacktestTrade[]): number[] {
  let acc = 0;
  return [0, ...trades.map((t) => (acc += t.rMultiple))];
}

export function ResultDashboard({ report }: { report: SweepReport }) {
  const ref = report.refs.find((r) => r.key === "best_survivor") ?? report.refs[0] ?? null;
  const nul = report.nulls.find((n) => n.configKey === ref?.key) ?? report.nulls[0] ?? null;

  const funnelRows = useMemo(
    () =>
      Object.entries(report.funnel).map(([k, v]) => ({
        label: k.replace(/_/g, " "),
        value: v,
        note: v.toLocaleString(),
      })),
    [report.funnel],
  );

  const sharpes = useMemo(() => report.rows.filter((r) => r.trades >= 30).map((r) => r.netSharpe), [report.rows]);
  const freq = useMemo(() => report.rows.map((r) => r.tradesPerYear), [report.rows]);

  const scatter = useMemo(() => {
    const byHash = new Map(report.validationRows.map((r) => [r.hash, r]));
    return report.survivors
      .map((r) => {
        const v = byHash.get(r.hash);
        return v ? { x: r.netSharpe, y: v.netSharpe, highlight: Boolean(r.namedKey) } : null;
      })
      .filter((p): p is { x: number; y: number; highlight: boolean } => Boolean(p));
  }, [report.survivors, report.validationRows]);

  const heatRows = useMemo(() => {
    const years = [...new Set(report.survivorYears.flatMap((s) => s.rows.map((r) => r.year)))].sort();
    return {
      years,
      rows: report.survivorYears.slice(0, 12).map((s) => ({
        label: s.label,
        values: years.map((y) => {
          const hit = s.rows.find((r) => r.year === y);
          return hit ? hit.avgR : null;
        }),
      })),
    };
  }, [report.survivorYears]);

  const namedRows = useMemo(
    () =>
      report.rows
        .filter((r) => r.namedKey)
        .map((r) => ({
          label: r.namedKey!,
          value: r.winRate,
          note: `${pctS(r.winRate)} · ${r.trades} tr`,
        })),
    [report.rows],
  );

  const equitySeries = useMemo(() => {
    const picks = report.refs.slice(0, 3);
    return picks.map((r, i) => ({
      label: r.label,
      points: equity(r.trades),
      color: i === 0 ? undefined : "hsl(var(--muted-foreground))",
    }));
  }, [report.refs]);

  // Null band for the equity panel: the random-entry mean-R distribution scaled
  // out over the same number of trades, at its 5th and 95th percentile.
  const band = useMemo(() => {
    if (!nul || !ref) return undefined;
    const n = ref.trades.length;
    if (!n) return undefined;
    const lo: number[] = [];
    const hi: number[] = [];
    for (let i = 0; i <= n; i++) {
      lo.push(nul.randomEntry.p05 * i);
      hi.push(nul.randomEntry.p95 * i);
    }
    return { lo, hi };
  }, [nul, ref]);

  const ablationRows = report.ablation.map((a) => ({
    label: `${a.rung}. ${a.label}${a.lookahead ? " (peek)" : ""}`,
    value: a.avgR,
    note: `${n2(a.avgR)}R · ${a.trades} tr`,
  }));

  const eraRows = report.era.flatMap((e) =>
    e.rows.map((r) => ({ label: `${e.key} — ${r.era}`, value: r.avgR, note: `${n2(r.avgR)}R · ${r.trades} tr` })),
  );

  const slipRows = (report.slippage[0]?.cells ?? []).map((c) => ({
    label: `+${c.extraTicks} tick slip`,
    value: c.avgR,
    note: `${n2(c.avgR)}R`,
  }));

  const discretionItems = report.discretion.map((d) => ({
    label: d.label,
    value: `${pctS(d.premium.skipFractionForBreakeven)} skip`,
    hint: "Fraction of losers that must be avoided to break even",
  }));

  const ambiguous = report.rows.length
    ? report.rows.reduce((a, r) => a + r.ambiguousPct, 0) / report.rows.length
    : 0;

  return (
    <Board1080>
      <div className="h-full w-full p-4 flex flex-col gap-3">
        <header className="flex items-baseline justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {report.discoverySymbol} discovery
              {report.validationSymbol ? ` → ${report.validationSymbol} validation` : ""}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {report.fromMonth} → {report.toMonth} · {report.sample.n.toLocaleString()} of{" "}
              {report.sample.gridSize.toLocaleString()} canonical configs · seedless holdout untouched
            </p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <p>{report.survivors.length} survived FDR q={report.fdr.q}</p>
            <p>{Math.round(report.timing.totalSeconds / 60)} min on {report.timing.workers} workers</p>
          </div>
        </header>

        <div className="grid grid-cols-4 grid-rows-3 gap-3 flex-1 min-h-0">
          <Panel title="Funnel" subtitle="configs surviving each stage">
            <BarRows rows={funnelRows} width={440} rowHeight={20} />
          </Panel>

          <Panel title="Net Sharpe distribution" subtitle="population vs random-entry null">
            <Histogram
              values={sharpes}
              nullValues={nul?.randomEntrySharpe?.samples}
              markers={ref ? [{ x: ref.row.netSharpe, label: "best survivor" }] : []}
              width={440}
              height={215}
              xLabel="net Sharpe / trade"
            />
          </Panel>

          <Panel title="Trade frequency spectrum" subtitle="trades per year">
            <Histogram values={freq} width={440} height={215} bins={30} xLabel="trades / yr" />
          </Panel>

          <Panel title="Ablation ladder" subtitle="avg R as requirements stack">
            <BarRows rows={ablationRows} width={440} rowHeight={20} baseline={0} />
          </Panel>

          <Panel title="Real vs nulls" subtitle={nul ? nul.label : "no reference config"}>
            {nul ? (
              <BarRows
                width={440}
                rowHeight={22}
                rows={[
                  { label: "Real avg R", value: nul.randomEntry.real },
                  { label: "Random entry p50", value: nul.randomEntry.p50 },
                  { label: "Random entry p95", value: nul.randomEntry.p95 },
                  { label: "Other hours p50", value: nul.otherHours.p50 },
                  { label: "Other hours p95", value: nul.otherHours.p95 },
                  ...(nul.shuffledDirection
                    ? [{ label: "Shuffled direction p95", value: nul.shuffledDirection.p95 }]
                    : []),
                ]}
                baseline={0}
              />
            ) : (
              <Empty />
            )}
          </Panel>

          <Panel
            title={`${report.discoverySymbol} vs ${report.validationSymbol ?? "second symbol"}`}
            subtitle="net Sharpe, survivors only"
          >
            <Scatter points={scatter} width={440} height={215} xLabel="discovery" yLabel="validation" />
          </Panel>

          <Panel title="Per-year stability" subtitle="avg R by survivor">
            <Heatmap rows={heatRows.rows} columns={heatRows.years} width={440} rowHeight={17} />
          </Panel>

          <Panel title="Era split" subtitle="pre / post regime break">
            <BarRows rows={eraRows.slice(0, 9)} width={440} rowHeight={20} baseline={0} />
          </Panel>

          <Panel title="Named configs" subtitle="win rate vs the taught 70-80% claim">
            {namedRows.length ? (
              <BarRows rows={namedRows} width={440} rowHeight={22} baseline={0.7} format={pctS} />
            ) : (
              <Empty label="No named config reached the minimum trade count" />
            )}
          </Panel>

          <Panel title="Cost sensitivity" subtitle="extra slippage on every fill">
            <BarRows rows={slipRows} width={440} rowHeight={22} baseline={0} />
          </Panel>

          <Panel title="Discretion premium & data quality">
            <div className="space-y-3">
              <KeyValue items={discretionItems} />
              <KeyValue
                items={[
                  { label: "Ambiguous bars", value: `${ambiguous.toFixed(2)}%`, hint: "Bars where stop and target both sit inside the range" },
                  { label: "Roll-day trades", value: `${(report.rollDay[0]?.rollTrades ?? 0).toLocaleString()}` },
                  { label: "DSR", value: report.dsr ? report.dsr.dsr.toFixed(3) : "n/a" },
                  { label: "Trials deflated", value: report.dsr ? report.dsr.trials.toLocaleString() : "n/a" },
                ]}
              />
            </div>
          </Panel>

          <Panel title="Equity curves" subtitle="reference configs, random-entry 5-95% band">
            <EquityCurves series={equitySeries} band={band} width={440} height={215} />
          </Panel>
        </div>
      </div>
    </Board1080>
  );
}
