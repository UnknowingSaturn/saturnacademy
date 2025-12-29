import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { AIAnalysisOutput, SimilarTrade } from "@/types/trading";

interface ComplianceResult {
  setup_compliance_score: number;
  context_alignment_score: number;
  rule_violations: string[];
  matched_rules: string[];
}

interface AnalysisResult {
  analysis: AIAnalysisOutput | null;
  compliance: ComplianceResult;
  similar_trades: {
    similar_winners: SimilarTrade[];
    similar_losers: SimilarTrade[];
  };
  raw_analysis: string;
}

export function useAIAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const analyzeTrade = async (tradeId: string): Promise<AnalysisResult | null> => {
    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-trade", {
        body: { trade_id: tradeId },
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
        return null;
      }

      const result: AnalysisResult = {
        analysis: data.analysis || null,
        compliance: data.compliance || {
          setup_compliance_score: 0,
          context_alignment_score: 0,
          rule_violations: [],
          matched_rules: [],
        },
        similar_trades: data.similar_trades || { similar_winners: [], similar_losers: [] },
        raw_analysis: data.raw_analysis || "",
      };

      setAnalysisResult(result);
      
      // Invalidate trades queries to refresh cache with new ai_review
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['trade', tradeId] });
      
      toast({ title: "Analysis Complete", description: "AI review has been generated." });
      return result;
    } catch (error) {
      console.error("AI analysis error:", error);
      toast({ 
        title: "Analysis Failed", 
        description: error instanceof Error ? error.message : "Could not analyze trade", 
        variant: "destructive" 
      });
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

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
    analysisResult, 
    setAnalysisResult,
    submitFeedback 
  };
}
