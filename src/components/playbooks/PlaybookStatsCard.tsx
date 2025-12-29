import { PlaybookStats } from '@/hooks/usePlaybookStats';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

interface PlaybookStatsCardProps {
  stats?: PlaybookStats;
  isLoading?: boolean;
}

export function PlaybookStatsCard({ stats, isLoading }: PlaybookStatsCardProps) {
  if (isLoading) {
    return (
      <div className="h-16 bg-muted/50 animate-pulse rounded-md" />
    );
  }

  if (!stats || stats.totalTrades === 0) {
    return (
      <div className="flex items-center justify-center h-16 bg-muted/30 rounded-md text-xs text-muted-foreground">
        <BarChart3 className="w-4 h-4 mr-2" />
        No trades yet
      </div>
    );
  }

  const isPositive = stats.totalPnl >= 0;

  return (
    <div className="space-y-2 p-3 bg-muted/30 rounded-md">
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="text-lg font-bold">{stats.totalTrades}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Trades</div>
        </div>
        <div>
          <div className={cn(
            "text-lg font-bold",
            stats.winRate >= 50 ? "text-profit" : "text-loss"
          )}>
            {stats.winRate.toFixed(0)}%
          </div>
          <div className="text-[10px] text-muted-foreground uppercase">Win Rate</div>
        </div>
        <div>
          <div className={cn(
            "text-lg font-bold",
            stats.avgR >= 0 ? "text-profit" : "text-loss"
          )}>
            {stats.avgR.toFixed(1)}R
          </div>
          <div className="text-[10px] text-muted-foreground uppercase">Avg R</div>
        </div>
        <div>
          <div className={cn(
            "text-lg font-bold",
            stats.profitFactor >= 1 ? "text-profit" : "text-loss"
          )}>
            {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase">P/F</div>
        </div>
      </div>
      
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{stats.wins}W / {stats.losses}L</span>
          <span className={cn(
            "font-medium",
            isPositive ? "text-profit" : "text-loss"
          )}>
            {isPositive ? '+' : ''}{stats.totalPnl.toFixed(2)}
          </span>
        </div>
        <Progress 
          value={stats.winRate} 
          className="h-1.5"
        />
      </div>

      {stats.todayTrades > 0 && (
        <div className="flex items-center gap-1 text-xs pt-1 border-t">
          <span className="text-muted-foreground">Today:</span>
          <span className="font-medium">{stats.todayTrades} trades</span>
          <span className={cn(
            "font-medium",
            stats.todayPnl >= 0 ? "text-profit" : "text-loss"
          )}>
            ({stats.todayPnl >= 0 ? '+' : ''}{stats.todayPnl.toFixed(2)})
          </span>
        </div>
      )}
    </div>
  );
}
