import { useState, useEffect } from "react";
import { Trade, TradeReview, EmotionalState, RegimeType, NewsRisk, ActionableStep } from "@/types/trading";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useCreateTradeReview, useUpdateTradeReview } from "@/hooks/useTrades";
import { useAIAnalysis } from "@/hooks/useAIAnalysis";
import { TradeChart } from "@/components/chart/TradeChart";
import { TradeProperties } from "./TradeProperties";
import { TradeComments } from "./TradeComments";
import { AIAnalysisDisplay } from "./AIAnalysisDisplay";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowLeft, Plus, X, Sparkles, Loader2, Save } from "lucide-react";

interface TradeDetailPanelProps {
  trade: Trade | null;
  isOpen: boolean;
  onClose: () => void;
}

export function TradeDetailPanel({ trade, isOpen, onClose }: TradeDetailPanelProps) {
  const { data: playbooks } = usePlaybooks();
  const createReview = useCreateTradeReview();
  const updateReview = useUpdateTradeReview();
  const { analyzeTrade, isAnalyzing, analysisResult, submitFeedback } = useAIAnalysis();

  const existingReview = trade?.review;

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
  const [newItem, setNewItem] = useState({ mistakes: "", didWell: "", toImprove: "", actionable: "" });

  // Reset state when trade changes
  useEffect(() => {
    if (trade?.review) {
      setPlaybookId(trade.review.playbook_id || "");
      setChecklistAnswers(trade.review.checklist_answers || {});
      setRegime(trade.review.regime || "");
      setNewsRisk(trade.review.news_risk || "none");
      setEmotionBefore(trade.review.emotional_state_before || "");
      setEmotionAfter(trade.review.emotional_state_after || "");
      setPsychNotes(trade.review.psychology_notes || "");
      setMistakes(trade.review.mistakes || []);
      setDidWell(trade.review.did_well || []);
      setToImprove(trade.review.to_improve || []);
      setActionableSteps(trade.review.actionable_steps || []);
      setThoughts(trade.review.thoughts || "");
    } else {
      // Reset to defaults when no review
      setPlaybookId("");
      setChecklistAnswers({});
      setRegime("");
      setNewsRisk("none");
      setEmotionBefore("");
      setEmotionAfter("");
      setPsychNotes("");
      setMistakes([]);
      setDidWell([]);
      setToImprove([]);
      setActionableSteps([]);
      setThoughts("");
    }
  }, [trade?.id, trade?.review]);

  const score = Object.values(checklistAnswers).filter(Boolean).length;

  const handleSave = async () => {
    if (!trade) return;

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
      screenshots: existingReview?.screenshots || [],
      reviewed_at: new Date().toISOString(),
    };

    if (existingReview) {
      await updateReview.mutateAsync({ id: existingReview.id, ...reviewData });
    } else {
      await createReview.mutateAsync(reviewData);
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
    setActionableSteps(
      actionableSteps.map((step, i) => (i === index ? { ...step, completed: !step.completed } : step))
    );
  };

  const removeActionable = (index: number) => {
    setActionableSteps(actionableSteps.filter((_, i) => i !== index));
  };

  if (!trade) return null;

  const pnl = trade.net_pnl || 0;

  return (
    <Sheet open={isOpen} onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-4xl p-0 overflow-hidden">
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="px-6 py-4 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <SheetTitle className="text-lg font-semibold">
                  Trade #{trade.trade_number || "—"}
                </SheetTitle>
                <span
                  className={cn(
                    "text-sm font-bold px-2 py-0.5 rounded",
                    pnl > 0 && "bg-profit/15 text-profit",
                    pnl < 0 && "bg-loss/15 text-loss",
                    pnl === 0 && "bg-muted text-muted-foreground"
                  )}
                >
                  {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => trade && analyzeTrade(trade.id)}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  AI Analysis
                </Button>
                <Button size="sm" onClick={handleSave} disabled={createReview.isPending || updateReview.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="flex">
              {/* Main Content */}
              <div className="flex-1 p-6 space-y-6">
                {/* Chart Section */}
                <div className="rounded-lg border border-border bg-card/50 p-4">
                  <TradeChart trade={trade} />
                </div>

                {/* Comments Section */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Comments</h3>
                  <TradeComments tradeId={trade.id} />
                </div>

                <Separator />

                {/* Psychology Section */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Psychology</h3>
                  <div className="space-y-3">
                    {psychNotes.split("\n").filter(Boolean).map((note, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-muted-foreground">•</span>
                        <span>{note}</span>
                      </div>
                    ))}
                    <Textarea
                      value={psychNotes}
                      onChange={(e) => setPsychNotes(e.target.value)}
                      placeholder="Add psychology notes..."
                      rows={2}
                      className="mt-2"
                    />
                  </div>
                </div>

                <Separator />

                {/* ASR Section */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">ASR</h3>
                  
                  {/* Mistakes */}
                  <div className="mb-4">
                    <Label className="text-loss text-xs font-semibold mb-2 block">Mistakes</Label>
                    <div className="space-y-1">
                      {mistakes.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm bg-loss/5 px-3 py-1.5 rounded border border-loss/20">
                          <span className="flex-1">{item}</span>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeItem("mistakes", i)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={newItem.mistakes}
                        onChange={(e) => setNewItem({ ...newItem, mistakes: e.target.value })}
                        placeholder="Add a mistake..."
                        onKeyDown={(e) => e.key === "Enter" && addItem("mistakes")}
                        className="h-8"
                      />
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => addItem("mistakes")}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* What I Did Well */}
                  <div className="mb-4">
                    <Label className="text-profit text-xs font-semibold mb-2 block">What I Did Well</Label>
                    <div className="space-y-1">
                      {didWell.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm bg-profit/5 px-3 py-1.5 rounded border border-profit/20">
                          <span className="flex-1">{item}</span>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeItem("didWell", i)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={newItem.didWell}
                        onChange={(e) => setNewItem({ ...newItem, didWell: e.target.value })}
                        placeholder="Add something you did well..."
                        onKeyDown={(e) => e.key === "Enter" && addItem("didWell")}
                        className="h-8"
                      />
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => addItem("didWell")}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* To Improve */}
                  <div className="mb-4">
                    <Label className="text-breakeven text-xs font-semibold mb-2 block">To Improve</Label>
                    <div className="space-y-1">
                      {toImprove.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm bg-breakeven/5 px-3 py-1.5 rounded border border-breakeven/20">
                          <span className="flex-1">{item}</span>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeItem("toImprove", i)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={newItem.toImprove}
                        onChange={(e) => setNewItem({ ...newItem, toImprove: e.target.value })}
                        placeholder="Add something to improve..."
                        onKeyDown={(e) => e.key === "Enter" && addItem("toImprove")}
                        className="h-8"
                      />
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => addItem("toImprove")}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Actionable Steps */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Actionable Steps</h3>
                  <div className="space-y-2">
                    {actionableSteps.map((step, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Checkbox
                          checked={step.completed}
                          onCheckedChange={() => toggleActionable(i)}
                        />
                        <span className={cn("flex-1 text-sm", step.completed && "line-through text-muted-foreground")}>
                          {step.text}
                        </span>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeActionable(i)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={newItem.actionable}
                      onChange={(e) => setNewItem({ ...newItem, actionable: e.target.value })}
                      placeholder="Add an actionable step..."
                      onKeyDown={(e) => e.key === "Enter" && addItem("actionable")}
                      className="h-8"
                    />
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => addItem("actionable")}>
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Thoughts */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Thoughts</h3>
                  <Textarea
                    value={thoughts}
                    onChange={(e) => setThoughts(e.target.value)}
                    placeholder="General thoughts and reflections..."
                    rows={4}
                  />
                </div>

                {/* AI Analysis Section */}
                {analysisResult && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        AI Analysis
                      </h3>
                      <AIAnalysisDisplay
                        analysis={analysisResult.analysis}
                        compliance={analysisResult.compliance}
                        similarTrades={analysisResult.similar_trades}
                        onSubmitFeedback={(isAccurate, isUseful, notes) => {
                          // TODO: Get AI review ID from response
                          // submitFeedback(aiReviewId, isAccurate, isUseful, notes);
                        }}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Right Sidebar - Properties */}
              <div className="w-72 border-l border-border p-4 bg-muted/20 flex-shrink-0">
                <TradeProperties trade={trade} />
              </div>
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
