import { AIAnalysisOutput, SimilarTrade } from "@/types/trading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, XCircle, AlertTriangle, TrendingUp, TrendingDown, Brain, Target, ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

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
}

export function AIAnalysisDisplay({ analysis, compliance, similarTrades, onSubmitFeedback }: AIAnalysisDisplayProps) {
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
    <div className="space-y-4">
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

          {/* Actionable Guidance */}
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
}
