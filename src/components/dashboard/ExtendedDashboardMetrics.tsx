// ============================================================================
// Extended dashboard metrics: per-trade edge ratio, recovery factor, max DD, consecutive
// wins/losses; monthly returns heatmap; R-multiple distribution histogram.
// ============================================================================

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { DashboardMetrics } from "@/types/trading";

function fmtMoney(v: number) {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function heatColor(pct: number) {
  if (pct === 0) return "bg-muted/30 text-muted-foreground";
  if (pct > 0) {
    const intensity = Math.min(1, pct / 10);
    return `text-emerald-600 dark:text-emerald-400 bg-emerald-500/[${(0.08 + intensity * 0.25).toFixed(2)}]`;
  }
  const intensity = Math.min(1, Math.abs(pct) / 10);
  return `text-destructive bg-destructive/[${(0.08 + intensity * 0.25).toFixed(2)}]`;
}

interface Props {
  metrics: DashboardMetrics;
  /** Starting balance to compute monthly % returns. */
  startingBalance: number;
}

export function ExtendedDashboardMetrics({ metrics, startingBalance }: Props) {
  // Group monthly P&L by year for the heatmap grid.
  const heatmap = useMemo(() => {
    const byYear: Record<string, Record<number, number>> = {};
    for (const [ym, pnl] of Object.entries(metrics.monthlyPnl)) {
      const [y, m] = ym.split("-");
      if (!y || !m) continue;
      if (!byYear[y]) byYear[y] = {};
      byYear[y][Number(m)] = pnl;
    }
    return byYear;
  }, [metrics.monthlyPnl]);

  // R-multiple distribution: bin into [-3, +5] in 0.5 R steps.
  const distribution = useMemo(() => {
    const bins: Record<string, number> = {};
    const labels: string[] = [];
    for (let edge = -3; edge < 5; edge += 0.5) {
      const lo = edge;
      const hi = edge + 0.5;
      const key = `${lo.toFixed(1)} – ${hi.toFixed(1)}`;
      bins[key] = 0;
      labels.push(key);
    }
    for (const r of metrics.rMultiples) {
      const clamped = Math.max(-3, Math.min(4.99, r));
      const idx = Math.floor((clamped + 3) / 0.5);
      const key = labels[idx];
      if (key) bins[key] = (bins[key] ?? 0) + 1;
    }
    const max = Math.max(1, ...Object.values(bins));
    return { bins, labels, max };
  }, [metrics.rMultiples]);

  const years = Object.keys(heatmap).sort();
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const monthLabels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Extended metric strip */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Risk & consistency</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Edge (R/σ)" value={metrics.perTradeEdgeRatio != null ? metrics.perTradeEdgeRatio.toFixed(2) : "—"} />
          <Stat
            label="Recovery factor"
            value={metrics.recoveryFactor != null && Number.isFinite(metrics.recoveryFactor) ? metrics.recoveryFactor.toFixed(2) : "—"}
          />
          <Stat label="Max DD" value={fmtMoney(metrics.maxDrawdownDollars)} tone={metrics.maxDrawdownDollars < 0 ? "danger" : "neutral"} />
          <Stat label="Max consec. wins" value={metrics.maxConsecutiveWins.toString()} tone="good" />
          <Stat label="Max consec. losses" value={metrics.maxConsecutiveLosses.toString()} tone="danger" />
          <Stat label="Avg R" value={metrics.avgRMultiple.toFixed(2) + "R"} />
        </div>
      </Card>

      {/* Monthly returns heatmap */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Monthly returns</h3>
        {years.length === 0 ? (
          <p className="text-xs text-muted-foreground">No monthly data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs font-mono-numbers">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left pr-2 py-1"></th>
                  {monthLabels.map((m, i) => <th key={i} className="px-1 text-center">{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y}>
                    <td className="pr-2 py-1 text-muted-foreground">{y}</td>
                    {months.map((m) => {
                      const pnl = heatmap[y]?.[m] ?? 0;
                      const pct = startingBalance > 0 ? (pnl / startingBalance) * 100 : 0;
                      return (
                        <td key={m} className={`px-1 py-1 text-center rounded ${pct === 0 ? "text-muted-foreground/40" : pct > 0 ? "text-emerald-500" : "text-destructive"}`}>
                          {pnl === 0 ? "·" : (pct >= 0 ? "+" : "") + pct.toFixed(1)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* R-multiple distribution */}
      <Card className="p-4 space-y-3 lg:col-span-2">
        <h3 className="text-sm font-semibold">R-multiple distribution ({metrics.rMultiples.length} trades)</h3>
        {metrics.rMultiples.length === 0 ? (
          <p className="text-xs text-muted-foreground">No R-multiples logged yet.</p>
        ) : (
          <div className="flex items-end gap-0.5 h-32">
            {distribution.labels.map((label) => {
              const count = distribution.bins[label] ?? 0;
              const heightPct = (count / distribution.max) * 100;
              const lo = parseFloat(label.split(" – ")[0]);
              const positive = lo >= 0;
              return (
                <div key={label} className="flex-1 flex flex-col items-center justify-end h-full" title={`${label} R: ${count} trade${count === 1 ? "" : "s"}`}>
                  <div
                    className={`w-full rounded-t ${positive ? "bg-emerald-500/60" : "bg-destructive/60"}`}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono-numbers">
          <span>−3R</span>
          <span>0R</span>
          <span>+5R</span>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "danger" | "neutral" }) {
  const cls =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "danger" ? "text-destructive" : "text-foreground";
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold font-mono-numbers ${cls}`}>{value}</div>
    </div>
  );
}
