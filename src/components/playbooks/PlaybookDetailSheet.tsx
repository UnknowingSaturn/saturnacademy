import { useNavigate } from "react-router-dom";
import { Playbook } from "@/types/trading";
import { PlaybookStats } from "@/hooks/usePlaybookStats";
import { usePlaybookRecentTrades } from "@/hooks/usePlaybookStats";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Edit, 
  ExternalLink, 
  Trash2, 
  TrendingUp, 
  TrendingDown, 
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Target,
  Clock,
  BarChart3,
  ShieldCheck,
  Flame,
  Trophy,
  AlertCircle,
  Copy
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

interface PlaybookDetailSheetProps {
  playbook: Playbook | null;
  stats?: PlaybookStats;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (playbook: Playbook) => void;
  onDuplicate: (playbook: Playbook) => void;
  onDelete: (id: string) => void;
}

export function PlaybookDetailSheet({
  playbook,
  stats,
  open,
  onOpenChange,
  onEdit,
  onDuplicate,
  onDelete,
}: PlaybookDetailSheetProps) {
  const navigate = useNavigate();
  const { data: recentTrades, isLoading: tradesLoading } = usePlaybookRecentTrades(playbook?.name);

  if (!playbook) return null;

  const handleViewTrades = () => {
    navigate(`/journal?model=${encodeURIComponent(playbook.name)}`);
    onOpenChange(false);
  };

  const handleEdit = () => {
    onEdit(playbook);
    onOpenChange(false);
  };

  const handleDuplicate = () => {
    onDuplicate(playbook);
    onOpenChange(false);
  };

  const handleDelete = () => {
    onDelete(playbook.id);
    onOpenChange(false);
  };

  const winRate = stats?.winRate ?? 0;
  const totalPnl = stats?.totalPnl ?? 0;
  const isProfit = totalPnl >= 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div 
              className="w-4 h-4 rounded-full shrink-0" 
              style={{ backgroundColor: playbook.color }}
            />
            <SheetTitle className="text-xl">{playbook.name}</SheetTitle>
          </div>
          {playbook.description && (
            <SheetDescription className="text-left">
              {playbook.description}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="space-y-6">
          {/* Performance Analytics */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Performance
            </h3>
            {stats && stats.totalTrades > 0 ? (
              <>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className="text-2xl font-bold text-foreground">{stats.totalTrades}</div>
                    <div className="text-xs text-muted-foreground">Trades</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className={cn(
                      "text-2xl font-bold",
                      winRate >= 50 ? "text-profit" : "text-destructive"
                    )}>
                      {winRate.toFixed(0)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Win Rate</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className={cn(
                      "text-2xl font-bold",
                      stats.avgR >= 0 ? "text-profit" : "text-destructive"
                    )}>
                      {stats.avgR.toFixed(2)}R
                    </div>
                    <div className="text-xs text-muted-foreground">Avg R</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className={cn(
                      "text-2xl font-bold",
                      stats.profitFactor >= 1 ? "text-profit" : "text-destructive"
                    )}>
                      {stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">P/F</div>
                  </div>
                </div>
                
                {/* Win/Loss bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{stats.wins} wins</span>
                    <span>{stats.losses} losses</span>
                  </div>
                  <Progress 
                    value={winRate} 
                    className={cn(
                      "h-2",
                      winRate >= 50 ? "[&>div]:bg-profit" : "[&>div]:bg-destructive"
                    )} 
                  />
                </div>

                {/* Total P&L */}
                <div className={cn(
                  "flex items-center justify-center gap-2 p-3 rounded-lg",
                  isProfit ? "bg-profit/10" : "bg-destructive/10"
                )}>
                  {isProfit ? (
                    <TrendingUp className="w-5 h-5 text-profit" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-destructive" />
                  )}
                  <span className={cn(
                    "text-xl font-bold",
                    isProfit ? "text-profit" : "text-destructive"
                  )}>
                    {isProfit ? "+" : "-"}${Math.abs(totalPnl).toFixed(2)}
                  </span>
                </div>
              </>
            ) : (
              <div className="p-6 rounded-lg bg-muted/30 text-center">
                <BarChart3 className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No trades yet</p>
              </div>
            )}
          </section>

          {/* Mini Equity Curve */}
          {stats && stats.equityCurve.length > 1 && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Equity Curve
              </h3>
              <div className="h-[100px] bg-muted/30 rounded-lg p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.equityCurve}>
                    <defs>
                      <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop 
                          offset="5%" 
                          stopColor={isProfit ? "hsl(var(--profit))" : "hsl(var(--destructive))"} 
                          stopOpacity={0.3}
                        />
                        <stop 
                          offset="95%" 
                          stopColor={isProfit ? "hsl(var(--profit))" : "hsl(var(--destructive))"} 
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-popover border rounded-lg p-2 shadow-lg text-xs">
                              <div className="font-medium">Trade #{data.tradeIndex}</div>
                              <div className={cn(
                                data.balance >= 0 ? "text-profit" : "text-destructive"
                              )}>
                                {data.balance >= 0 ? "+" : ""}${data.balance.toFixed(2)}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="balance" 
                      stroke={isProfit ? "hsl(var(--profit))" : "hsl(var(--destructive))"} 
                      strokeWidth={2}
                      fill="url(#equityGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Today's Compliance */}
          {(playbook.max_trades_per_session || playbook.max_daily_loss_r) && stats && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Today's Compliance
              </h3>
              <div className="space-y-3">
                {/* Trade limit progress */}
                {playbook.max_trades_per_session && (
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-muted-foreground">Session Trades</span>
                      <span className={cn(
                        "font-medium",
                        stats.todayTrades >= playbook.max_trades_per_session 
                          ? "text-destructive" 
                          : "text-foreground"
                      )}>
                        {stats.todayTrades} / {playbook.max_trades_per_session}
                      </span>
                    </div>
                    <Progress 
                      value={(stats.todayTrades / playbook.max_trades_per_session) * 100} 
                      className={cn(
                        "h-2",
                        stats.todayTrades >= playbook.max_trades_per_session 
                          ? "[&>div]:bg-destructive" 
                          : stats.todayTrades >= playbook.max_trades_per_session * 0.8 
                            ? "[&>div]:bg-yellow-500" 
                            : "[&>div]:bg-profit"
                      )}
                    />
                    {stats.todayTrades < playbook.max_trades_per_session && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {playbook.max_trades_per_session - stats.todayTrades} trades remaining
                      </p>
                    )}
                  </div>
                )}
                
                {/* Daily R limit progress */}
                {playbook.max_daily_loss_r && (
                  <div className="p-3 rounded-lg bg-muted/30">
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-muted-foreground">Daily R Used</span>
                      <span className={cn(
                        "font-medium",
                        stats.todayRUsed >= playbook.max_daily_loss_r 
                          ? "text-destructive" 
                          : "text-foreground"
                      )}>
                        {stats.todayRUsed.toFixed(2)}R / {playbook.max_daily_loss_r}R
                      </span>
                    </div>
                    <Progress 
                      value={(stats.todayRUsed / playbook.max_daily_loss_r) * 100} 
                      className={cn(
                        "h-2",
                        stats.todayRUsed >= playbook.max_daily_loss_r 
                          ? "[&>div]:bg-destructive" 
                          : stats.todayRUsed >= playbook.max_daily_loss_r * 0.8 
                            ? "[&>div]:bg-yellow-500" 
                            : "[&>div]:bg-profit"
                      )}
                    />
                    {stats.todayRUsed < playbook.max_daily_loss_r && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {(playbook.max_daily_loss_r - stats.todayRUsed).toFixed(2)}R remaining
                      </p>
                    )}
                  </div>
                )}

                {/* Compliance warnings */}
                {stats.complianceStatus.warnings.length > 0 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                    <div className="text-sm text-destructive">
                      {stats.complianceStatus.warnings.join(' • ')}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* R-Multiple Distribution */}
          {stats && stats.rDistribution.some(b => b.count > 0) && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                R-Multiple Distribution
              </h3>
              <div className="h-[80px] bg-muted/30 rounded-lg p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.rDistribution} layout="horizontal">
                    <XAxis 
                      dataKey="range" 
                      tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} 
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis hide />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-popover border rounded-lg p-2 shadow-lg text-xs">
                              <div className="font-medium">{data.range}</div>
                              <div>{data.count} trade{data.count !== 1 ? 's' : ''}</div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {stats.rDistribution.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.isPositive ? "hsl(var(--profit))" : "hsl(var(--destructive))"} 
                          fillOpacity={entry.count > 0 ? 0.8 : 0.2}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Streak Analysis */}
          {stats && stats.totalTrades > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Streaks
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded-lg bg-muted/30 text-center">
                  <Flame className={cn(
                    "w-4 h-4 mx-auto mb-1",
                    stats.streakStats.currentStreakType === 'win' ? "text-profit" : 
                    stats.streakStats.currentStreakType === 'loss' ? "text-destructive" : 
                    "text-muted-foreground"
                  )} />
                  <div className={cn(
                    "text-lg font-bold",
                    stats.streakStats.currentStreakType === 'win' ? "text-profit" : 
                    stats.streakStats.currentStreakType === 'loss' ? "text-destructive" : 
                    "text-muted-foreground"
                  )}>
                    {stats.streakStats.currentStreak}
                    {stats.streakStats.currentStreakType === 'win' && 'W'}
                    {stats.streakStats.currentStreakType === 'loss' && 'L'}
                  </div>
                  <div className="text-xs text-muted-foreground">Current</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 text-center">
                  <Trophy className="w-4 h-4 mx-auto mb-1 text-profit" />
                  <div className="text-lg font-bold text-profit">
                    {stats.streakStats.longestWinStreak}
                  </div>
                  <div className="text-xs text-muted-foreground">Best Win</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 text-center">
                  <TrendingDown className="w-4 h-4 mx-auto mb-1 text-destructive" />
                  <div className="text-lg font-bold text-destructive">
                    {stats.streakStats.longestLossStreak}
                  </div>
                  <div className="text-xs text-muted-foreground">Worst Loss</div>
                </div>
              </div>
            </section>
          )}

          {/* Filters Section */}
          {(playbook.session_filter?.length || playbook.symbol_filter?.length || playbook.valid_regimes?.length) && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Filters
              </h3>
              <div className="flex flex-wrap gap-2">
                {playbook.session_filter?.map((session) => (
                  <Badge key={session} variant="secondary" className="text-xs">
                    {session.replace(/_/g, ' ')}
                  </Badge>
                ))}
                {playbook.symbol_filter?.map((symbol) => (
                  <Badge key={symbol} variant="outline" className="text-xs">
                    {symbol}
                  </Badge>
                ))}
                {playbook.valid_regimes?.map((regime) => (
                  <Badge key={regime} variant="outline" className="text-xs bg-muted">
                    {regime}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {/* Rules Section */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Rules
            </h3>
            <div className="space-y-1">
              <RuleSection 
                title="Confirmation Rules" 
                rules={playbook.confirmation_rules || []} 
                icon={<CheckCircle2 className="w-4 h-4 text-profit" />}
              />
              <RuleSection 
                title="Invalidation Rules" 
                rules={playbook.invalidation_rules || []} 
                icon={<XCircle className="w-4 h-4 text-destructive" />}
              />
              <RuleSection 
                title="Management Rules" 
                rules={playbook.management_rules || []} 
                icon={<Target className="w-4 h-4 text-primary" />}
              />
              <RuleSection 
                title="Failure Modes" 
                rules={playbook.failure_modes || []} 
                icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}
              />
            </div>
          </section>

          {/* Risk Limits */}
          {(playbook.max_r_per_trade || playbook.max_daily_loss_r || playbook.max_trades_per_session) && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Risk Limits
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {playbook.max_r_per_trade && (
                  <div className="p-3 rounded-lg bg-muted/30 text-center">
                    <div className="text-lg font-semibold">{playbook.max_r_per_trade}R</div>
                    <div className="text-xs text-muted-foreground">Max R/Trade</div>
                  </div>
                )}
                {playbook.max_daily_loss_r && (
                  <div className="p-3 rounded-lg bg-muted/30 text-center">
                    <div className="text-lg font-semibold">{playbook.max_daily_loss_r}R</div>
                    <div className="text-xs text-muted-foreground">Max Daily Loss</div>
                  </div>
                )}
                {playbook.max_trades_per_session && (
                  <div className="p-3 rounded-lg bg-muted/30 text-center">
                    <div className="text-lg font-semibold">{playbook.max_trades_per_session}</div>
                    <div className="text-xs text-muted-foreground">Max Trades/Session</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Checklist Preview */}
          {playbook.checklist_questions.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Checklist ({playbook.checklist_questions.length} items)
              </h3>
              <ul className="space-y-1">
                {playbook.checklist_questions.slice(0, 5).map((q) => (
                  <li key={q.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Target className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                    <span>{q.question}</span>
                  </li>
                ))}
                {playbook.checklist_questions.length > 5 && (
                  <li className="text-xs text-muted-foreground pl-5">
                    +{playbook.checklist_questions.length - 5} more items
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* Recent Trades */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Recent Trades
            </h3>
            {tradesLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentTrades && recentTrades.length > 0 ? (
              <div className="space-y-2">
                {recentTrades.map((trade) => (
                  <div 
                    key={trade.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {format(new Date(trade.entry_time), 'MMM d')}
                      </span>
                      <span className="font-medium">{trade.symbol}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {trade.r_multiple_actual != null && (
                        <span className={cn(
                          "text-xs",
                          trade.r_multiple_actual >= 0 ? "text-profit" : "text-destructive"
                        )}>
                          {trade.r_multiple_actual >= 0 ? "+" : ""}{trade.r_multiple_actual.toFixed(2)}R
                        </span>
                      )}
                      <span className={cn(
                        "font-medium",
                        (trade.net_pnl ?? 0) >= 0 ? "text-profit" : "text-destructive"
                      )}>
                        {(trade.net_pnl ?? 0) >= 0 ? "+" : ""}${(trade.net_pnl ?? 0).toFixed(0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No recent trades</p>
            )}
          </section>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 pt-4 border-t">
            <div className="flex gap-2">
              <Button onClick={handleEdit} className="flex-1 gap-2">
                <Edit className="w-4 h-4" />
                Edit
              </Button>
              <Button variant="outline" onClick={handleDuplicate} className="flex-1 gap-2">
                <Copy className="w-4 h-4" />
                Duplicate
              </Button>
              <Button variant="outline" onClick={handleViewTrades} className="flex-1 gap-2">
                <ExternalLink className="w-4 h-4" />
                Trades
              </Button>
            </div>
            <Button 
              variant="ghost" 
              className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
              onClick={handleDelete}
            >
              <Trash2 className="w-4 h-4" />
              Delete Playbook
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Collapsible rule section component
function RuleSection({ title, rules, icon }: { title: string; rules: string[]; icon: React.ReactNode }) {
  if (rules.length === 0) return null;
  
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
          <Badge variant="secondary" className="text-xs">{rules.length}</Badge>
        </div>
        <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="py-2 pl-8 space-y-1">
          {rules.map((rule, i) => (
            <li key={i} className="text-sm text-muted-foreground list-disc">
              {rule}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
