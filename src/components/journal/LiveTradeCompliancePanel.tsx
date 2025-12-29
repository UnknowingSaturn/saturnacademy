import { useState, useEffect } from "react";
import { Trade, Playbook } from "@/types/trading";
import { useTradeCompliance, ComplianceRule } from "@/hooks/useTradeCompliance";
import { useCreateTradeReview, useUpdateTradeReview } from "@/hooks/useTrades";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  TriangleAlert
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveTradeCompliancePanelProps {
  trade: Trade;
  playbook: Playbook;
}

export function LiveTradeCompliancePanel({ trade, playbook }: LiveTradeCompliancePanelProps) {
  const existingReview = trade.review;
  const [manualAnswers, setManualAnswers] = useState<Record<string, boolean>>(
    existingReview?.checklist_answers || {}
  );
  
  const createReview = useCreateTradeReview();
  const updateReview = useUpdateTradeReview();

  const compliance = useTradeCompliance(trade, playbook, manualAnswers);

  // Auto-save when manual answers change
  useEffect(() => {
    const saveAnswers = async () => {
      if (Object.keys(manualAnswers).length === 0) return;
      
      const reviewData = {
        trade_id: trade.id,
        playbook_id: playbook.id,
        checklist_answers: manualAnswers,
        score: Object.values(manualAnswers).filter(Boolean).length,
      };

      if (existingReview) {
        await updateReview.mutateAsync({ id: existingReview.id, ...reviewData });
      } else {
        await createReview.mutateAsync(reviewData);
      }
    };

    const debounce = setTimeout(saveAnswers, 500);
    return () => clearTimeout(debounce);
  }, [manualAnswers]);

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
            All Rules Verified
          </Badge>
        );
      case 'violations':
        return (
          <Badge variant="outline" className="bg-loss/10 text-loss border-loss/30">
            <XCircle className="h-3 w-3 mr-1" />
            {compliance.violationCount} Violation{compliance.violationCount > 1 ? 's' : ''}
          </Badge>
        );
      case 'pending':
        return (
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
            <Clock className="h-3 w-3 mr-1" />
            Compliance Check In Progress
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with overall status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: playbook.color }}
          />
          <span className="font-semibold">{playbook.name}</span>
        </div>
        {getOverallBadge()}
      </div>

      <ScrollArea className="h-[calc(100vh-300px)]">
        <div className="space-y-4 pr-4">
          {/* Auto-Verified Section */}
          {compliance.autoVerified.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Auto-Verified
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-2">
                  {compliance.autoVerified.map((rule) => (
                    <div
                      key={rule.id}
                      className={cn(
                        "flex items-center justify-between p-2 rounded-md",
                        rule.status === 'passed' && "bg-profit/5",
                        rule.status === 'failed' && "bg-loss/5",
                        rule.status === 'pending' && "bg-muted/50",
                        rule.status === 'na' && "bg-muted/30"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {getStatusIcon(rule.status)}
                        <span className="text-sm font-medium">{rule.label}</span>
                      </div>
                      {rule.detail && (
                        <span className="text-xs text-muted-foreground">{rule.detail}</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Confirmation Rules */}
          {compliance.confirmationRules.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4 text-profit" />
                  Confirmation Rules
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-2">
                  {compliance.confirmationRules.map((rule) => (
                    <label
                      key={rule.id}
                      className={cn(
                        "flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors",
                        manualAnswers[rule.id] ? "bg-profit/5" : "hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={manualAnswers[rule.id] || false}
                        onCheckedChange={() => toggleAnswer(rule.id)}
                        className="mt-0.5"
                      />
                      <span className="text-sm">{rule.label}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Invalidation Rules */}
          {compliance.invalidationRules.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Ban className="h-4 w-4 text-loss" />
                  Invalidation Check
                  <span className="text-xs font-normal text-muted-foreground">
                    (check if NOT present)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-2">
                  {compliance.invalidationRules.map((rule) => (
                    <label
                      key={rule.id}
                      className={cn(
                        "flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors",
                        manualAnswers[rule.id] ? "bg-profit/5" : "hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={manualAnswers[rule.id] || false}
                        onCheckedChange={() => toggleAnswer(rule.id)}
                        className="mt-0.5"
                      />
                      <span className="text-sm">{rule.label}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Checklist Questions */}
          {compliance.checklistQuestions.length > 0 && (
            <Card className="border-border/50">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" />
                  Checklist
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="space-y-2">
                  {compliance.checklistQuestions.map((rule) => (
                    <label
                      key={rule.id}
                      className={cn(
                        "flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors",
                        manualAnswers[rule.id] ? "bg-profit/5" : "hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={manualAnswers[rule.id] || false}
                        onCheckedChange={() => toggleAnswer(rule.id)}
                        className="mt-0.5"
                      />
                      <span className="text-sm">{rule.label}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* Management Reminders */}
          {compliance.managementRules.length > 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  Management Reminders
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <ul className="space-y-1.5">
                  {compliance.managementRules.map((rule, index) => (
                    <li key={index} className="text-sm flex items-start gap-2">
                      <span className="text-primary">•</span>
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
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2 text-warning">
                  <TriangleAlert className="h-4 w-4" />
                  Watch Out For
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <ul className="space-y-1.5">
                  {compliance.failureModes.map((mode, index) => (
                    <li key={index} className="text-sm flex items-start gap-2">
                      <span className="text-warning">•</span>
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
