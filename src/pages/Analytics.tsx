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
  ArrowUpRight,
  Brain,
  Zap,
  AlertOctagon,
  Sparkles
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
          <Skeleton className="h-64" />
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

    const { overview, playbook_comparison, symbol_performance, session_matrix, journal_insights, day_of_week, risk_analysis, ai_analysis } = data;

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
                AI-powered insights from your trading history
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

        {/* AI Edge Summary */}
        {ai_analysis?.edge_summary && (
          <Card className="glass-card border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                Edge Summary
                <Badge variant="outline" className="ml-2 bg-primary/10 text-primary border-primary/30">
                  <Sparkles className="h-3 w-3 mr-1" />
                  AI Analysis
                </Badge>
              </CardTitle>
              <CardDescription>Your trading edge identified from historical data</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2">
                {/* What Works */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-green-500 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    What Works
                  </h4>
                  <div className="space-y-2">
                    {ai_analysis.edge_summary.what_works.map((item, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                        <p className="text-sm text-foreground">{item}</p>
                      </div>
                    ))}
                  </div>
                  {ai_analysis.edge_summary.primary_edge && (
                    <div className="p-3 rounded-lg bg-green-500/20 border border-green-500/30">
                      <p className="text-xs text-green-500 font-medium mb-1">Primary Edge</p>
                      <p className="text-sm font-medium text-foreground">{ai_analysis.edge_summary.primary_edge}</p>
                    </div>
                  )}
                </div>

                {/* What Fails */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-red-500 flex items-center gap-2">
                    <TrendingDown className="h-4 w-4" />
                    What Fails
                  </h4>
                  <div className="space-y-2">
                    {ai_analysis.edge_summary.what_fails.map((item, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-sm text-foreground">{item}</p>
                      </div>
                    ))}
                  </div>
                  {ai_analysis.edge_summary.primary_leak && (
                    <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/30">
                      <p className="text-xs text-red-500 font-medium mb-1">Primary Leak</p>
                      <p className="text-sm font-medium text-foreground">{ai_analysis.edge_summary.primary_leak}</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mistake Mining */}
        {ai_analysis?.mistake_mining && ai_analysis.mistake_mining.length > 0 && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-red-500" />
                Top Mistakes (Ranked by R Lost)
              </CardTitle>
              <CardDescription>Recurring patterns costing you money, with actionable fixes</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[280px]">Mistake</TableHead>
                    <TableHead className="text-center">Frequency</TableHead>
                    <TableHead className="text-right">R Lost</TableHead>
                    <TableHead className="text-center">Confidence</TableHead>
                    <TableHead>Skip Condition</TableHead>
                    <TableHead>Fix</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ai_analysis.mistake_mining.map((mistake, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">
                        <div className="space-y-1">
                          <span>{mistake.definition}</span>
                          {mistake.sample_size && (
                            <p className="text-xs text-muted-foreground">
                              Based on {mistake.sample_size} trades
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{mistake.frequency}x</Badge>
                      </TableCell>
                      <TableCell className="text-right text-red-500 font-medium">
                        {typeof mistake.total_r_lost === 'number' ? mistake.total_r_lost.toFixed(1) : mistake.total_r_lost}R
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge 
                          variant="outline" 
                          className={cn(
                            mistake.confidence_level === 'high' && 'bg-green-500/10 text-green-500 border-green-500/30',
                            mistake.confidence_level === 'medium' && 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
                            mistake.confidence_level === 'low' && 'bg-orange-500/10 text-orange-500 border-orange-500/30',
                          )}
                        >
                          {mistake.confidence_level || 'medium'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {mistake.skip_condition}
                        </code>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px]">
                        {mistake.rule_change}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        {ai_analysis?.recommendations && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Rule Updates */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-blue-500" />
                  Rule Updates
                </CardTitle>
                <CardDescription>Changes to your trading rules</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {ai_analysis.recommendations.rule_updates.map((rec, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 space-y-3">
                    <div>
                      <p className="text-xs text-blue-500 font-medium mb-1">When</p>
                      <p className="text-sm">{rec.trigger_condition}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2 rounded bg-green-500/10">
                        <p className="text-xs text-green-500 font-medium mb-1">Do This</p>
                        <p className="text-sm">{rec.action}</p>
                      </div>
                      <div className="p-2 rounded bg-red-500/10">
                        <p className="text-xs text-red-500 font-medium mb-1">Don't Do This</p>
                        <p className="text-sm">{rec.avoid}</p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">Measure:</span> {rec.success_metric}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Execution Updates */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-500" />
                  Execution Updates
                </CardTitle>
                <CardDescription>Changes to your trade execution</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {ai_analysis.recommendations.execution_updates.map((rec, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20 space-y-3">
                    <div>
                      <p className="text-xs text-yellow-500 font-medium mb-1">When</p>
                      <p className="text-sm">{rec.trigger_condition}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2 rounded bg-green-500/10">
                        <p className="text-xs text-green-500 font-medium mb-1">Do This</p>
                        <p className="text-sm">{rec.action}</p>
                      </div>
                      <div className="p-2 rounded bg-red-500/10">
                        <p className="text-xs text-red-500 font-medium mb-1">Don't Do This</p>
                        <p className="text-sm">{rec.avoid}</p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">Measure:</span> {rec.success_metric}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* AI Playbook Grades */}
        {ai_analysis?.playbook_grades && ai_analysis.playbook_grades.length > 0 && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Playbook Analysis
                <Badge variant="outline" className="ml-2 bg-primary/10 text-primary border-primary/30">
                  <Brain className="h-3 w-3 mr-1" />
                  AI Graded
                </Badge>
              </CardTitle>
              <CardDescription>AI-generated strengths, weaknesses, and focus areas for each playbook</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {ai_analysis.playbook_grades.map((pg) => (
                  <div 
                    key={pg.playbook_id} 
                    className="p-4 rounded-lg border bg-card/50 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-foreground">{pg.playbook_name}</h4>
                        {pg.sample_size && (
                          <p className="text-xs text-muted-foreground">{pg.sample_size} trades</p>
                        )}
                      </div>
                      <Badge variant="outline" className={getGradeColor(pg.grade)}>
                        {pg.grade}
                      </Badge>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="p-2 rounded bg-green-500/10">
                        <p className="text-xs text-green-500 font-medium mb-1">Strength</p>
                        <p className="text-muted-foreground">{pg.key_strength}</p>
                      </div>
                      <div className="p-2 rounded bg-red-500/10">
                        <p className="text-xs text-red-500 font-medium mb-1">Weakness</p>
                        <p className="text-muted-foreground">{pg.key_weakness}</p>
                      </div>
                      <div className="p-2 rounded bg-primary/10">
                        <p className="text-xs text-primary font-medium mb-1">Focus Rule</p>
                        <p className="text-muted-foreground">{pg.focus_rule}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Insufficient Data Warning */}
        {ai_analysis?.insufficient_data && ai_analysis.insufficient_data.length > 0 && (
          <Card className="glass-card border-yellow-500/30">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground mb-2">Insufficient Data</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {ai_analysis.insufficient_data.map((item, idx) => (
                      <li key={idx}>• {item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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
