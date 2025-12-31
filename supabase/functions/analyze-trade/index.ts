import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a professional trading performance analyst reviewing trades relative to the trader's own rules and historical behavior.

You must NOT:
- Predict markets or suggest new setups
- Give generic trading advice like "use proper risk management" or "stick to your plan"
- Use motivational language or trading clichés
- Contradict trader-confirmed attestations without explicit visual evidence

You must ONLY:
- Evaluate against the trader's specific playbook rules provided
- Reference specific data points from the trade
- Compare to similar historical trades when provided
- Explain WHY based on rules and data, not opinion
- Be direct, analytical, and blunt

GROUNDING RULES (CRITICAL - Follow these strictly):
1. TRADER ATTESTATIONS ARE GROUND TRUTH: If the trader marked a confirmation as "✓ CONFIRMED", you MUST NOT claim that rule was "violated" or "not met". The trader verified this visually on their chart.
2. SCREENSHOT DESCRIPTIONS ARE FIRST-HAND ACCOUNTS: When the trader provides screenshot descriptions, treat these as authoritative accounts of what happened. Do not contradict them.
3. DISTINGUISH THESIS vs EXECUTION FAILURES: 
   - THESIS CORRECT: The trade idea was right (price eventually went to target) but stopped out prematurely
   - THESIS WRONG: The trade idea was incorrect (price never went to target)
   - EXECUTION FAILURE: Right idea, wrong timing/sizing/management
   - EXTERNAL FACTOR: Correct in all respects but stopped out by uncontrollable event (e.g., late-session micro sweep, news spike)
4. POST-TRADE CONTEXT MATTERS: If the trader notes "price reached target after my stop", this means the thesis was CORRECT. Analyze WHY the stop was hit, not whether the setup was wrong.
5. NEVER INVENT VIOLATIONS: For each deviation you cite, you MUST reference which specific data point shows the violation. If you cannot cite evidence, say "unable to verify" - NOT "violated".
6. WEIGHT CONFIRMED CHECKLISTS HEAVILY: A fully confirmed checklist (all items TRUE) is strong evidence the setup was valid. Question execution/timing, not the setup itself.

ABOUT CONFIRMATION RULES:
- Confirmation rules are textual descriptions the trader must manually verify during entry
- These rules require chart data or manual trader input to verify
- If no checklist answers exist confirming these rules, state them as "unable to verify from available data"
- Only mark confirmation rules as deviations if the trader explicitly marked them as failed

CHART ANALYSIS REQUIREMENTS (when screenshots are provided):
1. IDENTIFY KEY LEVELS: Call out specific price levels for support, resistance, order blocks, fair value gaps visible in the charts
2. GRADE THE ENTRY: Was entry at premium/discount? At a key level or in no-man's land? Reference the exact price and visible structure
3. ASSESS STOP PLACEMENT: Is the stop behind structure (order block, swing low/high) or arbitrary? Would a few pips tighter/wider have made a difference?
4. REFERENCE TRADER NOTES: The trader's screenshot descriptions are first-hand accounts - validate and extend them with your visual analysis
5. IDENTIFY ALTERNATIVE ENTRY: If a better entry was visible, describe exactly where (price level, candle pattern, structure)
6. MULTI-TIMEFRAME ANALYSIS: If multiple timeframe screenshots exist, assess confluence or conflict between timeframes
7. PRICE ACTION PATTERNS: Identify ICT/SMC concepts visible in charts:
   - Order Blocks (bullish/bearish)
   - Fair Value Gaps (FVGs) / Imbalances
   - Liquidity sweeps / Stop hunts
   - Break of Structure (BOS) / Change of Character (CHoCH)
   - Premium/Discount zones
8. COMPARE TO IDEAL: How does this entry compare to the playbook's ideal setup if examples are provided?
9. VISUAL EVIDENCE FOR DEVIATIONS: Only cite rule deviations that are visually verifiable in the screenshots

STRATEGY REFINEMENT (be specific, not generic):
- Based on your analysis, suggest specific rule improvements with exact conditions
- Identify patterns that could become systematic filters (e.g., "avoid entries in first 15 mins of session when...")
- Observe potential edges that could be added to the playbook
- Reference specific chart elements when making suggestions

