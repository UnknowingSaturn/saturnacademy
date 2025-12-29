import { useState, useEffect } from "react";
import { Trade, TradeReview, EmotionalState, RegimeType, NewsRisk, ActionableStep, TradeScreenshot } from "@/types/trading";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { useCreateTradeReview, useUpdateTradeReview } from "@/hooks/useTrades";
import { useAIAnalysis } from "@/hooks/useAIAnalysis";
import { TradeChart } from "@/components/chart/TradeChart";
import { TradeProperties } from "./TradeProperties";
import { TradeScreenshotGallery } from "./TradeScreenshotGallery";
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
import { ArrowLeft, Plus, X, Sparkles, Loader2, Save, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  const [screenshots, setScreenshots] = useState<TradeScreenshot[]>(
    parseScreenshots(existingReview?.screenshots)
  );
  const [newItem, setNewItem] = useState({ mistakes: "", didWell: "", toImprove: "", actionable: "" });
  const [showProperties, setShowProperties] = useState(true); // Visible by default

  // Helper to parse screenshots from existing review (supports both old string[] and new TradeScreenshot[] formats)
  function parseScreenshots(data: unknown): TradeScreenshot[] {
    if (!data || !Array.isArray(data)) return [];
    
    return data.map((item, index) => {
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
      setScreenshots(parseScreenshots(trade.review.screenshots));
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
      setScreenshots([]);
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
      screenshots: screenshots,
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
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-5xl p-0 overflow-hidden"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <SheetTitle className="text-base font-semibold">
                  Trade #{trade.trade_number || "—"}
                </SheetTitle>
                <span className="text-xs text-muted-foreground">
                  {trade.symbol} • {format(new Date(trade.entry_time), "MMM d, HH:mm")}
                </span>
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
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setShowProperties(!showProperties)}
                    >
                      {showProperties ? (
                        <PanelRightClose className="h-4 w-4" />
                      ) : (
                        <PanelRightOpen className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {showProperties ? "Hide properties" : "Show properties"}
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => trade && analyzeTrade(trade.id)}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-1" />
                  )}
                  AI
                </Button>
                <Button size="sm" className="h-8" onClick={handleSave} disabled={createReview.isPending || updateReview.isPending}>
                  <Save className="h-4 w-4 mr-1" />
                  Save
                </Button>
              </div>
            </div>
          </SheetHeader>

          {/* Main Content */}
          <div className="flex flex-1 min-h-0">
            {/* Left Side - Scrollable Content */}
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-6">
                {/* Replay Chart */}
                <div className="rounded-lg border border-border bg-card/50 p-4">
                  <TradeChart trade={trade} />
                </div>

                {/* Screenshots */}
                <div>
                  <Label className="text-sm font-semibold mb-3 block">Screenshots</Label>
                  <TradeScreenshotGallery
                    tradeId={trade.id}
                    screenshots={screenshots}
                    onScreenshotsChange={setScreenshots}
                  />
                </div>

                <Separator />

                {/* Notes Section */}
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold mb-2 block">Psychology Notes</Label>
                    <Textarea
                      value={psychNotes}
                      onChange={(e) => setPsychNotes(e.target.value)}
                      placeholder="How were you feeling? What was your mental state?"
                      rows={3}
                      className="text-sm"
                    />
                  </div>

                  <div>
                    <Label className="text-sm font-semibold mb-2 block">General Thoughts</Label>
                    <Textarea
                      value={thoughts}
                      onChange={(e) => setThoughts(e.target.value)}
                      placeholder="General thoughts and reflections..."
                      rows={3}
                      className="text-sm"
                    />
                  </div>
                </div>

                {/* AI Analysis */}
                {analysisResult && (
                  <div>
                    <Label className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      AI Analysis
                    </Label>
                    <AIAnalysisDisplay
                      analysis={analysisResult.analysis}
                      compliance={analysisResult.compliance}
                      similarTrades={analysisResult.similar_trades}
                      onSubmitFeedback={(isAccurate, isUseful, notes) => {}}
                    />
                  </div>
                )}

                <Separator />

                {/* Review Section */}
                <div className="space-y-4">
                  {/* Mistakes */}
                  <div>
                    <Label className="text-loss text-sm font-semibold mb-2 block">Mistakes</Label>
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
                        className="h-8 text-sm"
                      />
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => addItem("mistakes")}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* What I Did Well */}
                  <div>
                    <Label className="text-profit text-sm font-semibold mb-2 block">What I Did Well</Label>
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
                        className="h-8 text-sm"
                      />
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => addItem("didWell")}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* To Improve */}
                  <div>
                    <Label className="text-breakeven text-sm font-semibold mb-2 block">To Improve</Label>
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
                        className="h-8 text-sm"
                      />
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => addItem("toImprove")}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  {/* Actionable Steps */}
                  <div>
                    <Label className="text-sm font-semibold mb-2 block">Actionable Steps</Label>
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
                        className="h-8 text-sm"
                      />
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => addItem("actionable")}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>

            {/* Right Sidebar - Properties */}
            {showProperties && (
              <div className="w-64 border-l border-border bg-muted/20 flex-shrink-0 overflow-auto">
                <div className="p-4">
                  <TradeProperties trade={trade} />
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
