import { useMemo } from "react";
import { Trade } from "@/types/trading";
import { Trophy, TrendingDown, Flame, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreakAnalysisProps {
  trades: Trade[];
}

export function StreakAnalysis({ trades }: StreakAnalysisProps) {
  const stats = useMemo(() => {
    const closedTrades = trades
      .filter(t => !t.is_open && t.net_pnl !== null)
      .sort((a, b) => new Date(a.exit_time!).getTime() - new Date(b.exit_time!).getTime());

    if (closedTrades.length === 0) {
      return {
        currentStreak: { type: "win" as const, count: 0 },
        longestWinStreak: 0,
        longestLossStreak: 0,
        avgWinStreak: 0,
        avgLossStreak: 0,
      };
    }

    let currentStreak = { type: "win" as "win" | "loss", count: 0 };
    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let currentWinCount = 0;
    let currentLossCount = 0;
    const winStreaks: number[] = [];
    const lossStreaks: number[] = [];

    closedTrades.forEach((trade, index) => {
      const isWin = (trade.net_pnl || 0) > 0;
      
      if (isWin) {
        currentWinCount++;
        if (currentLossCount > 0) {
          lossStreaks.push(currentLossCount);
          longestLossStreak = Math.max(longestLossStreak, currentLossCount);
          currentLossCount = 0;
        }
      } else {
        currentLossCount++;
        if (currentWinCount > 0) {
          winStreaks.push(currentWinCount);
          longestWinStreak = Math.max(longestWinStreak, currentWinCount);
          currentWinCount = 0;
        }
      }

      // Track current streak (from most recent trade)
      if (index === closedTrades.length - 1) {
        if (currentWinCount > 0) {
          winStreaks.push(currentWinCount);
          longestWinStreak = Math.max(longestWinStreak, currentWinCount);
          currentStreak = { type: "win", count: currentWinCount };
        } else {
          lossStreaks.push(currentLossCount);
          longestLossStreak = Math.max(longestLossStreak, currentLossCount);
          currentStreak = { type: "loss", count: currentLossCount };
        }
      }
    });

    const avgWinStreak = winStreaks.length > 0 
      ? winStreaks.reduce((a, b) => a + b, 0) / winStreaks.length 
      : 0;
    const avgLossStreak = lossStreaks.length > 0 
      ? lossStreaks.reduce((a, b) => a + b, 0) / lossStreaks.length 
      : 0;

    return {
      currentStreak,
      longestWinStreak,
      longestLossStreak,
      avgWinStreak,
      avgLossStreak,
    };
  }, [trades]);

  const isCurrentWin = stats.currentStreak.type === "win";

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
      style={{
        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
      }}
    >
      <div className="p-6 pb-4">
        <h3 className="text-lg font-semibold text-foreground">Streak Analysis</h3>
        <p className="text-sm text-muted-foreground">Win/loss streak statistics</p>
      </div>
      <div className="px-6 pb-6">
        <div className="grid grid-cols-2 gap-4">
          {/* Current Streak */}
          <div className={cn(
            "rounded-lg p-4 border",
            isCurrentWin 
              ? "bg-profit/5 border-profit/20" 
              : "bg-loss/5 border-loss/20"
          )}
          style={{
            boxShadow: isCurrentWin 
              ? "0 0 20px hsl(var(--profit) / 0.1)"
              : "0 0 20px hsl(var(--loss) / 0.1)"
          }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Flame className={cn(
                "w-4 h-4",
                isCurrentWin ? "text-profit" : "text-loss"
              )} />
              <span className="text-xs text-muted-foreground">Current</span>
            </div>
            <p className={cn(
              "text-2xl font-bold font-mono",
              isCurrentWin ? "text-profit" : "text-loss"
            )}
            style={{
              textShadow: isCurrentWin 
                ? "0 0 20px hsl(var(--profit) / 0.5)"
                : "0 0 20px hsl(var(--loss) / 0.5)"
            }}
            >
              {stats.currentStreak.count} {stats.currentStreak.type}s
            </p>
          </div>

          {/* Longest Win */}
          <div className="rounded-lg p-4 bg-profit/5 border border-profit/20">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-profit" />
              <span className="text-xs text-muted-foreground">Best Win Streak</span>
            </div>
            <p className="text-2xl font-bold font-mono text-profit"
              style={{ textShadow: "0 0 20px hsl(var(--profit) / 0.4)" }}
            >
              {stats.longestWinStreak}
            </p>
          </div>

          {/* Longest Loss */}
          <div className="rounded-lg p-4 bg-loss/5 border border-loss/20">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-loss" />
              <span className="text-xs text-muted-foreground">Worst Loss Streak</span>
            </div>
            <p className="text-2xl font-bold font-mono text-loss"
              style={{ textShadow: "0 0 20px hsl(var(--loss) / 0.4)" }}
            >
              {stats.longestLossStreak}
            </p>
          </div>

          {/* Averages */}
          <div className="rounded-lg p-4 bg-muted/30 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Avg Streaks</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm">
                <span className="text-profit font-mono font-semibold">{stats.avgWinStreak.toFixed(1)}</span>
                <span className="text-muted-foreground"> W</span>
              </span>
              <span className="text-sm">
                <span className="text-loss font-mono font-semibold">{stats.avgLossStreak.toFixed(1)}</span>
                <span className="text-muted-foreground"> L</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
