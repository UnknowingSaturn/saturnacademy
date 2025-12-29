import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { trade_id, analysis, compliance, raw_analysis, similar_trades } = await req.json();
    
    if (!trade_id) {
      return new Response(
        JSON.stringify({ error: "trade_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Saving AI review for trade:", trade_id);

    const aiReviewData = {
      trade_id,
      technical_review: analysis?.technical_review || {},
      mistake_attribution: analysis?.mistake_attribution || {},
      psychology_analysis: analysis?.psychology_analysis || {},
      comparison_to_past: analysis?.comparison_to_past || {},
      actionable_guidance: analysis?.actionable_guidance || {},
      confidence: analysis?.confidence || "low",
      setup_compliance_score: compliance?.setup_compliance_score || 0,
      rule_violations: compliance?.rule_violations || [],
      context_alignment_score: compliance?.context_alignment_score || 0,
      similar_winners: similar_trades?.similar_winners?.map((t: any) => t.trade_id || t.id) || [],
      similar_losers: similar_trades?.similar_losers?.map((t: any) => t.trade_id || t.id) || [],
      raw_analysis: raw_analysis || "",
      updated_at: new Date().toISOString(),
    };

    const { data: savedReview, error: saveError } = await supabase
      .from("ai_reviews")
      .upsert(aiReviewData, { onConflict: "trade_id" })
      .select()
      .single();

    if (saveError) {
      console.error("Failed to save AI review:", saveError);
      return new Response(
        JSON.stringify({ error: "Failed to save AI review" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("AI review saved:", savedReview.id);

    return new Response(
      JSON.stringify({ saved_review: savedReview }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Save AI review error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
