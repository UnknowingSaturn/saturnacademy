import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SimilarTrade {
  trade_id: string;
  similarity_score: number;
  net_pnl: number;
  r_multiple: number | null;
  symbol: string;
  session: string | null;
  entry_percentile: number | null;
}

// Normalize symbol to handle broker-specific suffixes like EURUSD+, EURUSD., EURUSDm
function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  return symbol
    .replace(/[\+\.]+$/, '')           // Remove trailing + or .
    .replace(/\d+$/, '')               // Remove trailing numbers
    .replace(/^(micro|mini|m\d?)/i, '') // Remove micro/mini prefixes
    .toUpperCase();
}

function calculateSimilarity(
  currentTrade: any,
  currentFeatures: any,
  currentReview: any,
  candidateTrade: any,
  candidateFeatures: any,
  candidateReview: any
): number {
  let score = 0;
  let maxScore = 0;

  // 1. Same symbol with normalization (high weight)
  maxScore += 30;
  const normalizedCurrent = normalizeSymbol(currentTrade.symbol);
  const normalizedCandidate = normalizeSymbol(candidateTrade.symbol);
  
  if (normalizedCandidate === normalizedCurrent) {
    score += 30;
  } else {
    // Partial credit for same asset class (first 3 chars of normalized symbol)
    const currentBase = normalizedCurrent.slice(0, 3);
    const candidateBase = normalizedCandidate.slice(0, 3);
    if (currentBase === candidateBase) {
      score += 15;
    }
  }

  // 2. Same session (high weight)
  maxScore += 25;
  if (candidateTrade.session === currentTrade.session) {
    score += 25;
  }

  // 3. Same direction
  maxScore += 10;
  if (candidateTrade.direction === currentTrade.direction) {
    score += 10;
  }

  // 4. Similar entry percentile (if available)
  if (currentFeatures?.entry_percentile != null && candidateFeatures?.entry_percentile != null) {
    maxScore += 20;
    const diff = Math.abs(currentFeatures.entry_percentile - candidateFeatures.entry_percentile);
    if (diff <= 10) {
      score += 20;
    } else if (diff <= 20) {
      score += 15;
    } else if (diff <= 30) {
      score += 10;
    } else if (diff <= 50) {
      score += 5;
    }
  }

  // 5. Same regime (from review)
  if (currentReview?.regime && candidateReview?.regime) {
    maxScore += 15;
    if (candidateReview.regime === currentReview.regime) {
      score += 15;
    }
  }

  // 6. Same day of week
  if (currentFeatures?.day_of_week != null && candidateFeatures?.day_of_week != null) {
    maxScore += 10;
    if (candidateFeatures.day_of_week === currentFeatures.day_of_week) {
      score += 10;
    }
  }

  // 7. Same playbook (check playbook_id on trades and reviews)
  const currentPlaybookId = currentTrade.playbook_id || currentReview?.playbook_id;
  const candidatePlaybookId = candidateTrade.playbook_id || candidateReview?.playbook_id;
  
  if (currentPlaybookId) {
    maxScore += 20;
    if (currentPlaybookId === candidatePlaybookId) {
      score += 20;
    }
  }

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}

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

    const { trade_id, limit = 10 } = await req.json();
    console.log("Finding similar trades for:", trade_id);

    // Fetch current trade with review and features
    const { data: currentTrade, error: tradeError } = await supabase
      .from("trades")
      .select(`
        *,
        trade_reviews (*),
        trade_features (*)
      `)
      .eq("id", trade_id)
      .single();

    if (tradeError || !currentTrade) {
      console.error("Trade fetch error:", tradeError);
      return new Response(
        JSON.stringify({ error: "Trade not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const currentReview = currentTrade.trade_reviews?.[0];
    const currentFeatures = currentTrade.trade_features?.[0];

    // Fetch candidate trades (closed trades from same user, excluding current)
    const { data: candidates, error: candidatesError } = await supabase
      .from("trades")
      .select(`
        *,
        trade_reviews (*),
        trade_features (*)
      `)
      .eq("user_id", currentTrade.user_id)
      .eq("is_open", false)
      .neq("id", trade_id)
      .order("exit_time", { ascending: false })
      .limit(100); // Get last 100 trades for comparison

    if (candidatesError) {
      console.error("Candidates fetch error:", candidatesError);
      return new Response(
        JSON.stringify({ error: candidatesError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ similar_winners: [], similar_losers: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate similarity for each candidate
    const scoredCandidates: (SimilarTrade & { isWinner: boolean })[] = candidates.map((candidate) => {
      const candidateReview = candidate.trade_reviews?.[0];
      const candidateFeatures = candidate.trade_features?.[0];
      
      const similarityScore = calculateSimilarity(
        currentTrade,
        currentFeatures,
        currentReview,
        candidate,
        candidateFeatures,
        candidateReview
      );

      return {
        trade_id: candidate.id,
        similarity_score: similarityScore,
        net_pnl: candidate.net_pnl || 0,
        r_multiple: candidate.r_multiple_actual,
        symbol: candidate.symbol,
        session: candidate.session,
        entry_percentile: candidateFeatures?.entry_percentile || null,
        isWinner: (candidate.net_pnl || 0) > 0,
      };
    });

    // Filter by minimum similarity threshold (30%)
    const qualifiedCandidates = scoredCandidates.filter(c => c.similarity_score >= 30);

    // Sort by similarity and split into winners/losers
    const winners = qualifiedCandidates
      .filter(c => c.isWinner)
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, limit);

    const losers = qualifiedCandidates
      .filter(c => !c.isWinner)
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, limit);

    console.log(`Found ${winners.length} similar winners, ${losers.length} similar losers`);

    return new Response(
      JSON.stringify({
        similar_winners: winners,
        similar_losers: losers,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Find similar trades error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
