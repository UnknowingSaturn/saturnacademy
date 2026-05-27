import * as React from "react";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Trade } from "@/types/trading";
import { format } from "date-fns";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { BalanceSnapshot } from "@/hooks/useBalanceHistory";

interface AccountSlim {
  id: string;
  name: string;
  starting_balance: number;
  current_balance: number;
}

type BaselineSource = "snapshot" | "balance_start" | "current_equity" | "first_in_period" | "none";


interface EquityCurveProps {
  trades: Trade[];
  startingBalance?: number;
  previousPeriodPnl?: number;
  periodLabel?: string;
  /** When provided AND more than one account, switches to % return mode. */
  multiAccount?: {
    accounts: AccountSlim[];
    snapshots: BalanceSnapshot[];
    baselines: Record<string, BalanceSnapshot | null>;
  };
}

export const EquityCurve = React.forwardRef<HTMLDivElement, EquityCurveProps>(
  function EquityCurve(
    { trades, startingBalance = 10000, previousPeriodPnl = 0, periodLabel = "period", multiAccount },
    _ref,
  ) {
    const isMulti = !!multiAccount && multiAccount.accounts.length > 1;

    // ---------------- Multi-account % return curve ----------------
    const multiData = useMemo(() => {
      if (!isMulti || !multiAccount) return null;
      const { accounts, snapshots, baselines } = multiAccount;

      // Baseline balance per account (snapshot before period, else starting_balance)
      const base: Record<string, number> = {};
      accounts.forEach((a) => {
        base[a.id] = baselines[a.id]?.balance ?? a.starting_balance ?? 0;
      });

      // Walk snapshots in time order, maintain latest known balance per account
      const latest: Record<string, number> = { ...base };
      const points: { date: string; pct: number; ts: number }[] = [];

      // Period-start anchor
      points.push({ date: "Start", pct: 0, ts: 0 });

      const sorted = [...snapshots].sort(
        (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
      );

      sorted.forEach((s) => {
        latest[s.account_id] = s.balance;
        const pcts = accounts.map((a) => {
          const b0 = base[a.id];
          if (!b0) return 0;
          return ((latest[a.id] - b0) / b0) * 100;
        });
        const avg = pcts.reduce((sum, p) => sum + p, 0) / pcts.length;
        points.push({
          date: format(new Date(s.recorded_at), "MMM d HH:mm"),
          pct: Math.round(avg * 100) / 100,
          ts: new Date(s.recorded_at).getTime(),
        });
      });

      // Per-account $ delta vs baseline (latest known balance)
      const perAccount = accounts.map((a) => ({
        id: a.id,
        name: a.name,
        delta: (latest[a.id] ?? base[a.id]) - base[a.id],
        pct: base[a.id] ? (((latest[a.id] ?? base[a.id]) - base[a.id]) / base[a.id]) * 100 : 0,
      }));

      return { points, perAccount };
    }, [isMulti, multiAccount]);

    // ---------------- Single-account / fallback curve ----------------
    const data = useMemo(() => {
      const closedTrades = trades
        .filter((t) => !t.is_open && t.exit_time)
        .sort((a, b) => new Date(a.exit_time!).getTime() - new Date(b.exit_time!).getTime());

      let balance = startingBalance;
      const points = [{ date: "Start", balance, pnl: 0 }];

      closedTrades.forEach((trade) => {
        balance += trade.net_pnl || 0;
        points.push({
          date: format(new Date(trade.exit_time!), "MMM d"),
          balance: Math.round(balance * 100) / 100,
          pnl: trade.net_pnl || 0,
        });
      });

      return points;
    }, [trades, startingBalance]);

    // Headline number stays in $ regardless of mode (sum of P&L from trades)
    const periodPnl = isMulti
      ? trades.filter((t) => !t.is_open).reduce((s, t) => s + (t.net_pnl || 0), 0)
      : data.length > 1
      ? data[data.length - 1].balance - startingBalance
      : 0;

    const isProfit = periodPnl >= 0;
    const periodPnlPercent =
      isMulti && multiData
        ? (multiData.points[multiData.points.length - 1]?.pct ?? 0).toFixed(2)
        : startingBalance > 0
        ? ((periodPnl / startingBalance) * 100).toFixed(2)
        : "0.00";

    const prevIsProfit = previousPeriodPnl >= 0;
    const delta = periodPnl - previousPeriodPnl;
    const deltaPercent =
      previousPeriodPnl !== 0
        ? ((delta / Math.abs(previousPeriodPnl)) * 100).toFixed(0)
        : periodPnl !== 0
        ? "100"
        : "0";

    const isBetter = delta > 0;
    const isWorse = delta < 0;
    const isSame = delta === 0;

    // Chart data + formatters depending on mode
    const chartData = isMulti && multiData
      ? multiData.points.map((p) => ({ date: p.date, value: p.pct }))
      : data.map((p) => ({ date: p.date, value: p.balance }));

    const yFormatter = isMulti
      ? (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
      : (v: number) => `$${(v / 1000).toFixed(0)}k`;

    const tooltipFormatter = isMulti
      ? (value: number) => [
          <span
            key="v"
            style={{
              color: isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)",
              fontFamily: "JetBrains Mono",
              fontWeight: 600,
            }}
          >
            {value >= 0 ? "+" : ""}
            {value.toFixed(2)}%
          </span>,
          "Avg return",
        ]
      : (value: number) => [
          <span
            key="v"
            style={{
              color: isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)",
              fontFamily: "JetBrains Mono",
              fontWeight: 600,
            }}
          >
            ${value.toLocaleString()}
          </span>,
          "Balance",
        ];

    return (
      <div
        className="col-span-2 rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
        style={{
          boxShadow:
            "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)",
        }}
      >
        <div className="p-6 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {periodLabel === "week" ? "Weekly" : "Monthly"} Performance
              </h3>
              <p className="text-sm text-muted-foreground">
                {isMulti
                  ? `Average % return across ${multiAccount!.accounts.length} accounts`
                  : "Period balance change"}
              </p>
            </div>
            <div className="text-right space-y-1">
              <div>
                <p
                  className={`text-2xl font-bold font-mono ${
                    isProfit ? "text-profit" : "text-loss"
                  }`}
                  style={{
                    textShadow: isProfit
                      ? "0 0 20px hsl(var(--profit) / 0.4)"
                      : "0 0 20px hsl(var(--loss) / 0.4)",
                  }}
                >
                  {periodPnl >= 0 ? "+" : ""}$
                  {periodPnl.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
                <p
                  className={`text-sm font-medium ${
                    isProfit ? "text-profit" : "text-loss"
                  }`}
                >
                  {Number(periodPnlPercent) >= 0 ? "+" : ""}
                  {periodPnlPercent}% {isMulti ? "avg" : `this ${periodLabel}`}
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
                <span className="text-xs text-muted-foreground">
                  Last {periodLabel}:{" "}
                  <span className={prevIsProfit ? "text-profit/80" : "text-loss/80"}>
                    {previousPeriodPnl >= 0 ? "+" : ""}$
                    {previousPeriodPnl.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
                {!isSame && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${
                      isBetter ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"
                    }`}
                  >
                    {isBetter ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {isBetter ? "+" : ""}
                    {deltaPercent}%
                  </span>
                )}
                {isSame && (
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    <Minus className="w-3 h-3" />
                    Same
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Per-account contribution chips (multi-account only) */}
          {isMulti && multiData && multiData.perAccount.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/50">
              {multiData.perAccount.map((a) => {
                const positive = a.delta >= 0;
                return (
                  <span
                    key={a.id}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border ${
                      positive
                        ? "border-profit/30 bg-profit/10 text-profit"
                        : "border-loss/30 bg-loss/10 text-loss"
                    }`}
                    title={a.name}
                  >
                    <span className="text-muted-foreground/80 max-w-[140px] truncate">
                      {a.name}
                    </span>
                    <span className="font-mono">
                      {positive ? "+" : ""}
                      {a.pct.toFixed(1)}%
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-2 pb-4">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)"}
                      stopOpacity={0.4}
                    />
                    <stop
                      offset="100%"
                      stopColor={isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)"}
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(0, 0%, 55%)", fontSize: 11 }}
                  tickFormatter={yFormatter}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(0, 0%, 6%)",
                    border: "1px solid hsl(0, 0%, 15%)",
                    borderRadius: "12px",
                    boxShadow: "0 8px 32px -8px hsl(0 0% 0% / 0.6)",
                    padding: "12px 16px",
                  }}
                  labelStyle={{
                    color: "hsl(0, 0%, 95%)",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                  formatter={tooltipFormatter as any}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={isProfit ? "hsl(152, 95%, 45%)" : "hsl(0, 85%, 58%)"}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorBalance)"
                  filter="url(#glow)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  },
);