TIME WINDOW VERIFICATION (CRITICAL):
- All entry times in TRADE DATA are shown in ET (Eastern Time)
- When checking time windows (e.g., "03:00-04:00 EST"), verify the ET hour is within range before flagging as a violation
- For example, if entry is at 03:19 ET and rule says "within 03:00-04:00", this is COMPLIANT (not a deviation)
- Only flag time-based violations when the time is clearly OUTSIDE the specified window

CONFIDENCE CALIBRATION:
- LOW: No screenshots OR no playbook assigned OR missing most review data OR conflicting information that cannot be resolved
- MEDIUM: Has screenshots but limited/no descriptions OR some data gaps OR playbook without detailed rules
- HIGH: Has screenshots with descriptions AND complete playbook with rules AND trader review with emotional states AND checklist answers

Your tone is that of a research analyst: precise, data-driven, and constructive but not soft.`;

interface AIAnalysisOutput {
  technical_review: {
    matched_rules: string[];
    deviations: string[];
    failure_type: "structural" | "execution" | "both" | "none";
  };
  thesis_evaluation: {
    thesis_correct: boolean;
    thesis_explanation: string;
    failure_category: "thesis_wrong" | "execution_failure" | "external_factor" | "no_failure";
  };
  mistake_attribution: {
    primary: string | null;
    secondary: string[];
    is_recurring: boolean;
  };
  psychology_analysis: {
    influence: string;
    past_correlation: string;
    psychology_vs_structure: "psychology" | "structure" | "both" | "neither";
  };
  comparison_to_past: {
    differs_from_winners: string[];
    resembles_losers: string[];
  };
  actionable_guidance: {
    rule_to_reinforce: string;
    avoid_condition: string;
  };
  visual_analysis?: {
    entry_quality: string;
    exit_quality: string;
    stop_placement: string;
    key_levels_identified: string[];
    confirmations_visible: string[];
    chart_observations: string[];
    better_entry_identified: string | null;
    structure_analysis: string;
  };
  strategy_refinement?: {
    rule_suggestion: string | null;
    filter_recommendation: string | null;
    edge_observation: string | null;
    entry_refinement: string | null;
    stop_refinement: string | null;
  };
  confidence: "low" | "medium" | "high";
  screenshots_analyzed: boolean;
}

// CRITICAL FIX: Normalize trade_reviews which can be object OR array depending on Supabase join
function normalizeToArray<T>(data: T | T[] | null | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return [data];
}

// Get the latest review from normalized array
function getLatestReview(reviews: any[]): any | null {
  if (reviews.length === 0) return null;
  if (reviews.length === 1) return reviews[0];
  
  // Sort by updated_at descending, fallback to created_at
  return reviews.sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  })[0];
}

function formatTimeInET(utcTimestamp: string): string {
  try {
    const date = new Date(utcTimestamp);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return utcTimestamp;
  }
}

function formatDateTimeInET(utcTimestamp: string): string {
  try {
    const date = new Date(utcTimestamp);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return utcTimestamp;
  }
}

function buildUserPrompt(
  trade: any,
  review: any,
  playbook: any,
  features: any,
  complianceResult: any,
  similarTrades: any
): string {
  const tradeResult = (trade.net_pnl || 0) >= 0 ? "WIN" : "LOSS";
  const pnl = trade.net_pnl ? `$${trade.net_pnl.toFixed(2)}` : "N/A";
  const rMultiple = trade.r_multiple_actual ? `${trade.r_multiple_actual.toFixed(2)}R` : "N/A";
  const duration = trade.duration_seconds 
    ? `${Math.floor(trade.duration_seconds / 60)} minutes`
    : "N/A";

  let prompt = `Analyze this trade against the trader's rules and history:

## TRADE DATA
- Symbol: ${trade.symbol}
- Direction: ${trade.direction.toUpperCase()}
- Entry: ${trade.entry_price} @ ${formatTimeInET(trade.entry_time)} ET (${formatDateTimeInET(trade.entry_time)})
- Exit: ${trade.exit_price || "Still open"} @ ${trade.exit_time ? formatTimeInET(trade.exit_time) + " ET" : "N/A"}
- Result: ${tradeResult} (${pnl}, ${rMultiple})
- Duration: ${duration}
- Session: ${trade.session || "Unknown"}
- Initial SL: ${trade.sl_initial || "Not set"}
- Initial TP: ${trade.tp_initial || "Not set"}
- Final SL: ${trade.sl_final || trade.sl_initial || "Not set"}
- Final TP: ${trade.tp_final || trade.tp_initial || "Not set"}

