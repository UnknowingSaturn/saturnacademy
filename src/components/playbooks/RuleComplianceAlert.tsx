import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Playbook, Trade, TradeReview } from '@/types/trading';
import { usePlaybookStats } from '@/hooks/usePlaybookStats';
import { AlertTriangle, ShieldAlert, Clock, TrendingDown, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RuleComplianceAlertProps {
  trade: Trade;
  review?: TradeReview;
  playbook?: Playbook;
  className?: string;
}

interface ComplianceViolation {
  type: 'max_r' | 'daily_loss' | 'session_limit' | 'checklist';
  severity: 'warning' | 'error';
  message: string;
  detail?: string;
}

export function RuleComplianceAlert({ trade, review, playbook, className }: RuleComplianceAlertProps) {
  const { data: allStats } = usePlaybookStats();
  
  if (!playbook) return null;

  const violations: ComplianceViolation[] = [];
  const playbookStats = playbook.id ? allStats?.[playbook.id] : undefined;

  // Check max R per trade
  if (playbook.max_r_per_trade && trade.r_multiple_actual) {
    const actualR = Math.abs(trade.r_multiple_actual);
    if (actualR > playbook.max_r_per_trade) {
      violations.push({
        type: 'max_r',
        severity: 'error',
        message: `Trade exceeded max R limit`,
        detail: `Actual: ${actualR.toFixed(1)}R / Max: ${playbook.max_r_per_trade}R`
      });
    } else if (actualR > playbook.max_r_per_trade * 0.8) {
      violations.push({
        type: 'max_r',
        severity: 'warning',
        message: `Trade approaching max R limit`,
        detail: `Actual: ${actualR.toFixed(1)}R / Max: ${playbook.max_r_per_trade}R`
      });
    }
  }

  // Check daily loss limit (using today's stats)
  if (playbook.max_daily_loss_r && playbookStats) {
    const todayR = playbookStats.todayPnl; // This is actually PnL, ideally we'd track R
    if (todayR < 0 && Math.abs(todayR) > playbook.max_daily_loss_r) {
      violations.push({
        type: 'daily_loss',
        severity: 'error',
        message: `Daily loss limit exceeded`,
        detail: `Today's loss exceeds ${playbook.max_daily_loss_r}R limit`
      });
    }
  }

  // Check session trade limit
  if (playbook.max_trades_per_session && playbookStats) {
    if (playbookStats.todayTrades > playbook.max_trades_per_session) {
      violations.push({
        type: 'session_limit',
        severity: 'error',
        message: `Session trade limit exceeded`,
        detail: `${playbookStats.todayTrades} / ${playbook.max_trades_per_session} trades today`
      });
    } else if (playbookStats.todayTrades === playbook.max_trades_per_session) {
      violations.push({
        type: 'session_limit',
        severity: 'warning',
        message: `Session trade limit reached`,
        detail: `${playbookStats.todayTrades} / ${playbook.max_trades_per_session} trades today`
      });
    }
  }

  // Check checklist completion
  if (review?.checklist_answers && playbook.checklist_questions.length > 0) {
    const answered = Object.keys(review.checklist_answers).length;
    const passed = Object.values(review.checklist_answers).filter(Boolean).length;
    const total = playbook.checklist_questions.length;
    
    if (answered < total) {
      violations.push({
        type: 'checklist',
        severity: 'warning',
        message: `Incomplete checklist`,
        detail: `${answered}/${total} questions answered`
      });
    } else if (passed < total * 0.7) {
      violations.push({
        type: 'checklist',
        severity: 'warning',
        message: `Low checklist score`,
        detail: `${passed}/${total} passed (${Math.round(passed/total*100)}%)`
      });
    }
  }

  if (violations.length === 0) return null;

  const hasErrors = violations.some(v => v.severity === 'error');

  const getIcon = (type: ComplianceViolation['type']) => {
    switch (type) {
      case 'max_r': return TrendingDown;
      case 'daily_loss': return ShieldAlert;
      case 'session_limit': return Clock;
      case 'checklist': return Target;
      default: return AlertTriangle;
    }
  };

  return (
    <Alert 
      variant={hasErrors ? 'destructive' : 'default'} 
      className={cn("border-loss/30 bg-loss/5", className)}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm">
        {hasErrors ? 'Rule Violations Detected' : 'Compliance Warnings'}
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-2">
        {violations.map((violation, i) => {
          const Icon = getIcon(violation.type);
          return (
            <div 
              key={i} 
              className={cn(
                "flex items-start gap-2 text-sm",
                violation.severity === 'error' ? 'text-loss' : 'text-warning'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">{violation.message}</span>
                {violation.detail && (
                  <span className="text-muted-foreground ml-1">({violation.detail})</span>
                )}
              </div>
            </div>
          );
        })}
      </AlertDescription>
    </Alert>
  );
}
