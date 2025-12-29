import * as React from 'react';
import { usePlaybooks } from '@/hooks/usePlaybooks';
import { usePlaybookStats } from '@/hooks/usePlaybookStats';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle2, ShieldCheck, TrendingDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlaybookComplianceStatus {
  playbookId: string;
  playbookName: string;
  isCompliant: boolean;
  violations: {
    type: string;
    message: string;
    severity: 'warning' | 'error';
  }[];
  tradesRemaining?: number;
  rUsed?: number;
  rLimit?: number;
}

export const PlaybookCompliance = React.forwardRef<HTMLDivElement, object>(
  function PlaybookCompliance(_props, _ref) {
  const { data: playbooks } = usePlaybooks();
  const { data: allStats, isLoading } = usePlaybookStats();

  if (isLoading || !playbooks?.length) {
    return null;
  }

  const complianceStatuses: PlaybookComplianceStatus[] = playbooks
    .filter(p => p.max_r_per_trade || p.max_daily_loss_r || p.max_trades_per_session)
    .map(playbook => {
      const stats = allStats?.[playbook.id];
      const violations: PlaybookComplianceStatus['violations'] = [];

      // Check session trade limit
      if (playbook.max_trades_per_session && stats) {
        const remaining = playbook.max_trades_per_session - stats.todayTrades;
        if (remaining <= 0) {
          violations.push({
            type: 'session_limit',
            message: `Trade limit reached (${stats.todayTrades}/${playbook.max_trades_per_session})`,
            severity: 'error'
          });
        } else if (remaining === 1) {
          violations.push({
            type: 'session_limit',
            message: `1 trade remaining`,
            severity: 'warning'
          });
        }
      }

      // Check daily loss - simplified (we'd need R tracking for accurate R-based limits)
      if (playbook.max_daily_loss_r && stats && stats.todayPnl < 0) {
        // This is a simplified check - ideally we'd track R-multiples for today
        violations.push({
          type: 'daily_loss',
          message: `Today's loss: ${stats.todayPnl.toFixed(2)}`,
          severity: stats.todayPnl < -100 ? 'error' : 'warning'
        });
      }

      return {
        playbookId: playbook.id,
        playbookName: playbook.name,
        isCompliant: violations.filter(v => v.severity === 'error').length === 0,
        violations,
        tradesRemaining: playbook.max_trades_per_session 
          ? Math.max(0, playbook.max_trades_per_session - (stats?.todayTrades || 0))
          : undefined,
        rLimit: playbook.max_r_per_trade,
      };
    })
    .filter(s => s.violations.length > 0 || s.tradesRemaining !== undefined);

  if (complianceStatuses.length === 0) {
    return null;
  }

  const hasViolations = complianceStatuses.some(s => s.violations.length > 0);

  return (
    <Card className={cn(
      hasViolations && "border-warning/50"
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          Today's Compliance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {complianceStatuses.map(status => (
          <div 
            key={status.playbookId}
            className={cn(
              "p-2 rounded-md border",
              status.isCompliant ? "border-muted bg-muted/30" : "border-warning/30 bg-warning/5"
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium truncate">{status.playbookName}</span>
              {status.isCompliant ? (
                <CheckCircle2 className="w-4 h-4 text-profit flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
              )}
            </div>
            
            {status.tradesRemaining !== undefined && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>
                  {status.tradesRemaining === 0 
                    ? 'No trades remaining' 
                    : `${status.tradesRemaining} trade${status.tradesRemaining !== 1 ? 's' : ''} remaining`
                  }
                </span>
              </div>
            )}

            {status.rLimit && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <TrendingDown className="w-3 h-3" />
                <span>Max {status.rLimit}R per trade</span>
              </div>
            )}

            {status.violations.length > 0 && (
              <div className="mt-2 space-y-1">
                {status.violations.map((v, i) => (
                  <Badge 
                    key={i} 
                    variant={v.severity === 'error' ? 'destructive' : 'outline'}
                    className="text-xs"
                  >
                    {v.message}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
        </CardContent>
      </Card>
    );
  }
);
