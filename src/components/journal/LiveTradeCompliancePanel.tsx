import { useState, useEffect, useRef } from "react";
import { Trade, Playbook } from "@/types/trading";
import { useTradeCompliance, ComplianceRule } from "@/hooks/useTradeCompliance";
import { useUpsertTradeReview } from "@/hooks/useTrades";
import { useLiveTrades } from "@/contexts/LiveTradesContext";
import { useUserSettings } from "@/hooks/useUserSettings";
import { LiveTradeQuestion, DEFAULT_LIVE_TRADE_QUESTIONS } from "@/types/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  ChevronRight,
  MessageSquare,
  Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ComplianceScoreRing } from "@/components/live/ComplianceScoreRing";

interface LiveTradeCompliancePanelProps {
  trade: Trade;
  playbook: Playbook;
}

export function LiveTradeCompliancePanel({ trade, playbook }: LiveTradeCompliancePanelProps) {
  const { 
    getComplianceState, 
    updateManualAnswers,
    registerPendingSave,
    unregisterPendingSave
  } = useLiveTrades();
  
  const { data: userSettings } = useUserSettings();
  const liveQuestions: LiveTradeQuestion[] = userSettings?.live_trade_questions || DEFAULT_LIVE_TRADE_QUESTIONS;
  
  const existingReview = trade.review;
  const cachedState = getComplianceState(trade.id);
  
  const [manualAnswers, setManualAnswers] = useState<Record<string, boolean>>(
    cachedState?.manualAnswers || existingReview?.checklist_answers || {}
  );
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>(
    cachedState?.questionAnswers || {}
  );
  const [autoVerifiedOpen, setAutoVerifiedOpen] = useState(false);
  
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upsertReview = useUpsertTradeReview();

  const compliance = useTradeCompliance(trade, playbook, manualAnswers);

  // Calculate score
  const totalRules = compliance.confirmationRules.length + 
    compliance.invalidationRules.length + 
    compliance.checklistQuestions.length;
  const completedRules = [...compliance.confirmationRules, ...compliance.invalidationRules, ...compliance.checklistQuestions]
    .filter(r => r.status === 'passed').length;

  // Load existing question answers from review
  useEffect(() => {
    if (existingReview && !cachedState?.questionAnswers) {
      const loaded: Record<string, string> = {};
      if (existingReview.emotional_state_before) loaded['emotional_state'] = existingReview.emotional_state_before;
      if (existingReview.thoughts) loaded['entry_reasoning'] = existingReview.thoughts;
      if (existingReview.psychology_notes) loaded['market_context'] = existingReview.psychology_notes;
      if (Object.keys(loaded).length > 0) setQuestionAnswers(loaded);
    }
  }, [existingReview, cachedState]);

  // Sync manual answers to context when they change
  useEffect(() => {
    if (Object.keys(manualAnswers).length > 0) {
      updateManualAnswers(trade.id, manualAnswers);
    }
  }, [manualAnswers, trade.id, updateManualAnswers]);

  // Auto-collapse auto-verified if all pass
  useEffect(() => {
    const allPassed = compliance.autoVerified.every(r => r.status === 'passed' || r.status === 'na');
    setAutoVerifiedOpen(!allPassed);
  }, [compliance.autoVerified]);

  // Auto-save checklist answers (debounced)
  useEffect(() => {
    if (Object.keys(manualAnswers).length === 0) return;
    if (upsertReview.isPending) return;
    
    registerPendingSave(trade.id, 'compliance');
    
    pendingSaveRef.current = setTimeout(async () => {
      const reviewData = {
        trade_id: trade.id,
        playbook_id: playbook.id,
        checklist_answers: manualAnswers,
        score: Object.values(manualAnswers).filter(Boolean).length,
        ...(existingReview && {
          regime: existingReview.regime,
          emotional_state_before: existingReview.emotional_state_before,
          psychology_notes: existingReview.psychology_notes,
          screenshots: existingReview.screenshots,
        }),
      };

      try {
        await upsertReview.mutateAsync({ review: reviewData, silent: true });
        unregisterPendingSave(trade.id, 'compliance');
      } catch {
        unregisterPendingSave(trade.id, 'compliance');
      }
    }, 500);
    
    return () => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    };
  }, [manualAnswers, trade.id, playbook.id, existingReview, upsertReview.isPending, registerPendingSave, unregisterPendingSave]);

  // Auto-save question answers (debounced)
  useEffect(() => {
    if (Object.keys(questionAnswers).length === 0) return;
    
    registerPendingSave(trade.id, 'questions');
    
    questionSaveRef.current = setTimeout(async () => {
      const reviewData: any = {
        trade_id: trade.id,
        playbook_id: playbook.id,
      };
      
      if (questionAnswers['emotional_state']) {
        reviewData.emotional_state_before = questionAnswers['emotional_state'];
      }
      if (questionAnswers['entry_reasoning']) {
        reviewData.thoughts = questionAnswers['entry_reasoning'];
      }
      if (questionAnswers['market_context']) {
        reviewData.psychology_notes = questionAnswers['market_context'];
      }

      try {
        await upsertReview.mutateAsync({ review: reviewData, silent: true });
        unregisterPendingSave(trade.id, 'questions');
      } catch {
        unregisterPendingSave(trade.id, 'questions');
      }
    }, 800);
    
    return () => {
      if (questionSaveRef.current) clearTimeout(questionSaveRef.current);
    };
  }, [questionAnswers, trade.id, playbook.id, registerPendingSave, unregisterPendingSave]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      if (pendingSaveRef.current) {
        clearTimeout(pendingSaveRef.current);
        if (Object.keys(manualAnswers).length > 0) {
          upsertReview.mutate({
            review: {
              trade_id: trade.id,
              playbook_id: playbook.id,
              checklist_answers: manualAnswers,
              score: Object.values(manualAnswers).filter(Boolean).length,
            },
            silent: true,
          });
        }
        unregisterPendingSave(trade.id, 'compliance');
      }
      if (questionSaveRef.current) {
        clearTimeout(questionSaveRef.current);
        unregisterPendingSave(trade.id, 'questions');
      }
    };
  }, [manualAnswers, trade.id, playbook.id]);

  const toggleAnswer = (ruleId: string) => {
    setManualAnswers(prev => ({
      ...prev,
      [ruleId]: !prev[ruleId],
    }));
  };

  const updateQuestionAnswer = (questionId: string, value: string) => {
    setQuestionAnswers(prev => ({ ...prev, [questionId]: value }));
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

  const renderQuestion = (q: LiveTradeQuestion) => {
    const value = questionAnswers[q.id] || '';
    
    return (
      <div key={q.id} className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">{q.label}</label>
        {q.type === 'select' && q.options ? (
          <Select value={value} onValueChange={v => updateQuestionAnswer(q.id, v)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {q.options.map(opt => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : q.type === 'rating' ? (
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => updateQuestionAnswer(q.id, String(n))}
                className={cn(
                  "h-9 w-9 rounded-md border transition-colors flex items-center justify-center",
                  value === String(n) 
                    ? "bg-primary text-primary-foreground border-primary" 
                    : "border-border hover:bg-muted/50"
                )}
              >
                <Star className={cn("h-4 w-4", value === String(n) ? "fill-current" : "")} />
              </button>
            ))}
          </div>
        ) : (
          <Textarea
            value={value}
            onChange={e => updateQuestionAnswer(q.id, e.target.value)}
            placeholder="Type here..."
            className="min-h-[60px] resize-none text-sm"
          />
        )}
      </div>
    );
  };

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

          {/* Live Trade Journal Questions */}
          {liveQuestions.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="py-2.5 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  Trade Journal
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-3">
                  {liveQuestions.map(renderQuestion)}
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
        </div>
      </ScrollArea>
    </div>
  );
}
