import { TradingPattern } from "@/types/trading";
import { usePatternInsights } from "@/hooks/usePatternInsights";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, RefreshCw, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

interface PatternInsightsProps {
  accountId?: string;
}

function PatternItem({ pattern }: { pattern: TradingPattern }) {
  const isPositive = pattern.severity === 'positive';
  
  return (
    <div className={cn(
      "px-3 py-2 rounded-lg border text-sm",
      isPositive ? "bg-profit/5 border-profit/20" : "bg-loss/5 border-loss/20"
    )}>
      <div className="flex items-start gap-2">
        {isPositive ? (
          <TrendingUp className="w-4 h-4 text-profit mt-0.5 flex-shrink-0" />
        ) : (
          <TrendingDown className="w-4 h-4 text-loss mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium">{pattern.insight}</p>
          <p className="text-xs text-muted-foreground mt-1">{pattern.recommendation}</p>
        </div>
      </div>
    </div>
  );
}

export function PatternInsights({ accountId }: PatternInsightsProps) {
  const { data, isLoading, error, refetch, isFetching } = usePatternInsights(accountId);
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['pattern-insights'] });
    refetch();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Pattern Insights
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Pattern Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load patterns</p>
        </CardContent>
      </Card>
    );
  }

  const positivePatterns = data.patterns.filter(p => p.severity === 'positive').slice(0, 3);
  const negativePatterns = data.patterns.filter(p => p.severity === 'negative').slice(0, 3);

  if (data.patterns.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Pattern Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {data.summary.totalTradesAnalyzed < 3 
              ? "Need at least 3 trades to analyze patterns"
              : "No significant patterns detected yet"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Pattern Insights
          </CardTitle>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Based on {data.summary.totalTradesAnalyzed} trades
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {positivePatterns.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-profit uppercase tracking-wide">Strengths</h4>
            {positivePatterns.map((pattern, i) => (
              <PatternItem key={i} pattern={pattern} />
            ))}
          </div>
        )}
        
        {negativePatterns.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-loss uppercase tracking-wide">Weaknesses</h4>
            {negativePatterns.map((pattern, i) => (
              <PatternItem key={i} pattern={pattern} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
