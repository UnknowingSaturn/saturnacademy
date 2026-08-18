// ============================================================================
// Backtest results — KPIs, equity curve, exit / no-trade funnel and the trade
// blotter. Every number comes straight from `summarize()`; nothing is
// re-derived in the UI so the tab can never disagree with the engine.
// ============================================================================

import { useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import type { IctBacktestResponse } from "@/workers/ictBacktest.worker";

interface Props {
  result: IctBacktestResponse;
}

const NO_TRADE_LABELS: Record<string, string> = {
  no_bars_in_window: "No bars in window",
  no_fvg: "No fair value gap",
  bias_conflict: "Against HTF bias",
  no_sweep: "No liquidity sweep",
  no_mss: "No structure shift",
  no_displacement: "No displacement",
  entry_not_filled: "Limit never filled",
  invalid_stop: "Invalid stop",
  max_trades_reached: "Max trades reached",
};

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          tone === "pos" ? "text-primary" : tone === "neg" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function BacktestResults({ result }: Props) {
  const [showAll, setShowAll] = useState(false);
  const s = result.summary;
  const trades = result.trades ?? [];

  const equity = useMemo(
    () =>
      (result.equity ?? []).map((p, i) => ({
        i: i + 1,
        equity: Number(p.equity.toFixed(2)),
        date: new Date(p.ts).toISOString().slice(0, 10),
      })),
    [result.equity],
  );

  const funnel = useMemo(() => {
    const entries = Object.entries(s?.noTradeBreakdown ?? {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  }, [s]);

  if (!s) return null;

  const visible = showAll ? trades : trades.slice(0, 50);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Trades" value={String(s.trades)} />
        <Kpi label="Win rate" value={`${(s.winRate * 100).toFixed(1)}%`} />
        <Kpi
          label="Net P&L"
          value={money(s.netPnl)}
          tone={s.netPnl >= 0 ? "pos" : "neg"}
        />
        <Kpi
          label="Expectancy"
          value={`${s.expectancyR >= 0 ? "+" : ""}${s.expectancyR.toFixed(2)}R`}
          tone={s.expectancyR >= 0 ? "pos" : "neg"}
        />
        <Kpi label="Avg win" value={`${s.avgWinR.toFixed(2)}R`} />
        <Kpi label="Avg loss" value={`${s.avgLossR.toFixed(2)}R`} />
        <Kpi
          label="Profit factor"
          value={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}
        />
        <Kpi label="Max drawdown" value={money(-s.maxDrawdown)} tone="neg" />
      </div>

      <p className="text-xs text-muted-foreground">
        {(result.barsScanned ?? 0).toLocaleString()} bars ·{" "}
        {result.sessionsScanned ?? 0} sessions scanned
        {result.firstTs
          ? ` · ${new Date(result.firstTs).toISOString().slice(0, 10)} → ${new Date(result.lastTs ?? result.firstTs).toISOString().slice(0, 10)}`
          : ""}
        {s.ambiguousBars > 0 &&
          ` · ${s.ambiguousBars} ambiguous bar${s.ambiguousBars === 1 ? "" : "s"} resolved stop-first`}
      </p>

      {equity.length > 1 && (
        <div className="rounded-lg border border-border/60 p-4">
          <h4 className="text-sm font-medium mb-2">Equity curve</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equity}>
                <defs>
                  <linearGradient id="btEq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} width={60} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [money(v), "Equity"]}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="hsl(var(--primary))"
                  fill="url(#btEq)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border/60 p-4">
          <h4 className="text-sm font-medium mb-2">Exits</h4>
          <ul className="space-y-1 text-xs">
            {Object.entries(s.exitBreakdown).map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                <span className="tabular-nums">{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border/60 p-4">
          <h4 className="text-sm font-medium mb-2">Why sessions were skipped</h4>
          {funnel.length === 0 ? (
            <p className="text-xs text-muted-foreground">Every scanned session produced a trade.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {funnel.map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{NO_TRADE_LABELS[k] ?? k}</span>
                  <span className="tabular-nums">{v}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border/60">
        <div className="flex items-center justify-between p-3 border-b border-border/50">
          <h4 className="text-sm font-medium">Trades</h4>
          {trades.length > 50 && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show first 50" : `Show all ${trades.length}`}
            </Button>
          )}
        </div>
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="text-muted-foreground text-left">
                <th className="p-2 font-medium">Date</th>
                <th className="p-2 font-medium">Session</th>
                <th className="p-2 font-medium">Dir</th>
                <th className="p-2 font-medium text-right">Entry</th>
                <th className="p-2 font-medium text-right">Stop</th>
                <th className="p-2 font-medium text-right">Exit</th>
                <th className="p-2 font-medium">Reason</th>
                <th className="p-2 font-medium text-right">Bars</th>
                <th className="p-2 font-medium text-right">MAE</th>
                <th className="p-2 font-medium text-right">R</th>
                <th className="p-2 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t, i) => (
                <tr key={`${t.entryTs}-${i}`} className="border-t border-border/40">
                  <td className="p-2 whitespace-nowrap">{t.sessionDate}</td>
                  <td className="p-2 whitespace-nowrap text-muted-foreground">{t.journalSession}</td>
                  <td className="p-2">{t.direction === "long" ? "L" : "S"}</td>
                  <td className="p-2 text-right tabular-nums">{t.entryPrice}</td>
                  <td className="p-2 text-right tabular-nums">{t.stopPrice}</td>
                  <td className="p-2 text-right tabular-nums">{t.exitPrice}</td>
                  <td className="p-2 whitespace-nowrap text-muted-foreground">
                    {t.exitReason.replace(/_/g, " ")}
                    {t.ambiguousBar ? " *" : ""}
                  </td>
                  <td className="p-2 text-right tabular-nums">{t.barsHeld}</td>
                  <td className="p-2 text-right tabular-nums">{t.maePoints.toFixed(2)}</td>
                  <td
                    className={`p-2 text-right tabular-nums ${
                      t.rMultiple >= 0 ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {t.rMultiple.toFixed(2)}
                  </td>
                  <td
                    className={`p-2 text-right tabular-nums ${
                      t.netPnl >= 0 ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {money(t.netPnl)}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-4 text-center text-muted-foreground">
                    No trades under these rules — check the skip funnel above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {result.truncated && (
          <p className="p-2 text-[11px] text-muted-foreground border-t border-border/40">
            Trade list truncated for display; KPIs cover every trade.
          </p>
        )}
      </div>
    </div>
  );
}
