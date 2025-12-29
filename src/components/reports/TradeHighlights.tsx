import * as React from 'react';
import { ReportMetrics } from '@/hooks/useReports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Trophy, Skull } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface TradeHighlightsProps {
  metrics: ReportMetrics;
}

export const TradeHighlights = React.forwardRef<HTMLDivElement, TradeHighlightsProps>(
  function TradeHighlights({ metrics }, _ref) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Best Trade */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-400" />
            Best Trade
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.bestTrade ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                    {metrics.bestTrade.symbol}
                  </Badge>
                  <Badge 
                    variant="outline" 
                    className={metrics.bestTrade.direction === 'buy' 
                      ? 'border-emerald-500/30 text-emerald-400' 
                      : 'border-red-500/30 text-red-400'
                    }
                  >
                    {metrics.bestTrade.direction.toUpperCase()}
                  </Badge>
                </div>
                <span className="text-emerald-400 font-bold text-lg">
                  +${metrics.bestTrade.net_pnl?.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {format(parseISO(metrics.bestTrade.entry_time), 'MMM d, yyyy • HH:mm')}
              </p>
              {metrics.bestTrade.r_multiple_actual && (
                <p className="text-sm text-emerald-400">
                  {metrics.bestTrade.r_multiple_actual.toFixed(2)}R
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No trades in this period</p>
          )}
        </CardContent>
      </Card>

      {/* Worst Trade */}
      <Card className="glass-card border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent pointer-events-none" />
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Skull className="h-4 w-4 text-red-400" />
            Worst Trade
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.worstTrade && (metrics.worstTrade.net_pnl || 0) < 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-red-500/30 text-red-400">
                    {metrics.worstTrade.symbol}
                  </Badge>
                  <Badge 
                    variant="outline" 
                    className={metrics.worstTrade.direction === 'buy' 
                      ? 'border-emerald-500/30 text-emerald-400' 
                      : 'border-red-500/30 text-red-400'
                    }
                  >
                    {metrics.worstTrade.direction.toUpperCase()}
                  </Badge>
                </div>
                <span className="text-red-400 font-bold text-lg">
                  ${metrics.worstTrade.net_pnl?.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {format(parseISO(metrics.worstTrade.entry_time), 'MMM d, yyyy • HH:mm')}
              </p>
              {metrics.worstTrade.r_multiple_actual && (
                <p className="text-sm text-red-400">
                  {metrics.worstTrade.r_multiple_actual.toFixed(2)}R
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No losing trades</p>
          )}
        </CardContent>
      </Card>

      {/* Win/Loss Stats */}
      <Card className="glass-card border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            Win Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground text-sm">Average Win</span>
            <span className="text-emerald-400 font-medium">${metrics.avgWin.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground text-sm">Largest Win</span>
            <span className="text-emerald-400 font-medium">${metrics.largestWin.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground text-sm">Max Consecutive</span>
            <span className="text-emerald-400 font-medium">{metrics.consecutiveWins}</span>
          </div>
        </CardContent>
      </Card>

      {/* Loss Stats */}
      <Card className="glass-card border-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-400" />
            Loss Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground text-sm">Average Loss</span>
            <span className="text-red-400 font-medium">${metrics.avgLoss.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground text-sm">Largest Loss</span>
            <span className="text-red-400 font-medium">${Math.abs(metrics.largestLoss).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground text-sm">Max Consecutive</span>
            <span className="text-red-400 font-medium">{metrics.consecutiveLosses}</span>
          </div>
        </CardContent>
        </Card>
      </div>
    );
  }
);
