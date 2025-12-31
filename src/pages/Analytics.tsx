import * as React from 'react';
import { useTradeAnalytics } from '@/hooks/useTradeAnalytics';
import { useAccountFilter } from '@/contexts/AccountFilterContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  RefreshCw,
  Target,
  BookOpen,
  Calendar,
  Shield,
  Lightbulb,
  XCircle,
  CheckCircle,
  ArrowUpRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const Analytics = React.forwardRef<HTMLDivElement, object>(
  function Analytics(_props, _ref) {
    const { selectedAccountId, selectedAccount } = useAccountFilter();
    const { data, isLoading, error, refetch, isFetching } = useTradeAnalytics(
      selectedAccountId === 'all' ? undefined : selectedAccountId
    );

    const formatCurrency = (value: number) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    };

    const formatPercent = (value: number) => `${value.toFixed(1)}%`;
    const formatR = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;

    const getGradeColor = (grade: string) => {
      switch (grade) {
        case 'A': return 'bg-green-500/10 text-green-500 border-green-500/30';
        case 'B': return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
        case 'C': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30';
        case 'D': return 'bg-orange-500/10 text-orange-500 border-orange-500/30';
        case 'F': return 'bg-red-500/10 text-red-500 border-red-500/30';
        default: return 'bg-muted text-muted-foreground';
      }
    };

    const getRecommendationStyle = (rec: string) => {
      switch (rec) {
        case 'focus': return 'bg-green-500/10 text-green-500 border-green-500/30';
        case 'avoid': return 'bg-red-500/10 text-red-500 border-red-500/30';
        default: return 'bg-muted text-muted-foreground border-muted';
      }
    };

    if (isLoading) {
      return (
        <div className="space-y-6 p-6 animate-fade-in">
          <div className="flex items-center justify-between">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-10 w-24" />
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        </div>
      );
    }

    if (error || !data) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 gap-4">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <p className="text-lg font-medium">Failed to load analytics</p>
          <Button onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      );
    }

    const { overview, playbook_comparison, symbol_performance, session_matrix, journal_insights, day_of_week, risk_analysis } = data;

    return (
      <div className="space-y-6 p-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <BarChart3 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Analytics
                {selectedAccount && (
                  <span className="text-lg font-normal text-muted-foreground ml-2">
                    • {selectedAccount.name}
                  </span>
                )}
              </h1>
              <p className="text-muted-foreground text-sm">
                Deep insights from your trading history
              </p>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Overview Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="glass-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Trades</p>
                  <p className="text-2xl font-bold">{overview.total_trades}</p>
                </div>
                <Target className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total P&L</p>
                  <p className={cn(
                    "text-2xl font-bold",
                    overview.total_pnl >= 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {formatCurrency(overview.total_pnl)}
                  </p>
                </div>
                {overview.total_pnl >= 0 ? (
                  <TrendingUp className="h-8 w-8 text-green-500/50" />
                ) : (
                  <TrendingDown className="h-8 w-8 text-red-500/50" />
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Win Rate</p>
                  <p className="text-2xl font-bold">{formatPercent(overview.win_rate)}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg R</p>
                  <p className={cn(
                    "text-2xl font-bold",
                    overview.avg_r >= 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {formatR(overview.avg_r)}
                  </p>
                </div>
                <ArrowUpRight className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Playbook Comparison & Symbol Performance */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Playbook Comparison */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Playbook Performance
              </CardTitle>
              <CardDescription>How each strategy is performing</CardDescription>
            </CardHeader>
            <CardContent>
              {playbook_comparison.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No playbook data available
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Playbook</TableHead>
                      <TableHead className="text-center">Grade</TableHead>
                      <TableHead className="text-right">Trades</TableHead>
                      <TableHead className="text-right">Win%</TableHead>
                      <TableHead className="text-right">Avg R</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {playbook_comparison.map((pb) => (
                      <TableRow key={pb.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: pb.color }}
                            />
                            <span className="font-medium truncate max-w-[120px]">
                              {pb.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={getGradeColor(pb.grade)}>
                            {pb.grade}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{pb.trades}</TableCell>
                        <TableCell className="text-right">{formatPercent(pb.win_rate)}</TableCell>
                        <TableCell className={cn(
                          "text-right font-medium",
                          pb.avg_r >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {formatR(pb.avg_r)}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right font-medium",
                          pb.total_pnl >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {formatCurrency(pb.total_pnl)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Symbol Performance */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Symbol Performance
              </CardTitle>
              <CardDescription>Which instruments work for you</CardDescription>
            </CardHeader>
            <CardContent>
              {symbol_performance.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No symbol data available
                </p>
              ) : (
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {symbol_performance.map((sym) => (
                    <div 
                      key={sym.symbol}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        <Badge 
                          variant="outline" 
                          className={getRecommendationStyle(sym.recommendation)}
                        >
                          {sym.recommendation === 'focus' ? 'Focus' : 
                           sym.recommendation === 'avoid' ? 'Avoid' : 'Neutral'}
                        </Badge>
                        <span className="font-medium">{sym.symbol}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">{sym.trades} trades</span>
                        <span className="text-muted-foreground">{formatPercent(sym.win_rate)}</span>
                        <span className={cn(
                          "font-medium min-w-[60px] text-right",
                          sym.total_pnl >= 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {formatCurrency(sym.total_pnl)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Session Matrix */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Session & Direction Analysis
            </CardTitle>
            <CardDescription>
              Performance by trading session and direction. 
              <span className="text-yellow-500 ml-1">⚠ Yellow rows</span> indicate R:R issues (winning but losing money)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {session_matrix.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No session data available
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Win%</TableHead>
                    <TableHead className="text-right">Avg R</TableHead>
                    <TableHead className="text-right">Avg Winner</TableHead>
                    <TableHead className="text-right">Avg Loser</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {session_matrix.map((entry, idx) => (
                    <TableRow 
                      key={idx}
                      className={cn(entry.rr_warning && "bg-yellow-500/10")}
                    >
                      <TableCell className="font-medium">{entry.session}</TableCell>
                      <TableCell>
                        <Badge variant={entry.direction === 'Long' ? 'default' : 'secondary'}>
                          {entry.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{entry.trades}</TableCell>
                      <TableCell className="text-right">{formatPercent(entry.win_rate)}</TableCell>
                      <TableCell className={cn(
                        "text-right font-medium",
                        entry.avg_r >= 0 ? "text-green-500" : "text-red-500"
                      )}>
                        {formatR(entry.avg_r)}
                      </TableCell>
                      <TableCell className="text-right text-green-500">
                        +{entry.avg_winner.toFixed(2)}R
                      </TableCell>
                      <TableCell className="text-right text-red-500">
                        -{entry.avg_loser.toFixed(2)}R
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-medium",
                        entry.total_pnl >= 0 ? "text-green-500" : "text-red-500"
                      )}>
                        {formatCurrency(entry.total_pnl)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Journal Insights & Day of Week */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Journal Insights */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5" />
                Journal Insights
              </CardTitle>
              <CardDescription>
                Common patterns from your trade reviews ({journal_insights.reviewed_trades} reviewed, {journal_insights.unreviewed_trades} pending)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {journal_insights.reviewed_trades === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No reviewed trades yet. Start reviewing your trades to see insights.
                </p>
              ) : (
                <>
                  {/* Common Mistakes */}
                  {journal_insights.common_mistakes.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-red-500 flex items-center gap-1 mb-2">
                        <XCircle className="h-4 w-4" />
                        Common Mistakes
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {journal_insights.common_mistakes.slice(0, 5).map((item, idx) => (
                          <Badge 
                            key={idx} 
                            variant="outline" 
                            className="bg-red-500/10 text-red-500 border-red-500/30"
                          >
                            {item.text} ({item.count})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Things Done Well */}
                  {journal_insights.common_strengths.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-green-500 flex items-center gap-1 mb-2">
                        <CheckCircle className="h-4 w-4" />
                        Strengths
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {journal_insights.common_strengths.slice(0, 5).map((item, idx) => (
                          <Badge 
                            key={idx} 
                            variant="outline" 
                            className="bg-green-500/10 text-green-500 border-green-500/30"
                          >
                            {item.text} ({item.count})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Areas to Improve */}
                  {journal_insights.common_improvements.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-yellow-500 flex items-center gap-1 mb-2">
                        <Lightbulb className="h-4 w-4" />
                        Areas to Improve
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {journal_insights.common_improvements.slice(0, 5).map((item, idx) => (
                          <Badge 
                            key={idx} 
                            variant="outline" 
                            className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
                          >
                            {item.text} ({item.count})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Day of Week Performance */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Day of Week
              </CardTitle>
              <CardDescription>Which days perform best</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {day_of_week.map((day) => {
                  const maxPnl = Math.max(...day_of_week.map(d => Math.abs(d.total_pnl)), 1);
                  const barWidth = Math.abs(day.total_pnl) / maxPnl * 100;
                  
                  return (
                    <div key={day.day} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{day.day}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-muted-foreground">{day.trades} trades</span>
                          <span className="text-muted-foreground">{formatPercent(day.win_rate)}</span>
                          <span className={cn(
                            "font-medium min-w-[70px] text-right",
                            day.total_pnl >= 0 ? "text-green-500" : "text-red-500"
                          )}>
                            {formatCurrency(day.total_pnl)}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all",
                            day.total_pnl >= 0 ? "bg-green-500" : "bg-red-500"
                          )}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Risk Analysis */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Risk Analysis
            </CardTitle>
            <CardDescription>
              Position sizing patterns ({risk_analysis.trades_with_risk_data} trades with risk data)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <p className="text-sm text-muted-foreground mb-1">Avg Risk</p>
                <p className="text-2xl font-bold">{risk_analysis.avg_risk_percent.toFixed(2)}%</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <p className="text-sm text-muted-foreground mb-1">Risk Consistency</p>
                <p className="text-2xl font-bold">±{risk_analysis.risk_consistency.toFixed(2)}%</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-green-500/10">
                <p className="text-sm text-muted-foreground mb-1">Largest Win</p>
                <p className="text-2xl font-bold text-green-500">+{risk_analysis.largest_win_r.toFixed(2)}R</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-red-500/10">
                <p className="text-sm text-muted-foreground mb-1">Largest Loss</p>
                <p className="text-2xl font-bold text-red-500">{risk_analysis.largest_loss_r.toFixed(2)}R</p>
              </div>
            </div>

            {risk_analysis.risk_distribution.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-medium mb-3">Risk Distribution</h4>
                <div className="flex gap-2">
                  {risk_analysis.risk_distribution.map((bucket) => {
                    const maxCount = Math.max(...risk_analysis.risk_distribution.map(b => b.count), 1);
                    const height = (bucket.count / maxCount) * 80 + 20;
                    
                    return (
                      <div key={bucket.bucket} className="flex-1 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div 
                            className="w-full bg-primary/20 rounded-t transition-all"
                            style={{ height: `${height}px` }}
                          >
                            <div className="text-xs font-medium py-1">
                              {bucket.count}
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground">{bucket.bucket}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* No Data State */}
        {overview.total_trades === 0 && (
          <div className="text-center py-12">
            <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              No trade data to analyze
            </h3>
            <p className="text-muted-foreground text-sm">
              Start logging trades to see insights and patterns.
            </p>
          </div>
        )}
      </div>
    );
  }
);

export default Analytics;
