// ============================================================================
// Walk-forward report — the honest half of the lab.
//
// Shows the in-sample best next to the concatenated out-of-sample curve so the
// selection gap is impossible to miss, plus a per-fold table: what won on
// train, what it did on test, and the train expectancy after the
// multiple-testing haircut.
// ============================================================================

import type { WalkForwardReport } from "@/workers/ictBacktest.worker";

interface Props {
  report: WalkForwardReport;
}

const r2 = (n: number) => `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(2)}R`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const month = (ms: number) => new Date(ms).toISOString().slice(0, 7);

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${
        tone === "pos" ? "text-primary" : tone === "neg" ? "text-destructive" : ""
      }`}>{value}</p>
    </div>
  );
}

export function WalkForwardReportPanel({ report }: Props) {
  const { oos, inSampleBest } = report;
  const gap = inSampleBest.meanR - oos.meanR;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="OOS trades" value={String(oos.n)} />
        <Stat
          label="OOS expectancy"
          value={r2(oos.meanR)}
          tone={oos.meanR > 0 ? "pos" : "neg"}
        />
        <Stat label="OOS win rate" value={pct(oos.winRate)} />
        <Stat
          label="OOS max drawdown"
          value={r2(-oos.maxDrawdownR)}
          tone={oos.maxDrawdownR > 0 ? "neg" : undefined}
        />
      </div>

      <div className="rounded-lg border border-border/60 p-4 space-y-2">
        <p className="text-xs font-medium">Overfit check</p>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Best in-sample</p>
            <p className="tabular-nums font-medium">{r2(inSampleBest.meanR)} · {inSampleBest.n} trades</p>
          </div>
          <div>
            <p className="text-muted-foreground">Out-of-sample</p>
            <p className="tabular-nums font-medium">{r2(oos.meanR)} · {oos.n} trades</p>
          </div>
          <div>
            <p className="text-muted-foreground">Selection gap</p>
            <p className={`tabular-nums font-medium ${gap > 0.2 ? "text-destructive" : ""}`}>
              {r2(gap)}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {report.candidates} combination{report.candidates === 1 ? "" : "s"} tested per fold,
          minimum {report.minTrainTrades} train trades to qualify
          {report.skippedFolds > 0 && `, ${report.skippedFolds} fold(s) skipped for too few trades`}.
          A large positive gap means the winning rules fit the training noise, not the market.
        </p>
      </div>

      {report.folds.length > 0 && (
        <div className="rounded-lg border border-border/60 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Fold</th>
                <th className="text-left px-3 py-2 font-medium">Train</th>
                <th className="text-left px-3 py-2 font-medium">Test</th>
                <th className="text-right px-3 py-2 font-medium">Train R</th>
                <th className="text-right px-3 py-2 font-medium">Deflated</th>
                <th className="text-right px-3 py-2 font-medium">Test R</th>
                <th className="text-right px-3 py-2 font-medium">Test n</th>
                <th className="text-left px-3 py-2 font-medium">Winner</th>
              </tr>
            </thead>
            <tbody>
              {report.folds.map((f) => (
                <tr key={f.index} className="border-t border-border/40">
                  <td className="px-3 py-1.5">{f.index + 1}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {month(f.trainFromMs)}–{month(f.trainToMs)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {month(f.testFromMs)}–{month(f.testToMs)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r2(f.train.meanR)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {r2(f.trainDeflatedMeanR)}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${
                    f.test.meanR >= 0 ? "text-primary" : "text-destructive"
                  }`}>
                    {r2(f.test.meanR)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{f.test.n}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {Object.entries(f.winnerCfg)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(", ") || "base"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
