import * as React from "react";
import { CheckCircle2, Undo2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScalpEdgeReport, ScalpLookupResult, type ScalpReport, type ScalpCell } from "./ScalpEdgeReport";

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
  scalp_edge_report: "Scalp Edge Report",
  scalp_context_lookup: "Scalp Context Lookup",
};

export function AppliedChangeCard({ result, onUndo, isUndoing, isReverted }: AppliedChangeCardProps) {
  const label = TOOL_LABELS[result.tool] || result.tool;

  // Rich rendering for scalp tools
  if (result.success && result.tool === "scalp_edge_report" && result.change) {
    return <ScalpEdgeReport report={result.change as unknown as ScalpReport} />;
  }
  if (result.success && result.tool === "scalp_context_lookup" && result.change) {
    const c = result.change as { match: ScalpCell | null; matched_keys: number; query: Record<string, string> };
    return <ScalpLookupResult match={c.match} matched_keys={c.matched_keys} query={c.query} />;
  }


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
