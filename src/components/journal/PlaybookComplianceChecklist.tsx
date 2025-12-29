import { Playbook } from "@/types/trading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { 
  Target,
  Ban,
  ListChecks,
  Lightbulb,
  TriangleAlert
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PlaybookComplianceChecklistProps {
  playbook: Playbook;
  checklistAnswers: Record<string, boolean>;
  onAnswerChange: (ruleId: string, checked: boolean) => void;
}

export function PlaybookComplianceChecklist({ 
  playbook, 
  checklistAnswers, 
  onAnswerChange 
}: PlaybookComplianceChecklistProps) {
  const confirmationRules = playbook.confirmation_rules || [];
  const invalidationRules = playbook.invalidation_rules || [];
  const checklistQuestions = playbook.checklist_questions || [];
  const managementRules = playbook.management_rules || [];
  const failureModes = playbook.failure_modes || [];

  const hasRules = confirmationRules.length > 0 || 
                   invalidationRules.length > 0 || 
                   checklistQuestions.length > 0;

  if (!hasRules && managementRules.length === 0 && failureModes.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No compliance rules defined for this playbook.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Confirmation Rules */}
      {confirmationRules.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-profit" />
              Confirmation Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="space-y-2">
              {confirmationRules.map((rule, index) => {
                const ruleId = `confirmation_${index}`;
                return (
                  <label
                    key={ruleId}
                    className={cn(
                      "flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors",
                      checklistAnswers[ruleId] ? "bg-profit/5" : "hover:bg-muted/50"
                    )}
                  >
                    <Checkbox
                      checked={checklistAnswers[ruleId] || false}
                      onCheckedChange={(checked) => onAnswerChange(ruleId, !!checked)}
                      className="mt-0.5"
                    />
                    <span className="text-sm">{rule}</span>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invalidation Rules */}
      {invalidationRules.length > 0 && (
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
              {invalidationRules.map((rule, index) => {
                const ruleId = `invalidation_${index}`;
                return (
                  <label
                    key={ruleId}
                    className={cn(
                      "flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors",
                      checklistAnswers[ruleId] ? "bg-profit/5" : "hover:bg-muted/50"
                    )}
                  >
                    <Checkbox
                      checked={checklistAnswers[ruleId] || false}
                      onCheckedChange={(checked) => onAnswerChange(ruleId, !!checked)}
                      className="mt-0.5"
                    />
                    <span className="text-sm">{rule}</span>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Checklist Questions */}
      {checklistQuestions.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              Checklist
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="space-y-2">
              {checklistQuestions
                .sort((a, b) => a.order - b.order)
                .map((q) => {
                  const ruleId = `checklist_${q.id}`;
                  return (
                    <label
                      key={ruleId}
                      className={cn(
                        "flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors",
                        checklistAnswers[ruleId] ? "bg-profit/5" : "hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={checklistAnswers[ruleId] || false}
                        onCheckedChange={(checked) => onAnswerChange(ruleId, !!checked)}
                        className="mt-0.5"
                      />
                      <span className="text-sm">{q.question}</span>
                    </label>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {(managementRules.length > 0 || failureModes.length > 0) && <Separator />}

      {/* Management Reminders */}
      {managementRules.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              Management Reminders
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <ul className="space-y-1.5">
              {managementRules.map((rule, index) => (
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
      {failureModes.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2 text-warning">
              <TriangleAlert className="h-4 w-4" />
              Watch Out For
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <ul className="space-y-1.5">
              {failureModes.map((mode, index) => (
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
  );
}
