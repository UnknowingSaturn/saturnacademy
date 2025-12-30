import { useState, useEffect } from "react";
import { Trade, Playbook } from "@/types/trading";
import { useTradeCompliance, ComplianceRule } from "@/hooks/useTradeCompliance";
import { useUpsertTradeReview } from "@/hooks/useTrades";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertTriangle,
  Shield,
  Target,
  Ban,
  ListChecks,
  Lightbulb,
  TriangleAlert,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ComplianceScoreRing } from "@/components/live/ComplianceScoreRing";
import { QuickNoteInput } from "@/components/live/QuickNoteInput";

interface LiveTradeCompliancePanelProps {
  trade: Trade;
  playbook: Playbook;
}

export function LiveTradeCompliancePanel({ trade, playbook }: LiveTradeCompliancePanelProps) {
  const existingReview = trade.review;
  const [manualAnswers, setManualAnswers] = useState<Record<string, boolean>>(
    existingReview?.checklist_answers || {}
  );
  const [autoVerifiedOpen, setAutoVerifiedOpen] = useState(false);
  
  const upsertReview = useUpsertTradeReview();

  const compliance = useTradeCompliance(trade, playbook, manualAnswers);

  // Calculate score
  const totalRules = compliance.confirmationRules.length + 
    compliance.invalidationRules.length + 
    compliance.checklistQuestions.length;
  const completedRules = [...compliance.confirmationRules, ...compliance.invalidationRules, ...compliance.checklistQuestions]
    .filter(r => r.status === 'passed').length;

  // Auto-collapse auto-verified if all pass
  useEffect(() => {
    const allPassed = compliance.autoVerified.every(r => r.status === 'passed' || r.status === 'na');
    setAutoVerifiedOpen(!allPassed);
  }, [compliance.autoVerified]);

  // Auto-save when manual answers change (silently) - uses upsert
  useEffect(() => {
    if (Object.keys(manualAnswers).length === 0) return;
    if (upsertReview.isPending) return;
    
    const saveAnswers = async () => {
      const reviewData = {
        trade_id: trade.id,
        playbook_id: playbook.id,
        checklist_answers: manualAnswers,
        score: Object.values(manualAnswers).filter(Boolean).length,
        // Preserve existing values
        ...(existingReview && {
          regime: existingReview.regime,
          emotional_state_before: existingReview.emotional_state_before,
          psychology_notes: existingReview.psychology_notes,
          screenshots: existingReview.screenshots,
        }),
      };

      try {
        await upsertReview.mutateAsync({ review: reviewData, silent: true });
      } catch (error) {
        // Error handled by mutation
      }
    };

    const debounce = setTimeout(saveAnswers, 500);
    return () => clearTimeout(debounce);
  }, [manualAnswers, trade.id, playbook.id, existingReview, upsertReview.isPending]);

  const toggleAnswer = (ruleId: string) => {
    setManualAnswers(prev => ({
      ...prev,
      [ruleId]: !prev[ruleId],
    }));
  };

  const getStatusIcon = (status: ComplianceRule['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 className="h-4 w-4 text-profit" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-loss" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      case 'na':
        return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getOverallBadge = () => {
    switch (compliance.overallStatus) {
      case 'compliant':
        return (
          <Badge variant="outline" className="bg-profit/10 text-profit border-profit/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Compliant
          </Badge>
        );
      case 'violations':
        return (
          <Badge variant="outline" className="bg-loss/10 text-loss border-loss/30">
            <XCircle className="h-3 w-3 mr-1" />
            {compliance.violationCount} Issue{compliance.violationCount > 1 ? 's' : ''}
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
            <Clock className="h-3 w-3 mr-1" />
            In Progress
          </Badge>
        );
    }
  };

  const renderChecklistItem = (rule: ComplianceRule) => (
    <label
      key={rule.id}
      className={cn(
        "flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-all",
        manualAnswers[rule.id] 
          ? "bg-profit/5 border border-profit/20" 
          : "hover:bg-muted/50 border border-transparent"
      )}
    >
      <Checkbox
        checked={manualAnswers[rule.id] || false}
        onCheckedChange={() => toggleAnswer(rule.id)}
        className="mt-0.5"
      />
      <span className={cn(
        "text-sm transition-colors",
        manualAnswers[rule.id] && "text-foreground"
      )}>
        {rule.label}
      </span>
    </label>
  );

  return (
    <div className="space-y-4">
      {/* Header with Score Ring */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ComplianceScoreRing
            completed={completedRules}
            total={totalRules}
            violations={compliance.violationCount}
            size="md"
          />
          <div>
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: playbook.color }}
              />
              <span className="font-semibold text-sm">{playbook.name}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {completedRules}/{totalRules} checks complete
            </div>
          </div>
        </div>
        {getOverallBadge()}
      </div>

      <ScrollArea className="h-[calc(100vh-380px)]">
        <div className="space-y-3 pr-4">
          {/* Auto-Verified Section - Collapsible */}
          {compliance.autoVerified.length > 0 && (
            <Collapsible open={autoVerifiedOpen} onOpenChange={setAutoVerifiedOpen}>
              <Card className="border-border/50">
                <CollapsibleTrigger asChild>
                  <CardHeader className="py-2.5 px-4 cursor-pointer hover:bg-muted/30 transition-colors">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        Auto-Verified
                        {compliance.autoVerified.every(r => r.status === 'passed' || r.status === 'na') && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-profit" />
                        )}
                      </div>
                      {autoVerifiedOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="px-4 pb-3 pt-0">
                    <div className="space-y-1.5">
                      {compliance.autoVerified.map((rule) => (
                        <div
                          key={rule.id}
                          className={cn(
                            "flex items-center justify-between p-2 rounded-md text-sm",
                            rule.status === 'passed' && "bg-profit/5",
                            rule.status === 'failed' && "bg-loss/5",
                            (rule.status === 'pending' || rule.status === 'na') && "bg-muted/30"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {getStatusIcon(rule.status)}
                            <span className="font-medium">{rule.label}</span>
                          </div>
                          {rule.detail && (
                            <span className="text-xs text-muted-foreground">{rule.detail}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* Confirmation Rules */}
          {compliance.confirmationRules.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="py-2.5 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4 text-profit" />
                  Confirmations
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-1.5">
                  {compliance.confirmationRules.map(renderChecklistItem)}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Invalidation Rules */}
          {compliance.invalidationRules.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="py-2.5 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Ban className="h-4 w-4 text-loss" />
                  Invalidation Check
                  <span className="text-xs font-normal text-muted-foreground">
                    (check if NOT present)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-1.5">
                  {compliance.invalidationRules.map(renderChecklistItem)}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Checklist Questions */}
          {compliance.checklistQuestions.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="py-2.5 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" />
                  Checklist
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-1.5">
                  {compliance.checklistQuestions.map(renderChecklistItem)}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Management Tips - Compact */}
          {compliance.managementRules.length > 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="py-2.5 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  Management Tips
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <ul className="space-y-1">
                  {compliance.managementRules.map((rule, index) => (
                    <li key={index} className="text-sm flex items-start gap-2">
                      <span className="text-primary mt-1">•</span>
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Failure Modes Warning */}
          {compliance.failureModes.length > 0 && (
            <Card className="border-warning/30 bg-warning/5">
              <CardHeader className="py-2.5 px-4">
                <CardTitle className="text-sm flex items-center gap-2 text-warning">
                  <TriangleAlert className="h-4 w-4" />
                  Watch Out
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <ul className="space-y-1">
                  {compliance.failureModes.map((mode, index) => (
                    <li key={index} className="text-sm flex items-start gap-2">
                      <span className="text-warning mt-1">•</span>
                      <span>{mode}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Quick Note Input */}
          <div className="pt-2">
            <QuickNoteInput tradeId={trade.id} />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
