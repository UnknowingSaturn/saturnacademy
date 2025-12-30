import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export type AnalysisStep = 
  | "idle"
  | "features"
  | "compliance"
  | "similar"
  | "analysis"
  | "saving"
  | "complete"
  | "error";

export interface AnalysisProgress {
  step: AnalysisStep;
  message: string;
  error?: string;
}

/**
 * Enhanced AI Analysis hook with step-by-step orchestration
 * 
 * This hook orchestrates the analysis process from the client:
 * 1. Compute trade features
 * 2. Score compliance
 * 3. Find similar trades
 * 4. Generate and save AI analysis
 * 
 * Each step can fail independently with clear error messages.
 */
export function useAIAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress>({ step: "idle", message: "" });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const resetProgress = useCallback(() => {
    setProgress({ step: "idle", message: "" });
  }, []);

  /**
   * Generate AI analysis for a trade with step-by-step progress.
   * @returns true if successful, false if failed
   */
  const analyzeTrade = useCallback(async (tradeId: string): Promise<boolean> => {
    setIsAnalyzing(true);
    resetProgress();

    try {
      // Step 1: Compute features
      setProgress({ step: "features", message: "Computing trade features..." });
      let features = null;
      
      try {
        const { data: featuresData, error: featuresError } = await supabase.functions.invoke(
          "compute-trade-features",
          { body: { trade_id: tradeId } }
        );
        
        if (featuresError) {
          console.warn("Features computation failed:", featuresError);
        } else {
          features = featuresData?.features || featuresData;
        }
      } catch (e) {
        console.warn("Features step failed, continuing:", e);
      }

      // Step 2: Score compliance
      setProgress({ step: "compliance", message: "Scoring trade compliance..." });
      let compliance = null;
      
      try {
        const { data: complianceData, error: complianceError } = await supabase.functions.invoke(
          "score-trade-compliance",
          { body: { trade_id: tradeId } }
        );
        
        if (complianceError) {
          console.warn("Compliance scoring failed:", complianceError);
        } else {
          compliance = complianceData;
        }
      } catch (e) {
        console.warn("Compliance step failed, continuing:", e);
      }

      // Step 3: Find similar trades
      setProgress({ step: "similar", message: "Finding similar trades..." });
      let similarTrades = null;
      
      try {
        const { data: similarData, error: similarError } = await supabase.functions.invoke(
          "find-similar-trades",
          { body: { trade_id: tradeId, limit: 5 } }
        );
        
        if (similarError) {
          console.warn("Similar trades search failed:", similarError);
        } else {
          similarTrades = similarData;
        }
      } catch (e) {
        console.warn("Similar trades step failed, continuing:", e);
      }

      // Step 4: Generate AI analysis (pass pre-computed data)
      setProgress({ step: "analysis", message: "Generating AI analysis..." });
      
      const { data, error } = await supabase.functions.invoke("analyze-trade", {
        body: { 
          trade_id: tradeId, 
          save: true,
          features,
          compliance,
          similar_trades: similarTrades
        },
      });

      if (error) {
        throw new Error(error.message || "Analysis failed");
      }

      if (data?.error) {
        // Handle specific error types
        if (data.error.includes("Rate limit")) {
          setProgress({ step: "error", message: "Rate limited", error: data.error });
          toast({ title: "Rate Limited", description: "Please wait a moment and try again.", variant: "destructive" });
          return false;
        } else if (data.error.includes("credits")) {
          setProgress({ step: "error", message: "Credits exhausted", error: data.error });
          toast({ title: "Credits Exhausted", description: "Please add AI credits to your workspace.", variant: "destructive" });
          return false;
        } else {
          throw new Error(data.error);
        }
      }

      // Step 5: Invalidate queries
      setProgress({ step: "saving", message: "Refreshing data..." });
      await queryClient.invalidateQueries({ queryKey: ['trades'] });
      await queryClient.invalidateQueries({ queryKey: ['trade', tradeId] });

      // Complete
      setProgress({ step: "complete", message: "Analysis complete" });
      toast({ title: "Analysis Complete", description: "AI analysis has been saved." });
      return true;

    } catch (error) {
      console.error("AI analysis error:", error);
      const message = error instanceof Error ? error.message : "Could not analyze trade";
      setProgress({ step: "error", message: "Analysis failed", error: message });
      toast({ 
        title: "Analysis Failed", 
        description: message, 
        variant: "destructive" 
      });
      return false;
    } finally {
      setIsAnalyzing(false);
    }
  }, [toast, queryClient, resetProgress]);

  /**
   * Submit feedback on an AI analysis
   */
  const submitFeedback = useCallback(async (
    aiReviewId: string, 
    isAccurate: boolean, 
    isUseful: boolean, 
    notes?: string
  ) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("ai_feedback").insert({
        ai_review_id: aiReviewId,
        user_id: user.id,
        is_accurate: isAccurate,
        is_useful: isUseful,
        feedback_notes: notes || null,
      });

      if (error) throw error;

      toast({ title: "Feedback Submitted", description: "Thanks for helping improve the analysis." });
    } catch (error) {
      console.error("Feedback error:", error);
      toast({ 
        title: "Feedback Failed", 
        description: "Could not save your feedback", 
        variant: "destructive" 
      });
    }
  }, [toast]);

  /**
   * Retry analysis from a specific step
   */
  const retryAnalysis = useCallback(async (tradeId: string) => {
    return analyzeTrade(tradeId);
  }, [analyzeTrade]);

  return { 
    analyzeTrade, 
    isAnalyzing, 
    progress,
    resetProgress,
    submitFeedback,
    retryAnalysis
  };
}