## COMPUTED FEATURES
`;

  if (features) {
    prompt += `- Day of Week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][features.day_of_week] || 'Unknown'}
- Time Since Session Open: ${features.time_since_session_open_mins ? `${features.time_since_session_open_mins} mins` : 'N/A'}
- Entry Percentile in Range: ${features.entry_percentile?.toFixed(1) || 'N/A'}%
- Entry Efficiency: ${features.entry_efficiency?.toFixed(1) || 'N/A'}%
- Exit Efficiency: ${features.exit_efficiency?.toFixed(1) || 'N/A'}%
- Stop Location Quality: ${features.stop_location_quality?.toFixed(1) || 'N/A'}%
- Volatility Regime: ${features.volatility_regime || 'Unknown'}
- HTF Bias: ${features.htf_bias || 'Unknown'}
`;
  } else {
    prompt += `- No computed features available\n`;
  }

  prompt += `
## PLAYBOOK RULES
`;

  if (playbook) {
    prompt += `Setup Name: ${playbook.name}
Description: ${playbook.description || 'None'}
Valid Sessions: ${playbook.session_filter?.join(', ') || 'Any'}
Valid Symbols: ${playbook.symbol_filter?.join(', ') || 'Any'}
Valid Regimes: ${playbook.valid_regimes?.join(', ') || 'Any'}
Entry Zone Rules: ${JSON.stringify(playbook.entry_zone_rules) || 'None defined'}
Confirmation Rules: ${playbook.confirmation_rules?.join(', ') || 'None defined'}
Invalidation Conditions: ${playbook.invalidation_rules?.join(', ') || 'None defined'}
Management Rules: ${playbook.management_rules?.join(', ') || 'None defined'}
Known Failure Modes: ${playbook.failure_modes?.join(', ') || 'None documented'}
Max R Per Trade: ${playbook.max_r_per_trade || 'Not specified'}
Max Daily Loss R: ${playbook.max_daily_loss_r || 'Not specified'}
`;

    // Include playbook example screenshots if available
    const playbookScreenshots = playbook.screenshots || [];
    if (Array.isArray(playbookScreenshots) && playbookScreenshots.length > 0) {
      prompt += `
## PLAYBOOK REFERENCE CHARTS (Trader's Ideal Setup Examples)
These are the trader's own examples of what ideal setups look like for this playbook. Compare the current trade to these:
`;
      playbookScreenshots.forEach((s: any, i: number) => {
        const description = typeof s === 'object' ? s.description : null;
        const timeframe = typeof s === 'object' ? s.timeframe : null;
        if (description) {
          prompt += `Example ${i + 1}${timeframe ? ` (${timeframe})` : ''}: "${description}"\n`;
        }
      });
      prompt += `\nNote similarities and differences between the current trade and these ideal examples.\n`;
    }

    prompt += `
## TRADER ATTESTATIONS (Verified by Trader - DO NOT CONTRADICT without visual evidence)
`;
    
    if (playbook.confirmation_rules && Array.isArray(playbook.confirmation_rules) && playbook.confirmation_rules.length > 0) {
      const checklistAnswers = review?.checklist_answers || {};
      playbook.confirmation_rules.forEach((rule: string, i: number) => {
        const answer = checklistAnswers[`confirmation_${i}`];
        if (answer === true) {
          prompt += `- ✓ CONFIRMED: "${rule}" (Trader verified this was met)\n`;
        } else if (answer === false) {
          prompt += `- ✗ NOT MET: "${rule}" (Trader marked this as failed)\n`;
        } else {
          prompt += `- ? NOT ANSWERED: "${rule}" (Unable to verify - do NOT assume violated)\n`;
        }
      });
    }
    
    if (playbook.checklist_questions && Array.isArray(playbook.checklist_questions) && playbook.checklist_questions.length > 0) {
      const checklistAnswers = review?.checklist_answers || {};
      playbook.checklist_questions.forEach((q: any) => {
        const answer = checklistAnswers[q.id];
        if (answer === true || answer === 'yes') {
          prompt += `- ✓ YES: "${q.question}"\n`;
        } else if (answer === false || answer === 'no') {
          prompt += `- ✗ NO: "${q.question}"\n`;
        } else if (answer !== undefined && answer !== null) {
          prompt += `- "${q.question}": ${answer}\n`;
        }
      });
    }
    
    if (!review?.checklist_answers || Object.keys(review.checklist_answers).length === 0) {
      prompt += `Note: No checklist answers recorded - confirmation rules cannot be verified from data alone.\n`;
    }
  } else {
    prompt += `No playbook assigned to this trade.\n`;
  }

  prompt += `
