import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Trade, TradeReview, EmotionalState, RegimeType, NewsRisk, ActionableStep, TradeScreenshot } from "@/types/trading";
import { usePlaybooks, usePlaybook } from "@/hooks/usePlaybooks";
import { useCreateTradeReview, useUpdateTradeReview, useTrade } from "@/hooks/useTrades";
import { useAIAnalysis } from "@/hooks/useAIAnalysis";
import { aiReviewToDisplayFormat, hasAIAnalysis } from "@/lib/aiAnalysisUtils";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusIndicator } from "./SaveStatusIndicator";

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
import { ArrowLeft, Plus, X, Sparkles, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TradeDetailPanelProps {
  tradeId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface ReviewData {
  checklistAnswers: Record<string, boolean>;
  regime: RegimeType | "";
  newsRisk: NewsRisk;
  emotionBefore: EmotionalState | "";
  emotionAfter: EmotionalState | "";
  psychNotes: string;
  mistakes: string[];
  didWell: string[];
  toImprove: string[];
  actionableSteps: ActionableStep[];
  thoughts: string;
  screenshots: TradeScreenshot[];
}

// Helper to parse screenshots from existing review
function parseScreenshots(data: unknown): TradeScreenshot[] {
  if (!data || !Array.isArray(data)) return [];
  
  return data.map((item) => {
    if (typeof item === 'string') {
      return {
        id: crypto.randomUUID(),
        timeframe: '15m' as const,
        url: item,
        description: '',
        created_at: new Date().toISOString(),
      };
    }
    return item as TradeScreenshot;
  });
}

function getInitialReviewData(review?: TradeReview): ReviewData {
  return {
    checklistAnswers: review?.checklist_answers || {},
    regime: review?.regime || "",
    newsRisk: review?.news_risk || "none",
    emotionBefore: review?.emotional_state_before || "",
    emotionAfter: review?.emotional_state_after || "",
    psychNotes: review?.psychology_notes || "",
    mistakes: review?.mistakes || [],
    didWell: review?.did_well || [],
    toImprove: review?.to_improve || [],
    actionableSteps: review?.actionable_steps || [],
    thoughts: review?.thoughts || "",
    screenshots: parseScreenshots(review?.screenshots),
  };
}

export function TradeDetailPanel({ tradeId, isOpen, onClose }: TradeDetailPanelProps) {
  const { data: trade, isLoading: isLoadingTrade } = useTrade(tradeId ?? undefined);
  
  const { data: playbooks } = usePlaybooks();
  const createReview = useCreateTradeReview();
  const updateReview = useUpdateTradeReview();
  const { analyzeTrade, isAnalyzing, progress, resetProgress, submitFeedback, retryAnalysis } = useAIAnalysis();
  
  const [immediateAiReview, setImmediateAiReview] = useState<any>(null);
  const aiReview = immediateAiReview || trade?.ai_review;
  const analysisData = aiReview ? aiReviewToDisplayFormat(aiReview) : null;

  const existingReview = trade?.review;
  const selectedPlaybook = playbooks?.find(p => p.id === trade?.playbook_id);
  const existingReviewIdRef = useRef<string | null>(null);

  const [lastTradeId, setLastTradeId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<ReviewData>(getInitialReviewData());
  const [newItem, setNewItem] = useState({ mistakes: "", didWell: "", toImprove: "", actionable: "" });
  const [showProperties, setShowProperties] = useState(true);

  // Save function for auto-save
  const saveReview = useCallback(async (data: ReviewData) => {
    if (!trade) return;

    const score = Object.values(data.checklistAnswers).filter(Boolean).length;
    const reviewPayload = {
      trade_id: trade.id,
      playbook_id: trade.playbook_id || null,
      checklist_answers: data.checklistAnswers,
      score,
      regime: data.regime || null,
      news_risk: data.newsRisk,
      emotional_state_before: data.emotionBefore || null,
      emotional_state_after: data.emotionAfter || null,
      psychology_notes: data.psychNotes || null,
      mistakes: data.mistakes,
      did_well: data.didWell,
      to_improve: data.toImprove,
      actionable_steps: data.actionableSteps,
      thoughts: data.thoughts || null,
      screenshots: data.screenshots,
      reviewed_at: new Date().toISOString(),
    };

    if (existingReviewIdRef.current) {
      await updateReview.mutateAsync({ id: existingReviewIdRef.current, ...reviewPayload, silent: true });
    } else {
      const result = await createReview.mutateAsync({ review: reviewPayload, silent: true });
      if (result.data?.id) {
        existingReviewIdRef.current = result.data.id;
      }
    }
  }, [trade, createReview, updateReview]);

  const { status: saveStatus, flush, hasUnsavedChanges, hasDraft, restoreDraft, clearDraft } = useAutoSave(
    reviewData,
    saveReview,
    { 
      enabled: !!trade && isOpen,
      storageKey: trade?.id ? `trade_review_draft_${trade.id}` : undefined
    }
  );

  // Check for draft recovery when trade loads
  useEffect(() => {
    if (trade && hasDraft) {
      const draft = restoreDraft();
      if (draft) {
        // Show recovery option - for now auto-restore
        setReviewData(draft);
        clearDraft();
      }
    }
  }, [trade?.id, hasDraft, restoreDraft, clearDraft]);

  // Reset state when trade changes
  useEffect(() => {
    const isTradeSwitch = trade?.id !== lastTradeId;
    
    if (isTradeSwitch && trade) {
      setLastTradeId(trade.id);
      setImmediateAiReview(null);
      existingReviewIdRef.current = trade.review?.id || null;
      setReviewData(getInitialReviewData(trade.review));
    }
  }, [trade?.id, trade?.review, lastTradeId]);

  // Reset lastTradeId when panel closes
  useEffect(() => {
    if (!isOpen) {
      setLastTradeId(null);
    }
  }, [isOpen]);

  // Handle close - don't await, localStorage is the safety net
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      flush(); // Fire and forget - localStorage has the backup
    }
    onClose();
  }, [hasUnsavedChanges, flush, onClose]);

  // Auto-reset progress after analysis completes
  useEffect(() => {
    if (progress.step === "complete" && analysisData) {
      const timeout = setTimeout(() => resetProgress(), 500);
      return () => clearTimeout(timeout);
    }
  }, [progress.step, analysisData, resetProgress]);

  // Helper functions for managing review data
  const updateField = useCallback(<K extends keyof ReviewData>(field: K, value: ReviewData[K]) => {
    setReviewData(prev => ({ ...prev, [field]: value }));
  }, []);

  const addItem = (field: "mistakes" | "didWell" | "toImprove" | "actionable") => {
    const value = newItem[field].trim();
    if (!value) return;

    if (field === "actionable") {
      updateField("actionableSteps", [...reviewData.actionableSteps, { text: value, completed: false }]);
    } else if (field === "mistakes") {
      updateField("mistakes", [...reviewData.mistakes, value]);
    } else if (field === "didWell") {
      updateField("didWell", [...reviewData.didWell, value]);
    } else {
      updateField("toImprove", [...reviewData.toImprove, value]);
    }
    setNewItem({ ...newItem, [field]: "" });
  };

  const removeItem = (field: "mistakes" | "didWell" | "toImprove", index: number) => {
    if (field === "mistakes") updateField("mistakes", reviewData.mistakes.filter((_, i) => i !== index));
    else if (field === "didWell") updateField("didWell", reviewData.didWell.filter((_, i) => i !== index));
    else updateField("toImprove", reviewData.toImprove.filter((_, i) => i !== index));
  };

  const toggleActionable = (index: number) => {
    updateField(
      "actionableSteps",
      reviewData.actionableSteps.map((step, i) => (i === index ? { ...step, completed: !step.completed } : step))
    );
  };

  const removeActionable = (index: number) => {
    updateField("actionableSteps", reviewData.actionableSteps.filter((_, i) => i !== index));
  };

  // Loading state
  if (isLoadingTrade || !trade) {
    return (
      <Sheet open={isOpen} onOpenChange={() => handleClose()}>
        <SheetContent 
          side="right" 
          className="w-full sm:max-w-5xl p-0 overflow-hidden"
          aria-describedby={undefined}
        >
          <div className="flex flex-col h-full">
            <SheetHeader className="px-4 py-3 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
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
    <Sheet open={isOpen} onOpenChange={() => handleClose()}>
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
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
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
              <div className="flex items-center gap-2">
                <SaveStatusIndicator status={saveStatus} onRetry={flush} />
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
                      onClick={async () => {
                        if (!trade) return;
                        const result = await analyzeTrade(trade.id);
                        if (result) {
                          setImmediateAiReview(result);
                        }
                      }}
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
                    screenshots={reviewData.screenshots}
                    onScreenshotsChange={(screenshots) => updateField("screenshots", screenshots)}
                  />
                </div>

                <Separator />

                {/* Compliance Checklist */}
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
                      checklistAnswers={reviewData.checklistAnswers}
                      onAnswerChange={(ruleId, checked) => 
                        updateField("checklistAnswers", { ...reviewData.checklistAnswers, [ruleId]: checked })
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
                      value={reviewData.psychNotes}
                      onChange={(e) => updateField("psychNotes", e.target.value)}
                      placeholder="How were you feeling? What was your mental state?"
                      rows={3}
                      className="text-sm"
                    />
                  </div>
                </div>

                {/* AI Analysis Progress */}
                {isAnalyzing && (
                  <AIAnalysisProgress 
                    progress={progress} 
                    isAnalyzing={isAnalyzing}
                    onRetry={() => trade && retryAnalysis(trade.id)}
                  />
                )}

                {/* AI Analysis */}
                {analysisData && (
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
                      {reviewData.mistakes.map((item, i) => (
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
                      {reviewData.didWell.map((item, i) => (
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
                      {reviewData.toImprove.map((item, i) => (
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
                      {reviewData.actionableSteps.map((step, i) => (
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
