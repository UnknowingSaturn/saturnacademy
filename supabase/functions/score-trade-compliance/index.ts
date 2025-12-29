import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PlaybookRules {
  valid_regimes: string[];
  entry_zone_rules: {
    min_percentile?: number;
    max_percentile?: number;
    require_htf_alignment?: boolean;
  };
  confirmation_rules: string[];
  invalidation_rules: string[];
  management_rules: string[];
  failure_modes: string[];
  session_filter: string[] | null;
  symbol_filter: string[] | null;
}

interface ComplianceResult {
  setup_compliance_score: number;
  context_alignment_score: number;
  rule_violations: string[];
  matched_rules: string[];
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

function scoreCompliance(
  trade: any,
  review: any,
  playbook: PlaybookRules | null,
  features: any
): ComplianceResult {
  const violations: string[] = [];
  const matched: string[] = [];
  let compliancePoints = 0;
  let maxPoints = 0;

  if (!playbook) {
    return {
      setup_compliance_score: 0,
      context_alignment_score: 0,
      rule_violations: ["No playbook assigned to trade"],
      matched_rules: [],
    };
  }

  // 1. Check session filter
  if (playbook.session_filter && playbook.session_filter.length > 0) {
    maxPoints += 20;
    if (trade.session && playbook.session_filter.includes(trade.session)) {
      compliancePoints += 20;
      matched.push(`Trade in valid session: ${trade.session}`);
    } else {
      violations.push(`Session ${trade.session || 'unknown'} not in allowed sessions: ${playbook.session_filter.join(', ')}`);
    }
  }

  // 2. Check symbol filter with normalization
  if (playbook.symbol_filter && playbook.symbol_filter.length > 0) {
    maxPoints += 10;
    const normalizedTradeSymbol = normalizeSymbol(trade.symbol);
    const symbolMatch = playbook.symbol_filter.some(
      (s: string) => normalizeSymbol(s) === normalizedTradeSymbol
    );
    
    if (symbolMatch) {
      compliancePoints += 10;
      matched.push(`Symbol ${trade.symbol} matches allowed list`);
    } else {
      violations.push(`Symbol ${trade.symbol} not in allowed symbols: ${playbook.symbol_filter.join(', ')}`);
    }
  }

  // 3. Check regime alignment
  if (playbook.valid_regimes && playbook.valid_regimes.length > 0) {
    maxPoints += 20;
    if (review?.regime && playbook.valid_regimes.includes(review.regime)) {
      compliancePoints += 20;
      matched.push(`Regime ${review.regime} matches playbook`);
    } else if (review?.regime) {
      violations.push(`Regime ${review.regime} not in valid regimes: ${playbook.valid_regimes.join(', ')}`);
    } else {
      violations.push("No regime specified for trade");
    }
  }

  // 4. Check entry zone rules
  if (playbook.entry_zone_rules && features?.entry_percentile != null) {
    const rules = playbook.entry_zone_rules;
    
    if (rules.min_percentile != null || rules.max_percentile != null) {
      maxPoints += 25;
      const entryPct = features.entry_percentile;
      const minOk = rules.min_percentile == null || entryPct >= rules.min_percentile;
      const maxOk = rules.max_percentile == null || entryPct <= rules.max_percentile;
      
      if (minOk && maxOk) {
        compliancePoints += 25;
        matched.push(`Entry at ${entryPct.toFixed(1)}% within allowed zone`);
      } else {
        violations.push(`Entry at ${entryPct.toFixed(1)}% outside allowed zone (${rules.min_percentile || 0}-${rules.max_percentile || 100}%)`);
      }
    }

    if (rules.require_htf_alignment && features.htf_bias) {
      maxPoints += 15;
      const htfAligned = 
        (trade.direction === 'buy' && features.htf_bias === 'bull') ||
        (trade.direction === 'sell' && features.htf_bias === 'bear');
      
      if (htfAligned) {
        compliancePoints += 15;
        matched.push(`Direction aligned with HTF bias: ${features.htf_bias}`);
      } else {
        violations.push(`Trade direction ${trade.direction} against HTF bias: ${features.htf_bias}`);
      }
    }
  }

  // 5. Check news risk
  if (review?.news_risk === 'high') {
    maxPoints += 10;
    violations.push("Traded during high news risk period");
  } else if (review?.news_risk === 'none' || review?.news_risk === 'low') {
    maxPoints += 10;
    compliancePoints += 10;
    matched.push("Appropriate news risk level");
  }

  // 6. Check checklist completion (from review)
  if (review?.checklist_answers && Object.keys(review.checklist_answers).length > 0) {
    const answers = review.checklist_answers;
    const totalQuestions = Object.keys(answers).length;
    const passedQuestions = Object.values(answers).filter(v => v === true).length;
    
    maxPoints += 20;
    const checklistScore = (passedQuestions / totalQuestions) * 20;
    compliancePoints += checklistScore;
    
    if (passedQuestions < totalQuestions) {
      const failedCount = totalQuestions - passedQuestions;
      violations.push(`${failedCount} checklist item(s) failed`);
    } else {
      matched.push("All checklist items passed");
    }
  }

  // Calculate context alignment based on time and volatility
  let contextPoints = 0;
  let maxContextPoints = 0;

  // Time of day suitability
  if (features?.time_since_session_open_mins != null) {
    maxContextPoints += 30;
    const mins = features.time_since_session_open_mins;
    // First 30 mins often choppy, optimal 30-120 mins into session
    if (mins >= 30 && mins <= 120) {
      contextPoints += 30;
    } else if (mins > 120 && mins <= 180) {
      contextPoints += 20;
    } else if (mins > 0 && mins < 30) {
      contextPoints += 10;
    }
  }

  // Day of week suitability (avoid Mondays/Fridays)
  if (features?.day_of_week != null) {
    maxContextPoints += 20;
    const dow = features.day_of_week;
    if (dow >= 2 && dow <= 4) { // Tue-Thu
      contextPoints += 20;
    } else if (dow === 1 || dow === 5) { // Mon/Fri
      contextPoints += 10;
    }
  }

  // Execution quality contributes to context
  if (features?.entry_efficiency != null) {
    maxContextPoints += 25;
    contextPoints += (features.entry_efficiency / 100) * 25;
  }

  if (features?.stop_location_quality != null) {
    maxContextPoints += 25;
    contextPoints += (features.stop_location_quality / 100) * 25;
  }

  const complianceScore = maxPoints > 0 ? Math.round((compliancePoints / maxPoints) * 100) : 0;
  const contextScore = maxContextPoints > 0 ? Math.round((contextPoints / maxContextPoints) * 100) : 0;

  return {
    setup_compliance_score: complianceScore,
    context_alignment_score: contextScore,
    rule_violations: violations,
    matched_rules: matched,
  };
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

    const { trade_id } = await req.json();
    console.log("Scoring compliance for trade:", trade_id);

    // Fetch trade with review and playbook
    const { data: trade, error: tradeError } = await supabase
      .from("trades")
      .select(`
        *,
        trade_reviews (
          *,
          playbook:playbooks (*)
        )
      `)
      .eq("id", trade_id)
      .single();

    if (tradeError || !trade) {
      console.error("Trade fetch error:", tradeError);
      return new Response(
        JSON.stringify({ error: "Trade not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch trade features
    const { data: features } = await supabase
      .from("trade_features")
      .select("*")
      .eq("trade_id", trade_id)
      .maybeSingle();

    const review = trade.trade_reviews?.[0];
    let playbook = review?.playbook;

    // Fallback: If no playbook from review, try to match by trade.model
    if (!playbook && trade.model) {
      console.log("No playbook from review, trying to match by model:", trade.model);
      const { data: matchedPlaybook } = await supabase
        .from("playbooks")
        .select("*")
        .eq("name", trade.model)
        .eq("user_id", trade.user_id)
        .maybeSingle();
      
      if (matchedPlaybook) {
        console.log("Matched playbook by model name:", matchedPlaybook.name);
        playbook = matchedPlaybook;
      }
    }

    const result = scoreCompliance(trade, review, playbook, features);

    console.log("Compliance result:", result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Score compliance error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