## DETERMINISTIC COMPLIANCE SCORE (Pre-computed, rule-based)
- Setup Compliance: ${complianceResult?.setup_compliance_score || 0}/100
- Context Alignment: ${complianceResult?.context_alignment_score || 0}/100
- Rule Violations: ${complianceResult?.rule_violations?.length > 0 ? complianceResult.rule_violations.join('; ') : 'None'}
- Matched Rules: ${complianceResult?.matched_rules?.length > 0 ? complianceResult.matched_rules.join('; ') : 'None'}

## TRADER'S REVIEW DATA
`;

  if (review) {
    prompt += `- Regime: ${review.regime || 'Not specified'}
- News Risk: ${review.news_risk || 'None'}
- Emotional State Before: ${review.emotional_state_before || 'Not recorded'}
- Emotional State After: ${review.emotional_state_after || 'Not recorded'}
- Checklist Score: ${review.score || 0}/5
- Self-Identified Mistakes: ${review.mistakes?.length > 0 ? review.mistakes.join(', ') : 'None listed'}
- What They Did Well: ${review.did_well?.length > 0 ? review.did_well.join(', ') : 'None listed'}
- Areas to Improve: ${review.to_improve?.length > 0 ? review.to_improve.join(', ') : 'None listed'}
- Psychology Notes: ${review.psychology_notes || 'None'}
- Thoughts: ${review.thoughts || 'None'}
`;
  } else {
    prompt += `No review data available for this trade.\n`;
  }

  // Enhanced screenshot section with emphasis on visual analysis
  const screenshots = review?.screenshots || [];
  if (Array.isArray(screenshots) && screenshots.length > 0) {
    prompt += `
## CRITICAL: TRADER'S VISUAL DOCUMENTATION

The trader has provided ${screenshots.length} chart screenshot(s) with descriptions. These are FIRST-HAND ACCOUNTS of what happened during the trade.
You MUST analyze these charts and reference specific visual elements in your analysis.

`;

    screenshots.forEach((screenshot: any, i: number) => {
      const description = typeof screenshot === 'object' ? screenshot.description : null;
      const timeframe = typeof screenshot === 'object' ? screenshot.timeframe : null;
      
      prompt += `### Screenshot ${i + 1}${timeframe ? ` (${timeframe} timeframe)` : ''}
`;
      if (description) {
        prompt += `Trader's Description: "${description}"

For this screenshot, you MUST:
- Identify key S/R levels, order blocks, or FVGs visible
- Assess entry location relative to structure
- Note any price action patterns (liquidity sweeps, BOS, CHoCH)
- Validate or extend the trader's description with your visual analysis

`;
      } else {
        prompt += `[No description provided - analyze the chart and describe what you see]

`;
      }
    });

    prompt += `IMPORTANT: Your visual_analysis section MUST reference specific elements from these screenshots. Do NOT provide generic analysis - cite what you actually see in the charts.\n`;
  } else {
    prompt += `
## VISUAL DOCUMENTATION
No screenshot documentation provided. Visual analysis will be limited.
`;
  }

  prompt += `
## SIMILAR HISTORICAL TRADES
`;

  if (similarTrades?.similar_winners?.length > 0) {
    prompt += `\nSimilar Winning Trades (compare what worked):\n`;
    similarTrades.similar_winners.slice(0, 5).forEach((t: any, i: number) => {
      prompt += `${i + 1}. ${t.symbol} (${t.similarity_score}% similar) - $${t.net_pnl?.toFixed(2) || 'N/A'}, ${t.r_multiple?.toFixed(2) || 'N/A'}R, session: ${t.session || 'unknown'}\n`;
    });
  } else {
    prompt += `No similar winning trades found.\n`;
  }

  if (similarTrades?.similar_losers?.length > 0) {
    prompt += `\nSimilar Losing Trades (identify patterns to avoid):\n`;
    similarTrades.similar_losers.slice(0, 5).forEach((t: any, i: number) => {
      prompt += `${i + 1}. ${t.symbol} (${t.similarity_score}% similar) - $${t.net_pnl?.toFixed(2) || 'N/A'}, ${t.r_multiple?.toFixed(2) || 'N/A'}R, session: ${t.session || 'unknown'}\n`;
    });
  } else {
    prompt += `No similar losing trades found.\n`;
  }

  prompt += `
