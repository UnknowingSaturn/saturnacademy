import { useState } from "react";
import { Trade, TradeReview, EmotionalState, RegimeType, NewsRisk, ChecklistQuestion, ActionableStep, TradeScreenshot } from "@/types/trading";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useCreateTradeReview, useUpdateTradeReview } from "@/hooks/useTrades";
import { useAIAnalysis } from "@/hooks/useAIAnalysis";
import { AIAnalysisDisplay } from "./AIAnalysisDisplay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ChevronDown, Plus, X, Sparkles, Loader2 } from "lucide-react";
import { TradeScreenshotGallery } from "./TradeScreenshotGallery";

interface TradeReviewPanelProps {
  trade: Trade;
}

const emotionalStates: EmotionalState[] = [
  "great", "good", "calm", "confident", "focused",
  "alright", "okay", "normal",
  "rough", "anxious", "fomo", "revenge", "tilted", "exhausted"
];

const emotionCategories = {
  positive: ["great", "good", "calm", "confident", "focused"],
  neutral: ["alright", "okay", "normal"],
  negative: ["rough", "anxious", "fomo", "revenge", "tilted", "exhausted"],
};

export function TradeReviewPanel({ trade }: TradeReviewPanelProps) {
  const { data: playbooks } = usePlaybooks();
  const createReview = useCreateTradeReview();
  const updateReview = useUpdateTradeReview();
  const { analyzeTrade, isAnalyzing, analysisResult, saveAIAnalysis, isSavingAnalysis, hasUnsavedAnalysis, submitFeedback } = useAIAnalysis();

  const existingReview = trade.review;

  const [playbookId, setPlaybookId] = useState(existingReview?.playbook_id || "");
  const [checklistAnswers, setChecklistAnswers] = useState<Record<string, boolean>>(existingReview?.checklist_answers || {});
  const [regime, setRegime] = useState<RegimeType | "">(existingReview?.regime || "");
  const [newsRisk, setNewsRisk] = useState<NewsRisk>(existingReview?.news_risk || "none");
  const [emotionBefore, setEmotionBefore] = useState<EmotionalState | "">(existingReview?.emotional_state_before || "");
  const [emotionAfter, setEmotionAfter] = useState<EmotionalState | "">(existingReview?.emotional_state_after || "");
  const [psychNotes, setPsychNotes] = useState(existingReview?.psychology_notes || "");
  const [mistakes, setMistakes] = useState<string[]>(existingReview?.mistakes || []);
  const [didWell, setDidWell] = useState<string[]>(existingReview?.did_well || []);
  const [toImprove, setToImprove] = useState<string[]>(existingReview?.to_improve || []);
  const [actionableSteps, setActionableSteps] = useState<ActionableStep[]>(existingReview?.actionable_steps || []);
  const [thoughts, setThoughts] = useState(existingReview?.thoughts || "");
  const [screenshots, setScreenshots] = useState<TradeScreenshot[]>(
    parseScreenshots(existingReview?.screenshots)
  );
  const [newItem, setNewItem] = useState({ mistakes: "", didWell: "", toImprove: "", actionable: "" });

  // Helper to parse screenshots from existing review (supports both old string[] and new TradeScreenshot[] formats)
  function parseScreenshots(data: unknown): TradeScreenshot[] {
    if (!data || !Array.isArray(data)) return [];
    
    return data.map((item) => {
      if (typeof item === 'string') {
        // Legacy format: plain URL string
        return {
          id: crypto.randomUUID(),
          timeframe: '15m' as const,
          url: item,
          description: '',
          created_at: new Date().toISOString(),
        };
      }
      // New format: TradeScreenshot object
      return item as TradeScreenshot;
    });
  }

  const selectedPlaybook = playbooks?.find(p => p.id === playbookId);

  // Calculate score
  const score = Object.values(checklistAnswers).filter(Boolean).length;

  const handleSave = async () => {
    const reviewData = {
      trade_id: trade.id,
      playbook_id: playbookId || null,
      checklist_answers: checklistAnswers,
      score,
      regime: regime || null,
      news_risk: newsRisk,
      emotional_state_before: emotionBefore || null,
      emotional_state_after: emotionAfter || null,
      psychology_notes: psychNotes || null,
      mistakes,
      did_well: didWell,
      to_improve: toImprove,
      actionable_steps: actionableSteps,
      thoughts: thoughts || null,
      screenshots,
      reviewed_at: new Date().toISOString(),
    };

    if (existingReview) {
      await updateReview.mutateAsync({ id: existingReview.id, ...reviewData });
    } else {
      await createReview.mutateAsync({ review: reviewData });
    }

    // Save AI analysis if there's unsaved analysis for this trade
    if (hasUnsavedAnalysis(trade.id)) {
      await saveAIAnalysis(trade.id);
    }
  };

  const addItem = (field: "mistakes" | "didWell" | "toImprove" | "actionable") => {
    const value = newItem[field].trim();
    if (!value) return;

    if (field === "actionable") {
      setActionableSteps([...actionableSteps, { text: value, completed: false }]);
    } else if (field === "mistakes") {
      setMistakes([...mistakes, value]);
    } else if (field === "didWell") {
      setDidWell([...didWell, value]);
    } else {
      setToImprove([...toImprove, value]);
    }
    setNewItem({ ...newItem, [field]: "" });
  };

  const removeItem = (field: "mistakes" | "didWell" | "toImprove", index: number) => {
    if (field === "mistakes") setMistakes(mistakes.filter((_, i) => i !== index));
    else if (field === "didWell") setDidWell(didWell.filter((_, i) => i !== index));
    else setToImprove(toImprove.filter((_, i) => i !== index));
  };

  const toggleActionable = (index: number) => {
    setActionableSteps(actionableSteps.map((step, i) => 
      i === index ? { ...step, completed: !step.completed } : step
    ));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Trade Details Summary */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Entry: </span>
          <span className="font-mono-numbers">{trade.entry_price}</span>
          <span className="text-muted-foreground"> @ </span>
          <span>{format(new Date(trade.entry_time), "MMM d, HH:mm")}</span>
        </div>
        {trade.exit_price && (
          <div>
            <span className="text-muted-foreground">Exit: </span>
            <span className="font-mono-numbers">{trade.exit_price}</span>
            {trade.exit_time && (
              <>
                <span className="text-muted-foreground"> @ </span>
                <span>{format(new Date(trade.exit_time), "MMM d, HH:mm")}</span>
              </>
            )}
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Lots: </span>
          <span className="font-mono-numbers">{trade.total_lots}</span>
        </div>
        {trade.sl_initial && (
          <div>
            <span className="text-muted-foreground">SL: </span>
            <span className="font-mono-numbers">{trade.sl_initial}</span>
          </div>
        )}
        {trade.tp_initial && (
          <div>
            <span className="text-muted-foreground">TP: </span>
            <span className="font-mono-numbers">{trade.tp_initial}</span>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Playbook Selection */}
          <div className="space-y-2">
            <Label>Playbook</Label>
            <Select value={playbookId} onValueChange={setPlaybookId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a playbook" />
              </SelectTrigger>
              <SelectContent>
                {playbooks?.map(pb => (
                  <SelectItem key={pb.id} value={pb.id}>{pb.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Playbook Checklist */}
          {selectedPlaybook && selectedPlaybook.checklist_questions.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Checklist</CardTitle>
                  <Badge variant={score >= 4 ? "default" : score >= 2 ? "secondary" : "destructive"}>
                    {score}/{selectedPlaybook.checklist_questions.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedPlaybook.checklist_questions
                  .sort((a, b) => a.order - b.order)
                  .map((q) => (
                    <div key={q.id} className="flex items-start gap-3">
                      <Checkbox
                        id={q.id}
                        checked={checklistAnswers[q.id] || false}
                        onCheckedChange={(checked) => 
                          setChecklistAnswers({ ...checklistAnswers, [q.id]: !!checked })
                        }
                      />
                      <Label 
                        htmlFor={q.id} 
                        className={cn(
                          "text-sm leading-relaxed cursor-pointer",
                          checklistAnswers[q.id] && "text-muted-foreground line-through"
                        )}
                      >
                        {q.question}
                      </Label>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Regime & News */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Market Regime</Label>
              <Select value={regime} onValueChange={(v) => setRegime(v as RegimeType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select regime" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rotational">Rotational</SelectItem>
                  <SelectItem value="transitional">Transitional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>News Risk</Label>
              <Select value={newsRisk} onValueChange={(v) => setNewsRisk(v as NewsRisk)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Psychology Section */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Psychology</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Before Trade</Label>
                  <Select value={emotionBefore} onValueChange={(v) => setEmotionBefore(v as EmotionalState)}>
                    <SelectTrigger>
                      <SelectValue placeholder="How did you feel?" />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="px-2 py-1 text-xs text-muted-foreground">Positive</div>
                      {emotionCategories.positive.map(e => (
                        <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
                      ))}
                      <div className="px-2 py-1 text-xs text-muted-foreground">Neutral</div>
                      {emotionCategories.neutral.map(e => (
                        <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
                      ))}
                      <div className="px-2 py-1 text-xs text-muted-foreground">Negative</div>
                      {emotionCategories.negative.map(e => (
                        <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">After Trade</Label>
                  <Select value={emotionAfter} onValueChange={(v) => setEmotionAfter(v as EmotionalState)}>
                    <SelectTrigger>
                      <SelectValue placeholder="How do you feel?" />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="px-2 py-1 text-xs text-muted-foreground">Positive</div>
                      {emotionCategories.positive.map(e => (
                        <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
                      ))}
                      <div className="px-2 py-1 text-xs text-muted-foreground">Neutral</div>
                      {emotionCategories.neutral.map(e => (
                        <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
                      ))}
                      <div className="px-2 py-1 text-xs text-muted-foreground">Negative</div>
                      {emotionCategories.negative.map(e => (
                        <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <Textarea 
                  value={psychNotes}
                  onChange={(e) => setPsychNotes(e.target.value)}
                  placeholder="What was your mindset? Any triggers?"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - ASR Sections */}
        <div className="space-y-4">
          {/* Mistakes */}
          <Collapsible defaultOpen>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-loss">Mistakes</CardTitle>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-2">
                  {mistakes.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{item}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem("mistakes", i)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input 
                      value={newItem.mistakes}
                      onChange={(e) => setNewItem({ ...newItem, mistakes: e.target.value })}
                      placeholder="Add a mistake..."
                      onKeyDown={(e) => e.key === "Enter" && addItem("mistakes")}
                    />
                    <Button variant="outline" size="icon" onClick={() => addItem("mistakes")}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* What I Did Well */}
          <Collapsible defaultOpen>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-profit">What I Did Well</CardTitle>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-2">
                  {didWell.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{item}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem("didWell", i)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input 
                      value={newItem.didWell}
                      onChange={(e) => setNewItem({ ...newItem, didWell: e.target.value })}
                      placeholder="Add something you did well..."
                      onKeyDown={(e) => e.key === "Enter" && addItem("didWell")}
                    />
                    <Button variant="outline" size="icon" onClick={() => addItem("didWell")}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* To Improve */}
          <Collapsible defaultOpen>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base text-breakeven">To Improve</CardTitle>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-2">
                  {toImprove.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{item}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem("toImprove", i)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input 
                      value={newItem.toImprove}
                      onChange={(e) => setNewItem({ ...newItem, toImprove: e.target.value })}
                      placeholder="Add something to improve..."
                      onKeyDown={(e) => e.key === "Enter" && addItem("toImprove")}
                    />
                    <Button variant="outline" size="icon" onClick={() => addItem("toImprove")}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Actionable Steps */}
          <Collapsible defaultOpen>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Actionable Steps</CardTitle>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-2">
                  {actionableSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Checkbox 
                        checked={step.completed} 
                        onCheckedChange={() => toggleActionable(i)}
                      />
                      <span className={cn("flex-1 text-sm", step.completed && "line-through text-muted-foreground")}>
                        {step.text}
                      </span>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6" 
                        onClick={() => setActionableSteps(actionableSteps.filter((_, idx) => idx !== i))}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input 
                      value={newItem.actionable}
                      onChange={(e) => setNewItem({ ...newItem, actionable: e.target.value })}
                      placeholder="Add an action item..."
                      onKeyDown={(e) => e.key === "Enter" && addItem("actionable")}
                    />
                    <Button variant="outline" size="icon" onClick={() => addItem("actionable")}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Screenshots */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Chart Screenshots</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {screenshots.length === 0 && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <Sparkles className="w-5 h-5 text-primary mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">Enable Visual AI Analysis</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Upload chart screenshots for AI to analyze entry/exit quality, stop placement, and verify confirmation signals
                    </p>
                  </div>
                </div>
              )}
              <TradeScreenshotGallery
                tradeId={trade.id}
                screenshots={screenshots}
                onScreenshotsChange={setScreenshots}
              />
            </CardContent>
          </Card>

          {/* Thoughts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Thoughts</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea 
                value={thoughts}
                onChange={(e) => setThoughts(e.target.value)}
                placeholder="Free-form reflections, notes, affirmations..."
                rows={4}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* AI Analysis Result */}
      {analysisResult && (
        <Card className="bg-muted/30 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              AI Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AIAnalysisDisplay
              analysis={analysisResult.analysis}
              compliance={analysisResult.compliance}
              similarTrades={analysisResult.similar_trades}
              onSubmitFeedback={(isAccurate, isUseful, notes) => {
                // Feedback submission handled in the component
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Save Button */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button 
          variant="outline" 
          className="gap-2"
          onClick={() => analyzeTrade(trade.id)}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {isAnalyzing ? "Analyzing..." : "AI Analysis"}
        </Button>
        <Button 
          onClick={handleSave} 
          disabled={createReview.isPending || updateReview.isPending || isSavingAnalysis}
          className="gap-2"
        >
          {(createReview.isPending || updateReview.isPending || isSavingAnalysis) && (
            <Loader2 className="w-4 h-4 animate-spin" />
          )}
          Save Review
          {hasUnsavedAnalysis(trade.id) && (
            <Badge variant="secondary" className="ml-1 text-xs">+ AI</Badge>
          )}
        </Button>
      </div>
    </div>
  );
}