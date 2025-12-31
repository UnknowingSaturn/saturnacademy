import { AIAnalysisOutput, SimilarTrade } from "@/types/trading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, XCircle, AlertTriangle, TrendingUp, TrendingDown, Brain, Target, ThumbsUp, ThumbsDown, Eye, Lightbulb, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, forwardRef } from "react";

interface AIAnalysisDisplayProps {
  analysis: AIAnalysisOutput | null;
  compliance: {
    setup_compliance_score: number;
    context_alignment_score: number;
    rule_violations: string[];
    matched_rules: string[];
  };
  similarTrades: {
    similar_winners: SimilarTrade[];
    similar_losers: SimilarTrade[];
  };
  onSubmitFeedback?: (isAccurate: boolean, isUseful: boolean, notes?: string) => void;
  onReanalyze?: () => void;
  hasScreenshots?: boolean;
}

export const AIAnalysisDisplay = forwardRef<HTMLDivElement, AIAnalysisDisplayProps>(
  function AIAnalysisDisplay({ analysis, compliance, similarTrades, onSubmitFeedback, onReanalyze, hasScreenshots }, ref) {
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [accuracyVote, setAccuracyVote] = useState<boolean | null>(null);
  const [usefulVote, setUsefulVote] = useState<boolean | null>(null);

  const handleSubmitFeedback = () => {
    if (accuracyVote !== null && usefulVote !== null && onSubmitFeedback) {
      onSubmitFeedback(accuracyVote, usefulVote, feedbackNotes || undefined);
      setFeedbackGiven(true);
    }
  };

  return (
    <div ref={ref} className="space-y-4">
      {/* Compliance Scores */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="w-4 h-4" />
            Compliance Scores
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>Setup Compliance</span>
              <span className="font-medium">{compliance.setup_compliance_score}%</span>
            </div>
            <Progress value={compliance.setup_compliance_score} className="h-2" />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span>Context Alignment</span>
              <span className="font-medium">{compliance.context_alignment_score}%</span>
            </div>
            <Progress value={compliance.context_alignment_score} className="h-2" />
          </div>

          {compliance.matched_rules.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">Matched Rules:</p>
              <div className="flex flex-wrap gap-1">
                {compliance.matched_rules.map((rule, i) => (
                  <Badge key={i} variant="outline" className="text-xs bg-profit/10 text-profit border-profit/20">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    {rule}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {compliance.rule_violations.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">Violations:</p>
              <div className="flex flex-wrap gap-1">
                {compliance.rule_violations.map((violation, i) => (
                  <Badge key={i} variant="outline" className="text-xs bg-loss/10 text-loss border-loss/20">
                    <XCircle className="w-3 h-3 mr-1" />
                    {violation}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Analysis */}
      {analysis && (
        <>
          {/* Technical Review */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Technical Review</CardTitle>
                <Badge variant={analysis.technical_review.failure_type === 'none' ? 'default' : 'secondary'}>
                  {analysis.technical_review.failure_type === 'none' ? 'Clean Trade' : 
                   analysis.technical_review.failure_type === 'structural' ? 'Setup Issue' :
                   analysis.technical_review.failure_type === 'execution' ? 'Execution Issue' : 'Both'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {analysis.technical_review.deviations.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Deviations:</p>
                  <ul className="space-y-1">
                    {analysis.technical_review.deviations.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-loss">
                        <XCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.technical_review.matched_rules.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Followed:</p>
                  <ul className="space-y-1">
                    {analysis.technical_review.matched_rules.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-profit">
                        <CheckCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Thesis Evaluation - Key insight: was the trade idea right? */}
          {analysis.thesis_evaluation && (
            <Card className={cn(
              analysis.thesis_evaluation.thesis_correct ? "border-profit/30 bg-profit/5" : "border-loss/30 bg-loss/5"
            )}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Trade Thesis
                  </CardTitle>
                  <Badge variant={analysis.thesis_evaluation.thesis_correct ? "default" : "destructive"}>
                    {analysis.thesis_evaluation.thesis_correct ? "Thesis Correct" : "Thesis Wrong"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <p>{analysis.thesis_evaluation.thesis_explanation}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Failure Category:</span>
                  <Badge variant="outline" className={cn(
                    "text-xs",
                    analysis.thesis_evaluation.failure_category === "no_failure" && "bg-profit/10 text-profit border-profit/20",
                    analysis.thesis_evaluation.failure_category === "thesis_wrong" && "bg-loss/10 text-loss border-loss/20",
                    analysis.thesis_evaluation.failure_category === "execution_failure" && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                    analysis.thesis_evaluation.failure_category === "external_factor" && "bg-blue-500/10 text-blue-600 border-blue-500/20"
                  )}>
                    {analysis.thesis_evaluation.failure_category === "no_failure" ? "No Failure" :
                     analysis.thesis_evaluation.failure_category === "thesis_wrong" ? "Wrong Thesis" :
                     analysis.thesis_evaluation.failure_category === "execution_failure" ? "Execution Failure" :
                     "External Factor"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Mistake Attribution */}
          {analysis.mistake_attribution.primary && (
            <Card className="border-loss/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-loss" />
                  Mistake Attribution
                  {analysis.mistake_attribution.is_recurring && (
                    <Badge variant="destructive" className="text-xs">Recurring</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p><strong>Primary:</strong> {analysis.mistake_attribution.primary}</p>
                {analysis.mistake_attribution.secondary.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Contributing factors:</p>
                    <ul className="list-disc list-inside text-muted-foreground">
                      {analysis.mistake_attribution.secondary.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Psychology Analysis */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Brain className="w-4 h-4" />
                Psychology Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p><strong>Influence:</strong> {analysis.psychology_analysis.influence}</p>
              <p><strong>Pattern:</strong> {analysis.psychology_analysis.past_correlation}</p>
              <p className="text-xs text-muted-foreground">
                Impact: {analysis.psychology_analysis.psychology_vs_structure === 'psychology' ? 'Primarily psychological' :
                        analysis.psychology_analysis.psychology_vs_structure === 'structure' ? 'Primarily structural' :
                        analysis.psychology_analysis.psychology_vs_structure === 'both' ? 'Both equally' : 'Neither significant'}
              </p>
            </CardContent>
          </Card>

          {/* Comparison to Past */}
          {(analysis.comparison_to_past.differs_from_winners.length > 0 || 
            analysis.comparison_to_past.resembles_losers.length > 0) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Historical Comparison</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                {analysis.comparison_to_past.differs_from_winners.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-profit" />
                      Differs from winners:
                    </p>
                    <ul className="space-y-1 text-muted-foreground">
                      {analysis.comparison_to_past.differs_from_winners.map((d, i) => (
                        <li key={i}>• {d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.comparison_to_past.resembles_losers.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3 text-loss" />
                      Resembles losers:
                    </p>
                    <ul className="space-y-1 text-muted-foreground">
                      {analysis.comparison_to_past.resembles_losers.map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Visual Chart Analysis */}
          {analysis.visual_analysis && (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Visual Chart Analysis
                  <Badge variant="outline" className="ml-auto text-xs">
                    From Screenshots
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Entry Quality:</p>
                  <p>{analysis.visual_analysis.entry_quality}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Exit Quality:</p>
                  <p>{analysis.visual_analysis.exit_quality}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Stop Placement:</p>
                  <p>{analysis.visual_analysis.stop_placement}</p>
                </div>
                {analysis.visual_analysis.confirmations_visible?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Confirmations Verified:</p>
                    <div className="flex flex-wrap gap-1">
                      {analysis.visual_analysis.confirmations_visible.map((conf, i) => (
                        <Badge key={i} variant="outline" className="text-xs bg-profit/10 text-profit border-profit/20">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {conf}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.visual_analysis.chart_observations?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Chart Observations:</p>
                    <ul className="space-y-1 text-muted-foreground">
                      {analysis.visual_analysis.chart_observations.map((obs, i) => (
                        <li key={i}>• {obs}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Screenshots Warning - Different message based on whether screenshots exist */}
          {analysis.screenshots_analyzed === false && (
            <Card className={cn(
              "border-dashed",
              hasScreenshots ? "border-amber-500/50 bg-amber-500/10" : "border-muted-foreground/30 bg-muted/20"
            )}>
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ImageOff className={cn("w-5 h-5", hasScreenshots ? "text-amber-500" : "text-muted-foreground")} />
                  <div className="text-sm">
                    {hasScreenshots ? (
                      <>
                        <p className="font-medium text-amber-600">Screenshots exist but weren't analyzed</p>
                        <p className="text-xs text-muted-foreground">This analysis was generated before screenshots were saved. Re-run for visual analysis.</p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-muted-foreground">No chart screenshots analyzed</p>
                        <p className="text-xs text-muted-foreground">Add screenshots for deeper visual analysis of entry/exit quality</p>
                      </>
                    )}
                  </div>
                </div>
                {hasScreenshots && onReanalyze && (
                  <Button size="sm" variant="outline" onClick={onReanalyze} className="shrink-0">
                    Re-analyze
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Strategy Refinement Suggestions */}
          {analysis.strategy_refinement && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  Strategy Refinement Suggestions
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                {analysis.strategy_refinement.rule_suggestion && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Suggested Rule:</p>
                    <p className="font-medium">{analysis.strategy_refinement.rule_suggestion}</p>
                  </div>
                )}
                {analysis.strategy_refinement.filter_recommendation && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Filter Recommendation:</p>
                    <p className="text-loss">{analysis.strategy_refinement.filter_recommendation}</p>
                  </div>
                )}
                {analysis.strategy_refinement.edge_observation && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Observed Edge:</p>
                    <p className="text-profit">{analysis.strategy_refinement.edge_observation}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="w-4 h-4" />
                Actionable Guidance
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Rule to reinforce:</p>
                <p className="font-medium">{analysis.actionable_guidance.rule_to_reinforce}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Avoid when:</p>
                <p className="font-medium text-loss">{analysis.actionable_guidance.avoid_condition}</p>
              </div>
            </CardContent>
          </Card>

          {/* Confidence & Feedback */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Analysis confidence:</span>
                  <Badge variant={
                    analysis.confidence === 'high' ? 'default' :
                    analysis.confidence === 'medium' ? 'secondary' : 'outline'
                  }>
                    {analysis.confidence}
                  </Badge>
                </div>

                {!feedbackGiven && onSubmitFeedback && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Accurate?</span>
                      <Button
                        variant={accuracyVote === true ? "default" : "outline"}
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setAccuracyVote(true)}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button
                        variant={accuracyVote === false ? "destructive" : "outline"}
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setAccuracyVote(false)}
                      >
                        <ThumbsDown className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Useful?</span>
                      <Button
                        variant={usefulVote === true ? "default" : "outline"}
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setUsefulVote(true)}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button
                        variant={usefulVote === false ? "destructive" : "outline"}
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setUsefulVote(false)}
                      >
                        <ThumbsDown className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {feedbackGiven && (
                  <Badge variant="outline" className="text-profit">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Feedback submitted
                  </Badge>
                )}
              </div>

              {!feedbackGiven && accuracyVote !== null && usefulVote !== null && (
                <div className="mt-3 space-y-2">
                  <Textarea
                    placeholder="Optional: Add notes about the analysis..."
                    value={feedbackNotes}
                    onChange={(e) => setFeedbackNotes(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                  <Button size="sm" onClick={handleSubmitFeedback}>
                    Submit Feedback
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Similar Trades Summary */}
      {(similarTrades.similar_winners.length > 0 || similarTrades.similar_losers.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Similar Trades Used</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            {similarTrades.similar_winners.length > 0 && (
              <p className="text-profit">
                {similarTrades.similar_winners.length} similar winning trades analyzed
              </p>
            )}
            {similarTrades.similar_losers.length > 0 && (
              <p className="text-loss">
                {similarTrades.similar_losers.length} similar losing trades analyzed
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
});