Based on this data, provide your structured analysis using the trade_analysis function.

CRITICAL ANALYSIS GUIDELINES:
1. For visual_analysis: Reference SPECIFIC price levels, candle patterns, and structure visible in screenshots
2. For strategy_refinement: Suggest SPECIFIC rules with exact conditions, not generic advice
3. For deviations: Only cite violations you can prove with data points or visual evidence
4. For thesis_evaluation: Distinguish between thesis failure, execution failure, and external factors
5. Screenshots are analyzed: Set screenshots_analyzed=true ONLY if you provided substantive chart observations
6. Confidence: Set based on data completeness (see confidence calibration in system prompt)`;

  return prompt;
}

// Build the tool schema dynamically based on whether screenshots exist
function buildToolSchema(hasScreenshots: boolean) {
  const baseRequired = [
    "technical_review", "thesis_evaluation", "mistake_attribution",
    "psychology_analysis", "comparison_to_past", "actionable_guidance",
    "confidence", "screenshots_analyzed"
  ];
  
  // When screenshots exist, require visual_analysis and strategy_refinement
  const required = hasScreenshots 
    ? [...baseRequired, "visual_analysis", "strategy_refinement"]
    : baseRequired;

  return {
    type: "function",
    function: {
      name: "trade_analysis",
      description: "Structured analysis of a trade against the trader's playbook and history. When screenshots are provided, you MUST provide detailed visual analysis.",
      parameters: {
        type: "object",
        properties: {
          technical_review: {
            type: "object",
            properties: {
              matched_rules: { 
                type: "array", 
                items: { type: "string" },
                description: "Specific playbook rules that the trade followed correctly"
              },
              deviations: { 
                type: "array", 
                items: { type: "string" },
                description: "Rules that were violated WITH specific evidence for each"
              },
              failure_type: { 
                type: "string", 
                enum: ["structural", "execution", "both", "none"],
                description: "structural=thesis wrong, execution=right idea wrong timing, both=multiple failures, none=good trade"
              }
            },
            required: ["matched_rules", "deviations", "failure_type"]
          },
          thesis_evaluation: {
            type: "object",
            properties: {
              thesis_correct: { type: "boolean" },
              thesis_explanation: { 
                type: "string",
                description: "Explain why the trade thesis was correct or incorrect, referencing price action"
              },
              failure_category: { 
                type: "string", 
                enum: ["thesis_wrong", "execution_failure", "external_factor", "no_failure"] 
              }
            },
            required: ["thesis_correct", "thesis_explanation", "failure_category"]
          },
          mistake_attribution: {
            type: "object",
            properties: {
              primary: { type: "string", nullable: true, description: "The main mistake if any, with specific evidence" },
              secondary: { type: "array", items: { type: "string" } },
              is_recurring: { type: "boolean", description: "Does this mistake appear in similar losing trades?" }
            },
            required: ["primary", "secondary", "is_recurring"]
          },
          psychology_analysis: {
            type: "object",
            properties: {
              influence: { type: "string", description: "How emotional state affected the trade" },
              past_correlation: { type: "string", description: "How this correlates with similar emotional states in history" },
              psychology_vs_structure: { type: "string", enum: ["psychology", "structure", "both", "neither"] }
            },
            required: ["influence", "past_correlation", "psychology_vs_structure"]
          },
          comparison_to_past: {
            type: "object",
            properties: {
              differs_from_winners: { 
                type: "array", 
                items: { type: "string" },
                description: "Specific ways this trade differs from similar winning trades"
              },
              resembles_losers: { 
                type: "array", 
                items: { type: "string" },
                description: "Specific ways this trade resembles similar losing trades"
              }
            },
            required: ["differs_from_winners", "resembles_losers"]
          },
          actionable_guidance: {
            type: "object",
            properties: {
              rule_to_reinforce: { type: "string", description: "A specific rule to practice, with exact conditions" },
              avoid_condition: { type: "string", description: "A specific condition to avoid, with exact criteria" }
            },
            required: ["rule_to_reinforce", "avoid_condition"]
          },
          visual_analysis: {
            type: "object",
            description: "REQUIRED when screenshots are provided. Reference specific chart elements.",
            properties: {
              entry_quality: { 
                type: "string", 
                description: "Assessment of entry location. Reference specific price level and structure (e.g., 'Entry at 1.2650 was at the top of the 1H order block')"
              },
              exit_quality: { 
                type: "string", 
                description: "Assessment of exit relative to price action and structure visible in chart"
              },
              stop_placement: { 
                type: "string", 
                description: "Was stop behind structure or arbitrary? Reference specific level (e.g., 'Stop at 1.2620 was 5 pips below the swing low at 1.2625')"
              },
              key_levels_identified: { 
                type: "array", 
                items: { type: "string" },
                description: "List specific S/R levels, order blocks, FVGs visible with price levels"
              },
              confirmations_visible: { 
                type: "array", 
                items: { type: "string" },
                description: "List specific patterns/confirmations visible (e.g., 'BOS on 1min at 09:15', 'Liquidity sweep of 1.2600 low')"
              },
              chart_observations: { 
                type: "array", 
                items: { type: "string" },
                description: "Key observations from visual chart analysis not covered above"
              },
              better_entry_identified: { 
                type: "string", 
                nullable: true,
                description: "If a better entry was visible, describe exactly where with price level"
              },
              structure_analysis: {
                type: "string",
                description: "Overall market structure assessment based on charts (e.g., 'Price in discount of daily range, bullish order flow on 1H')"
              }
            }
          },
          strategy_refinement: {
            type: "object",
            description: "Specific, actionable improvements based on this trade's lessons",
            properties: {
              rule_suggestion: { 
                type: "string", 
                nullable: true,
                description: "A specific new rule to add (e.g., 'Wait for 1min CHoCH before entering off 15min OB during NY overlap')"
              },
              filter_recommendation: { 
                type: "string", 
                nullable: true,
                description: "A filter to avoid similar losses or select similar wins (e.g., 'Avoid entries in first 15 mins of London session on Fridays')"
              },
              edge_observation: { 
                type: "string", 
                nullable: true,
                description: "A potential edge pattern worth testing/tracking"
              },
              entry_refinement: {
                type: "string",
                nullable: true,
                description: "How entry criteria could be refined based on chart analysis (e.g., 'Enter at POC instead of OB top for better R:R')"
              },
              stop_refinement: {
                type: "string", 
                nullable: true,
                description: "How stop placement could be improved based on visible structure"
              }
            }
          },
          confidence: { 
            type: "string", 
            enum: ["low", "medium", "high"],
            description: "LOW: no screenshots/playbook, MEDIUM: partial data, HIGH: screenshots+playbook+review"
          },
          screenshots_analyzed: { 
            type: "boolean",
            description: "Set TRUE only if you provided substantive visual analysis referencing specific chart elements"
          }
        },
        required
      }
    }
  };
}

serve(async (req) => {
  console.log("=== analyze-trade function called ===");
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Step 1: Validate environment
    console.log("Step 1: Validating environment...");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured", step: "environment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 2: Validate auth
    console.log("Step 2: Validating authorization...");
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      console.error("Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization", step: "auth" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user from auth header
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error("Invalid auth token:", userError);
      return new Response(
        JSON.stringify({ error: "Invalid authorization", step: "auth" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("User authenticated:", user.id);

    // Step 3: Parse request body - now accepts pre-computed data
    console.log("Step 3: Parsing request body...");
    const body = await req.json();
    const { 
      trade_id, 
      save = true,
      // Pre-computed data from client (optional - will fetch if not provided)
      features: providedFeatures,
      compliance: providedCompliance,
      similar_trades: providedSimilarTrades
    } = body;

    if (!trade_id) {
      console.error("Missing trade_id");
      return new Response(
        JSON.stringify({ error: "Missing trade_id", step: "parse" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log("Trade ID:", trade_id, "Save:", save);

    // Step 4: Fetch trade data
    console.log("Step 4: Fetching trade data...");
    const { data: trade, error: tradeError } = await supabase
      .from("trades")
      .select(`
        *,
        playbook:playbooks (*),
        trade_reviews (
          *,
          playbook:playbooks (*)
        ),
        account:accounts (name, prop_firm)
      `)
      .eq("id", trade_id)
      .single();

    if (tradeError || !trade) {
      console.error("Trade fetch error:", tradeError);
      return new Response(
        JSON.stringify({ error: "Trade not found", step: "fetch_trade" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user owns this trade
    if (trade.user_id !== user.id) {
      console.error("User does not own this trade");
      return new Response(
        JSON.stringify({ error: "Access denied", step: "auth" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Trade fetched:", trade.symbol, trade.direction);

    // Step 5: Get features (use provided or fetch)
    console.log("Step 5: Getting trade features...");
    let features = providedFeatures;
    if (!features) {
      const { data: dbFeatures } = await supabase
        .from("trade_features")
        .select("*")
        .eq("trade_id", trade_id)
        .maybeSingle();
      features = dbFeatures;
    }
    console.log("Features:", features ? "available" : "not available");

    // Step 6: Get compliance (use provided or default)
    console.log("Step 6: Getting compliance data...");
    const complianceResult = providedCompliance || {
      setup_compliance_score: 0,
      context_alignment_score: 0,
      rule_violations: [],
      matched_rules: [],
    };
    console.log("Compliance scores:", complianceResult.setup_compliance_score, complianceResult.context_alignment_score);

    // Step 7: Get similar trades (use provided or default)
    console.log("Step 7: Getting similar trades...");
    const similarTrades = providedSimilarTrades || { similar_winners: [], similar_losers: [] };
    console.log("Similar trades:", similarTrades.similar_winners?.length || 0, "winners,", similarTrades.similar_losers?.length || 0, "losers");

    // Step 8: Get playbook and review - CRITICAL FIX: normalize trade_reviews
    console.log("Step 8: Extracting playbook and review...");
    
    // CRITICAL FIX: trade_reviews can be object or array depending on Supabase join behavior
    const reviewsArray = normalizeToArray(trade.trade_reviews);
    const review = getLatestReview(reviewsArray);
    
    console.log("Reviews normalized:", {
      rawType: Array.isArray(trade.trade_reviews) ? 'array' : typeof trade.trade_reviews,
      rawLength: Array.isArray(trade.trade_reviews) ? trade.trade_reviews.length : (trade.trade_reviews ? 1 : 0),
      normalizedLength: reviewsArray.length,
      selectedReviewId: review?.id || null,
      selectedReviewUpdatedAt: review?.updated_at || null
    });
    
    let playbook = trade.playbook || review?.playbook;

    if (!playbook && trade.playbook_id) {
      console.log("Fetching playbook by ID:", trade.playbook_id);
      const { data: matchedPlaybook } = await supabase
        .from("playbooks")
        .select("*")
        .eq("id", trade.playbook_id)
        .maybeSingle();
      
      if (matchedPlaybook) {
        console.log("Matched playbook:", matchedPlaybook.name);
        playbook = matchedPlaybook;
      }
    }

    // Step 9: Build prompt
    console.log("Step 9: Building AI prompt...");
    const userPrompt = buildUserPrompt(
      trade,
      review,
      playbook,
      features,
      complianceResult,
      similarTrades
    );
    console.log("Prompt length:", userPrompt.length, "characters");

    // Step 10: Build multimodal content with screenshots
    console.log("Step 10: Processing screenshots...");
    const screenshots = review?.screenshots || [];
    const hasScreenshots = Array.isArray(screenshots) && screenshots.length > 0;
    const screenshotCount = hasScreenshots ? screenshots.length : 0;
    console.log("Screenshots found:", screenshotCount, "from review:", review?.id || "none");

    const userContent: any[] = [{ type: "text", text: userPrompt }];
    
    if (hasScreenshots) {
      for (const screenshot of screenshots.slice(0, 5)) { // Allow up to 5 screenshots
        const url = typeof screenshot === 'string' ? screenshot : screenshot.url;
        if (url) {
          userContent.push({
            type: "image_url",
            image_url: { url }
          });
          console.log("Added screenshot for analysis:", url.substring(0, 50) + "...");
        }
      }
    }

    // Step 11: Select model based on screenshot presence
    // Use Gemini 2.5 Pro for trades with screenshots (better multimodal reasoning)
    // Use Gemini 2.5 Flash for trades without screenshots (faster, cheaper)
    const model = hasScreenshots ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash";
    console.log("Step 11: Selected model:", model, "(screenshots:", hasScreenshots, ")");

    // Build dynamic tool schema based on screenshot presence
    const toolSchema = buildToolSchema(hasScreenshots);

    // Step 12: Call AI gateway
    console.log("Step 12: Calling AI gateway...");
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: hasScreenshots ? userContent : userPrompt },
        ],
        tools: [toolSchema],
        tool_choice: { type: "function", function: { name: "trade_analysis" } }
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      console.error("AI gateway error:", status);
      
      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later.", step: "ai_call" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to your workspace.", step: "ai_call" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const errorText = await aiResponse.text();
      console.error("AI gateway error text:", errorText);
      return new Response(
        JSON.stringify({ error: `AI gateway error: ${status}`, step: "ai_call" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 13: Parse AI response
    console.log("Step 13: Parsing AI response...");
    const aiData = await aiResponse.json();

    let analysisOutput: AIAnalysisOutput | null = null;
    let rawAnalysis = "";

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        analysisOutput = JSON.parse(toolCall.function.arguments);
        rawAnalysis = toolCall.function.arguments;
        console.log("Successfully parsed structured analysis");
        console.log("Visual analysis provided:", !!analysisOutput?.visual_analysis);
        console.log("Strategy refinement provided:", !!analysisOutput?.strategy_refinement);
        console.log("Screenshots analyzed flag:", analysisOutput?.screenshots_analyzed);
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e);
      }
    }

    if (!analysisOutput) {
      rawAnalysis = aiData.choices?.[0]?.message?.content || "No analysis generated";
      console.warn("Tool call not used, falling back to raw content");
    }

    // Step 13.5: Validate visual analysis if screenshots were provided but AI didn't analyze them
    if (hasScreenshots && analysisOutput && !analysisOutput.screenshots_analyzed) {
      console.warn("Screenshots provided but AI reported screenshots_analyzed=false. Analysis may be incomplete.");
      // Don't retry automatically - just log the warning and let the UI handle it
    }

    // Step 14: Save to database
    let savedReview = null;
    
    if (save) {
      console.log("Step 14: Saving to database...");
      const aiReviewData = {
        trade_id,
        user_id: user.id,
        technical_review: analysisOutput?.technical_review || {},
        thesis_evaluation: analysisOutput?.thesis_evaluation || null,
        mistake_attribution: analysisOutput?.mistake_attribution || {},
        psychology_analysis: analysisOutput?.psychology_analysis || {},
        comparison_to_past: analysisOutput?.comparison_to_past || {},
        actionable_guidance: analysisOutput?.actionable_guidance || {},
        visual_analysis: analysisOutput?.visual_analysis || null,
        strategy_refinement: analysisOutput?.strategy_refinement || null,
        confidence: analysisOutput?.confidence || "low",
        screenshots_analyzed: analysisOutput?.screenshots_analyzed || false,
        setup_compliance_score: complianceResult.setup_compliance_score,
        rule_violations: complianceResult.rule_violations,
        context_alignment_score: complianceResult.context_alignment_score,
        similar_winners: similarTrades.similar_winners?.map((t: any) => t.trade_id) || [],
        similar_losers: similarTrades.similar_losers?.map((t: any) => t.trade_id) || [],
        raw_analysis: rawAnalysis,
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error: saveError } = await supabase
        .from("ai_reviews")
        .upsert(aiReviewData, { onConflict: "trade_id" })
        .select()
        .single();

      if (saveError) {
        console.error("Failed to save AI review:", saveError);
        return new Response(
          JSON.stringify({ error: "Analysis generated but failed to save. Please try again.", step: "save" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      savedReview = saved;
      console.log("AI review saved successfully:", savedReview.id);
    } else {
      console.log("Step 14: Skipping save (save=false)");
    }

    console.log("=== analyze-trade completed successfully ===");

    return new Response(
      JSON.stringify({
        analysis: analysisOutput,
        compliance: complianceResult,
        similar_trades: similarTrades,
        raw_analysis: rawAnalysis,
        saved_review: savedReview,
        // Include metadata for debugging
        _meta: {
          model_used: model,
          screenshots_count: screenshotCount,
          review_id: review?.id || null,
          review_updated_at: review?.updated_at || null
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unhandled error in analyze-trade:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message, step: "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
