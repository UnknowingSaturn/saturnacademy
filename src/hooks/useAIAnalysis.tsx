import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export function useAIAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const { toast } = useToast();

  const analyzeTrade = async (tradeId: string) => {
    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-trade", {
        body: { trade_id: tradeId, analysis_type: "trade" },
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

      setAnalysis(data.analysis);
      return data.analysis;
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

  return { analyzeTrade, isAnalyzing, analysis, setAnalysis };
}