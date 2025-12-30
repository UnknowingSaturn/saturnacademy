import { useState, useEffect } from "react";
import { Trade, TradeReview, EmotionalState, RegimeType, NewsRisk, ActionableStep, TradeScreenshot } from "@/types/trading";
import { usePlaybooks, usePlaybook } from "@/hooks/usePlaybooks";
import { useCreateTradeReview, useUpdateTradeReview, useTrade } from "@/hooks/useTrades";
import { useAIAnalysis } from "@/hooks/useAIAnalysis";
import { aiReviewToDisplayFormat, hasAIAnalysis } from "@/lib/aiAnalysisUtils";

import { TradeProperties } from "./TradeProperties";
import { TradeScreenshotGallery } from "./TradeScreenshotGallery";
import { AIAnalysisDisplay } from "./AIAnalysisDisplay";
import { AIAnalysisProgress } from "./AIAnalysisProgress";
import { RuleComplianceAlert } from "@/components/playbooks/RuleComplianceAlert";
import { PlaybookComplianceChecklist } from "./PlaybookComplianceChecklist";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ArrowLeft, Plus, X, Sparkles, Loader2, Save, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TradeDetailPanelProps {
  tradeId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function TradeDetailPanel({ tradeId, isOpen, onClose }: TradeDetailPanelProps) {
  // Fetch fresh trade data by ID - ensures we always have the latest including ai_review
  const { data: trade, isLoading: isLoadingTrade } = useTrade(tradeId ?? undefined);
  
  const { data: playbooks } = usePlaybooks();
  const createReview = useCreateTradeReview();
  const updateReview = useUpdateTradeReview();
  const { analyzeTrade, isAnalyzing, progress, resetProgress, submitFeedback, retryAnalysis } = useAIAnalysis();
  
  // Database-first: read AI analysis directly from trade object
  const aiReview = trade?.ai_review;
  const analysisData = aiReview ? aiReviewToDisplayFormat(aiReview) : null;

  const existingReview = trade?.review;
  // Use trade.playbook_id (set via Model property) for compliance checklist
  const selectedPlaybook = playbooks?.find(p => p.id === trade?.playbook_id);

  // Track last trade ID to detect actual trade switches vs data refreshes
  const [lastTradeId, setLastTradeId] = useState<string | null>(null);

  // Remove playbookId state - Model in TradeProperties handles playbook selection
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

  // Reset lastTradeId when panel closes so reopening triggers a fresh load
  useEffect(() => {
    if (!isOpen) {
      setLastTradeId(null);
    }
  }, [isOpen]);

  // Reset manual review state when trade changes
  useEffect(() => {
    const isTradeSwitch = trade?.id !== lastTradeId;
    
    // Only reset when switching to a different trade
    if (isTradeSwitch) {
      setLastTradeId(trade?.id || null);
      
      // Reset manual review fields from database
      if (trade?.review) {
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
    }
  }, [trade?.id, trade?.review, lastTradeId]);

  // No need for AI review sync effect - we read directly from trade.ai_review

  const score = Object.values(checklistAnswers).filter(Boolean).length;

  const handleSave = async () => {
    if (!trade) return;

    // Save manual review only - AI analysis is auto-saved when generated
    const reviewData = {
      trade_id: trade.id,
      playbook_id: trade.playbook_id || null,
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
      await createReview.mutateAsync({ review: reviewData });
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

  // Show loading state while fetching trade
  if (isLoadingTrade || !trade) {
    return (
      <Sheet open={isOpen} onOpenChange={() => onClose()}>
        <SheetContent 
          side="right" 
          className="w-full sm:max-w-5xl p-0 overflow-hidden"
          aria-describedby={undefined}
        >
          <div className="flex flex-col h-full">
            <SheetHeader className="px-4 py-3 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <SheetTitle className="text-base font-semibold">
                  {isLoadingTrade ? "Loading..." : "Trade not found"}
                </SheetTitle>
              </div>
            </SheetHeader>
            {isLoadingTrade && (
              <div className="p-6 space-y-4">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const pnl = trade.net_pnl || 0;

  return (
    <Sheet open={isOpen} onOpenChange={() => onClose()}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-5xl p-0 overflow-hidden"
        aria-describedby={undefined}
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
                <Tooltip>
                  <TooltipTrigger asChild>
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
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Generate AI analysis</p>
                  </TooltipContent>
                </Tooltip>
                <Button 
                  size="sm" 
                  className="h-8" 
                  onClick={handleSave} 
                  disabled={createReview.isPending || updateReview.isPending || isAnalyzing}
                >
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
                {/* Rule Compliance Alert */}
                {selectedPlaybook && (
                  <RuleComplianceAlert 
                    trade={trade} 
                    review={existingReview} 
                    playbook={selectedPlaybook} 
                  />
                )}


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

                {/* Compliance Checklist - shows when Model is selected via TradeProperties */}
                {selectedPlaybook && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-2.5 h-2.5 rounded-full" 
                        style={{ backgroundColor: selectedPlaybook.color }} 
                      />
                      <Label className="text-sm font-semibold">{selectedPlaybook.name} Checklist</Label>
                    </div>
                    <PlaybookComplianceChecklist
                      playbook={selectedPlaybook}
                      checklistAnswers={checklistAnswers}
                      onAnswerChange={(ruleId, checked) => 
                        setChecklistAnswers(prev => ({ ...prev, [ruleId]: checked }))
                      }
                    />
                  </div>
                )}

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

                </div>

                {/* AI Analysis Progress - shows during analysis */}
                {(isAnalyzing || progress.step !== "idle") && (
                  <AIAnalysisProgress 
                    progress={progress} 
                    isAnalyzing={isAnalyzing}
                    onRetry={() => trade && retryAnalysis(trade.id)}
                  />
                )}

                {/* AI Analysis - reads directly from database via trade.ai_review */}
                {analysisData && !isAnalyzing && progress.step !== "error" && (
                  <div>
                    <Label className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      AI Analysis
                    </Label>
                    <AIAnalysisDisplay
                      analysis={analysisData.analysis}
                      compliance={analysisData.compliance}
                      similarTrades={analysisData.similarTrades}
                      onSubmitFeedback={aiReview ? 
                        (isAccurate, isUseful, notes) => submitFeedback(aiReview.id, isAccurate, isUseful, notes) 
                        : undefined
                      }
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
