import { ReportMetrics } from '@/hooks/useReports';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Target, Activity, Calendar, BarChart3 } from 'lucide-react';

interface ReportMetricsGridProps {
  metrics: ReportMetrics;
}

export function ReportMetricsGrid({ metrics }: ReportMetricsGridProps) {
  const formatCurrency = (value: number) => {
    const formatted = Math.abs(value).toFixed(2);
    return value >= 0 ? `$${formatted}` : `-$${formatted}`;
  };

  const cards = [
    {
      label: 'Total P&L',
      value: formatCurrency(metrics.totalPnl),
      icon: metrics.totalPnl >= 0 ? TrendingUp : TrendingDown,
      color: metrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
      bgColor: metrics.totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10',
    },
    {
      label: 'Win Rate',
      value: `${metrics.winRate.toFixed(1)}%`,
      icon: Target,
      color: metrics.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400',
      bgColor: metrics.winRate >= 50 ? 'bg-emerald-500/10' : 'bg-amber-500/10',
    },
    {
      label: 'Profit Factor',
      value: metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2),
      icon: Activity,
      color: metrics.profitFactor >= 1 ? 'text-emerald-400' : 'text-red-400',
      bgColor: metrics.profitFactor >= 1 ? 'bg-emerald-500/10' : 'bg-red-500/10',
    },
    {
      label: 'Avg R-Multiple',
      value: metrics.avgRMultiple.toFixed(2),
      icon: BarChart3,
      color: metrics.avgRMultiple >= 0 ? 'text-emerald-400' : 'text-red-400',
      bgColor: metrics.avgRMultiple >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10',
    },
    {
      label: 'Total Trades',
      value: metrics.totalTrades.toString(),
      icon: Activity,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      label: 'Trading Days',
      value: metrics.tradingDays.toString(),
      icon: Calendar,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="glass-card border-white/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${card.bgColor}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
