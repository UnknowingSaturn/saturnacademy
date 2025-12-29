import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Simplified AI Analysis hook - Database-First Architecture
 * 
 * This hook ONLY:
 * 1. Triggers the edge function to generate and save analysis
 * 2. Invalidates queries so UI reads fresh data from database
 * 3. Returns loading state
 * 
 * The UI should read analysis from trade.ai_review (database) - not from local state.
 */
export function useAIAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Generate AI analysis for a trade.
   * The analysis is automatically saved to the database by the edge function.
   * After completion, the UI should read from trade.ai_review.
   * 
   * @returns true if successful, false if failed
   */
  const analyzeTrade = async (tradeId: string): Promise<boolean> => {
    setIsAnalyzing(true);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-trade", {
        body: { trade_id: tradeId, save: true },
      });

      if (error) throw error;

      if (data.error) {
        if (data.error.includes("Rate limit")) {
          toast({ title: "Rate Limited", description: "Please wait a moment and try again.", variant: "destructive" });
        } else if (data.error.includes("credits")) {
          toast({ title: "Credits Exhausted", description: "Please add AI credits to your workspace.", variant: "destructive" });
        } else {
          throw new Error(data.error);
        }
        return false;
      }

      // Invalidate queries to refresh trade data from database
      // The trade object will now include the saved ai_review
      await queryClient.invalidateQueries({ queryKey: ['trades'] });
      await queryClient.invalidateQueries({ queryKey: ['trade', tradeId] });

      toast({ title: "Analysis Complete", description: "AI analysis has been saved." });
      return true;
    } catch (error) {
      console.error("AI analysis error:", error);
      toast({ 
        title: "Analysis Failed", 
        description: error instanceof Error ? error.message : "Could not analyze trade", 
        variant: "destructive" 
      });
      return false;
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * Submit feedback on an AI analysis
   */
  const submitFeedback = async (aiReviewId: string, isAccurate: boolean, isUseful: boolean, notes?: string) => {
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
  };

  return { 
    analyzeTrade, 
    isAnalyzing, 
    submitFeedback 
  };
}
