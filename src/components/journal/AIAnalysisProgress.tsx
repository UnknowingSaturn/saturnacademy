import { AnalysisStep, AnalysisProgress } from "@/hooks/useAIAnalysis";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle, 
  Circle, 
  Loader2, 
  XCircle, 
  RefreshCw,
  Calculator,
  Scale,
  Search,
  Sparkles,
  Save
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AIAnalysisProgressProps {
  progress: AnalysisProgress;
  isAnalyzing: boolean;
  onRetry?: () => void;
}

const STEPS: { key: AnalysisStep; label: string; icon: React.ElementType }[] = [
  { key: "features", label: "Computing features", icon: Calculator },
  { key: "compliance", label: "Scoring compliance", icon: Scale },
  { key: "similar", label: "Finding similar trades", icon: Search },
  { key: "analysis", label: "Generating analysis", icon: Sparkles },
  { key: "saving", label: "Saving results", icon: Save },
];

function getStepIndex(step: AnalysisStep): number {
  const index = STEPS.findIndex(s => s.key === step);
  if (step === "complete") return STEPS.length;
  if (step === "error") return -1;
  return index;
}

function getProgressPercent(step: AnalysisStep): number {
  if (step === "idle") return 0;
  if (step === "complete") return 100;
  if (step === "error") return 0;
  
  const index = getStepIndex(step);
  return Math.round(((index + 1) / STEPS.length) * 100);
}

export function AIAnalysisProgress({ progress, isAnalyzing, onRetry }: AIAnalysisProgressProps) {
  const { step, message, error } = progress;
  const currentIndex = getStepIndex(step);
  const progressPercent = getProgressPercent(step);

  // Don't show if idle
  if (step === "idle" && !isAnalyzing) {
    return null;
  }

  return (
    <div className="space-y-4 p-4 border border-border rounded-lg bg-card">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{message}</span>
          <span>{progressPercent}%</span>
        </div>
        <Progress 
          value={progressPercent} 
          className={cn(
            "h-2",
            step === "error" && "bg-loss/20"
          )} 
        />
      </div>

      {/* Step indicators */}
      <div className="flex items-center justify-between">
        {STEPS.map((s, index) => {
          const Icon = s.icon;
          const isComplete = currentIndex > index || step === "complete";
          const isCurrent = currentIndex === index && isAnalyzing;
          const isError = step === "error" && currentIndex === index;
          const isPending = currentIndex < index;

          return (
            <div 
              key={s.key} 
              className={cn(
                "flex flex-col items-center gap-1",
                isPending && "opacity-40"
              )}
            >
              <div 
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                  isComplete && "bg-profit/20 text-profit",
                  isCurrent && "bg-primary/20 text-primary",
                  isError && "bg-loss/20 text-loss",
                  isPending && "bg-muted text-muted-foreground"
                )}
              >
                {isComplete ? (
                  <CheckCircle className="w-4 h-4" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isError ? (
                  <XCircle className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              <span className="text-[10px] text-center max-w-[60px] leading-tight">
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Error state with retry */}
      {step === "error" && error && (
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-sm text-loss">{error}</span>
          {onRetry && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onRetry}
              className="gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Success state */}
      {step === "complete" && (
        <div className="flex items-center gap-2 pt-2 border-t border-border text-profit">
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm font-medium">Analysis complete</span>
        </div>
      )}
    </div>
  );
}
