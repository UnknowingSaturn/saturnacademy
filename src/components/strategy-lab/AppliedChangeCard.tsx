import * as React from "react";
import { CheckCircle2, Undo2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ToolResult {
  tool: string;
  success: boolean;
  message: string;
  change?: Record<string, unknown>;
}

interface AppliedChangeCardProps {
  result: ToolResult;
  onUndo?: () => void;
  isUndoing?: boolean;
  isReverted?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  update_playbook_rules: "Rule Update",
  update_risk_limits: "Risk Limits",
  update_filters: "Filters",
  add_checklist_question: "Checklist",
  update_playbook_description: "Description",
};

export function AppliedChangeCard({ result, onUndo, isUndoing, isReverted }: AppliedChangeCardProps) {
  const label = TOOL_LABELS[result.tool] || result.tool;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 my-2 text-sm",
        result.success
          ? isReverted
            ? "border-muted bg-muted/30"
            : "border-primary/20 bg-primary/5"
          : "border-destructive/20 bg-destructive/5"
      )}
    >
      {result.success ? (
        isReverted ? (
          <XCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        )
      ) : (
        <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          {isReverted && (
            <span className="text-xs text-muted-foreground">(reverted)</span>
          )}
        </div>
        <p className={cn("text-muted-foreground mt-0.5", isReverted && "line-through")}>
          {result.message}
        </p>
      </div>

      {result.success && onUndo && !isReverted && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 h-7 px-2 text-xs"
          onClick={onUndo}
          disabled={isUndoing}
        >
          {isUndoing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <Undo2 className="h-3 w-3 mr-1" />
              Undo
            </>
          )}
        </Button>
      )}
    </div>
  );
}

export function parseToolResults(content: string): { text: string; toolResults: ToolResult[] } {
  const toolResults: ToolResult[] = [];
  const cleanedText = content.replace(/\[TOOL_RESULT:(.*?)\]/g, (_, json) => {
    try {
      const parsed = JSON.parse(json);
      toolResults.push(parsed);
    } catch {
      // ignore
    }
    return "";
  }).replace(/\[PLAYBOOK_UPDATED\]/g, "").trim();

  return { text: cleanedText, toolResults };
}
