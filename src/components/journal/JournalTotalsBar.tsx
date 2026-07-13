// Sticky cumulative totals across the current filtered Journal view.
// Wins/Losses/BE are computed at LEG granularity (mixed groups contribute
// to both) so a "1 TP win + 1 SL loss" position honestly shows both outcomes.
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { GroupedTrade } from "@/hooks/useGroupedTrades";

interface Props {
  trades: GroupedTrade[];
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function JournalTotalsBar({ trades }: Props) {
  const totals = useMemo(() => {
    let net = 0, gross = 0, commission = 0, swap = 0;
    let rSum = 0, rCount = 0;
    let wins = 0, losses = 0, be = 0, opens = 0, legs = 0;
    let hasNet = false, hasGross = false;
    for (const t of trades) {
      legs += t.leg_count ?? 1;
      wins += t.legs_win ?? 0;
      losses += t.legs_loss ?? 0;
      be += t.legs_be ?? 0;
      opens += t.legs_open ?? 0;
      if (t.net_pnl != null && Number.isFinite(t.net_pnl)) { net += t.net_pnl; hasNet = true; }
      if (t.gross_pnl != null && Number.isFinite(t.gross_pnl)) { gross += t.gross_pnl; hasGross = true; }
      if (t.commission != null && Number.isFinite(t.commission)) commission += t.commission;
      if (t.swap != null && Number.isFinite(t.swap)) swap += t.swap;
      if (t.r_multiple_actual != null && Number.isFinite(t.r_multiple_actual)) {
        rSum += t.r_multiple_actual;
        rCount += 1;
      }
    }
    const settled = wins + losses + be;
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;
    return {
      groups: trades.length, legs, net: hasNet ? net : null, gross: hasGross ? gross : null,
      commission, swap, rSum: rCount > 0 ? rSum : null, rAvg: rCount > 0 ? rSum / rCount : null,
      wins, losses, be, opens, settled, winRate,
    };
  }, [trades]);

  if (totals.groups === 0) return null;

  const Stat = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "profit" | "loss" | "muted" }) => (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn(
        "text-sm font-mono-numbers font-semibold truncate",
        tone === "profit" && "text-profit",
        tone === "loss" && "text-loss",
        tone === "muted" && "text-muted-foreground",
      )}>{value}</span>
    </div>
  );

  return (
    <div className="sticky top-0 z-10 mb-2 rounded-lg border border-border bg-card/95 backdrop-blur px-4 py-2.5 shadow-sm">
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-10 gap-4 items-center">
        <Stat label="Trades" value={totals.groups} />
        <Stat label="Legs" value={totals.legs} tone="muted" />
        <Stat
          label="Net P&L"
          value={totals.net != null ? fmtMoney(totals.net) : "—"}
          tone={totals.net == null ? "muted" : totals.net > 0 ? "profit" : totals.net < 0 ? "loss" : "muted"}
        />
        <Stat
          label="Gross"
          value={totals.gross != null ? fmtMoney(totals.gross) : "—"}
          tone={totals.gross == null ? "muted" : totals.gross > 0 ? "profit" : totals.gross < 0 ? "loss" : "muted"}
        />
        <Stat label="Commission" value={fmtMoney(totals.commission)} tone="muted" />
        <Stat label="Swap" value={fmtMoney(totals.swap)} tone="muted" />
        <Stat
          label="Total R"
          value={totals.rSum != null ? `${totals.rSum >= 0 ? "+" : ""}${totals.rSum.toFixed(2)}R` : "—"}
          tone={totals.rSum == null ? "muted" : totals.rSum > 0 ? "profit" : "loss"}
        />
        <Stat
          label="Avg R"
          value={totals.rAvg != null ? `${totals.rAvg >= 0 ? "+" : ""}${totals.rAvg.toFixed(2)}R` : "—"}
          tone="muted"
        />
        <Stat
          label={`Wins / Losses${totals.be ? " / BE" : ""}`}
          value={
            <span>
              <span className="text-profit">{totals.wins}</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-loss">{totals.losses}</span>
              {totals.be > 0 && (
                <>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-breakeven">{totals.be}</span>
                </>
              )}
            </span>
          }
        />
        <Stat
          label="Win rate"
          value={totals.winRate != null ? `${totals.winRate.toFixed(1)}%` : "—"}
          tone={totals.winRate == null ? "muted" : totals.winRate >= 50 ? "profit" : "loss"}
        />
      </div>
      {totals.opens > 0 && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {totals.opens} open leg{totals.opens > 1 ? "s" : ""} excluded from win-rate math.
        </div>
      )}
    </div>
  );
}
