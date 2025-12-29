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

VISUAL CHART ANALYSIS (when screenshots are provided):
- Analyze the chart images to verify entry/exit quality
- USE SCREENSHOT DESCRIPTIONS as context - they tell you what the trader saw
- Assess whether entry was at a key level (support/resistance, order block, fair value gap)
- Evaluate if exit was optimal or if more could have been captured
- Check if stop placement was behind structure or arbitrary
- Reference specific visual elements (price levels, candle patterns, structure) in your analysis

STRATEGY REFINEMENT:
- Based on your analysis, suggest specific rule improvements
- Identify patterns that could become systematic filters
- Observe potential edges that could be added to the playbook

TIME WINDOW VERIFICATION (CRITICAL):
- All entry times in TRADE DATA are shown in ET (Eastern Time)
- When checking time windows (e.g., "03:00-04:00 EST"), verify the ET hour is within range before flagging as a violation
- For example, if entry is at 03:19 ET and rule says "within 03:00-04:00", this is COMPLIANT (not a deviation)
- Only flag time-based violations when the time is clearly OUTSIDE the specified window

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
    confirmations_visible: string[];
    chart_observations: string[];
  };
  strategy_refinement?: {
    rule_suggestion: string | null;
    filter_recommendation: string | null;
    edge_observation: string | null;
  };
  confidence: "low" | "medium" | "high";
  screenshots_analyzed: boolean;
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

## COMPUTED FEATURES
`;

  if (features) {
    prompt += `- Day of Week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][features.day_of_week] || 'Unknown'}
- Time Since Session Open: ${features.time_since_session_open_mins ? `${features.time_since_session_open_mins} mins` : 'N/A'}
- Entry Percentile in Range: ${features.entry_percentile?.toFixed(1) || 'N/A'}%
- Entry Efficiency: ${features.entry_efficiency?.toFixed(1) || 'N/A'}%
- Exit Efficiency: ${features.exit_efficiency?.toFixed(1) || 'N/A'}%
- Stop Location Quality: ${features.stop_location_quality?.toFixed(1) || 'N/A'}%
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
`;

    // Add TRADER ATTESTATIONS section - clear display of what trader verified
    prompt += `
## TRADER ATTESTATIONS (Verified by Trader - DO NOT CONTRADICT without evidence)
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
    
    // Add checklist questions (range, OB, etc.) if present
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
- Setup Compliance: ${complianceResult.setup_compliance_score}/100
- Context Alignment: ${complianceResult.context_alignment_score}/100
- Rule Violations: ${complianceResult.rule_violations.length > 0 ? complianceResult.rule_violations.join('; ') : 'None'}
- Matched Rules: ${complianceResult.matched_rules.length > 0 ? complianceResult.matched_rules.join('; ') : 'None'}

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

  // Add TRADER'S VISUAL DOCUMENTATION section with screenshot descriptions
  prompt += `
## TRADER'S VISUAL DOCUMENTATION (First-hand accounts - treat as authoritative)
`;

  const screenshots = review?.screenshots || [];
  if (Array.isArray(screenshots) && screenshots.length > 0) {
    screenshots.forEach((screenshot: any, i: number) => {
      const url = typeof screenshot === 'string' ? screenshot : screenshot.url;
      const description = typeof screenshot === 'object' ? screenshot.description : null;
      const timeframe = typeof screenshot === 'object' ? screenshot.timeframe : null;
      
      if (description) {
        prompt += `Screenshot ${i + 1}${timeframe ? ` (${timeframe})` : ''}: "${description}"\n`;
      } else if (url) {
        prompt += `Screenshot ${i + 1}${timeframe ? ` (${timeframe})` : ''}: [No description provided]\n`;
      }
    });
    prompt += `\nIMPORTANT: These descriptions are from the trader who took the trade. They describe what actually happened. Do NOT contradict them without explicit visual evidence from the screenshots.\n`;
  } else {
    prompt += `No screenshot documentation provided.\n`;
  }

  prompt += `
## SIMILAR HISTORICAL TRADES
`;

  if (similarTrades.similar_winners?.length > 0) {
    prompt += `\nSimilar Winning Trades:\n`;
    similarTrades.similar_winners.slice(0, 5).forEach((t: any, i: number) => {
      prompt += `${i + 1}. ${t.symbol} (${t.similarity_score}% similar) - $${t.net_pnl.toFixed(2)}, ${t.r_multiple?.toFixed(2) || 'N/A'}R, session: ${t.session || 'unknown'}\n`;
    });
  } else {
    prompt += `No similar winning trades found.\n`;
  }

  if (similarTrades.similar_losers?.length > 0) {
    prompt += `\nSimilar Losing Trades:\n`;
    similarTrades.similar_losers.slice(0, 5).forEach((t: any, i: number) => {
      prompt += `${i + 1}. ${t.symbol} (${t.similarity_score}% similar) - $${t.net_pnl.toFixed(2)}, ${t.r_multiple?.toFixed(2) || 'N/A'}R, session: ${t.session || 'unknown'}\n`;
    });
  } else {
    prompt += `No similar losing trades found.\n`;
  }

  prompt += `
Based on this data, provide your structured analysis using the trade_analysis function.

CRITICAL ANALYSIS GUIDELINES:
1. Use screenshot descriptions as first-hand accounts of what happened
2. Do NOT contradict trader-confirmed attestations (marked with ✓ CONFIRMED)
3. If this is a loss but trader notes "price reached target after stop" - the THESIS was correct, analyze WHY execution failed
4. For each deviation you cite, reference the specific data point that shows it
5. Distinguish between thesis failure, execution failure, and external factors`;

  return prompt;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

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

    const { trade_id, save = true } = await req.json();
    console.log("AI Analysis request for trade:", trade_id, "save:", save);

    // 1. Fetch trade with review and playbook
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
        JSON.stringify({ error: "Trade not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch or compute trade features
    let { data: features } = await supabase
      .from("trade_features")
      .select("*")
      .eq("trade_id", trade_id)
      .maybeSingle();

    // If no features exist, compute them now
    if (!features) {
      console.log("Computing features for trade...");
      const computeResponse = await fetch(`${supabaseUrl}/functions/v1/compute-trade-features`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trade_id }),
      });
      
      if (computeResponse.ok) {
        const computeResult = await computeResponse.json();
        features = computeResult.features;
      }
    }

    // 3. Get compliance scores
    console.log("Scoring trade compliance...");
    const complianceResponse = await fetch(`${supabaseUrl}/functions/v1/score-trade-compliance`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trade_id }),
    });

    let complianceResult = {
      setup_compliance_score: 0,
      context_alignment_score: 0,
      rule_violations: [] as string[],
      matched_rules: [] as string[],
    };

    if (complianceResponse.ok) {
      complianceResult = await complianceResponse.json();
    }

    // 4. Find similar trades
    console.log("Finding similar trades...");
    const similarResponse = await fetch(`${supabaseUrl}/functions/v1/find-similar-trades`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trade_id, limit: 5 }),
    });

    let similarTrades = { similar_winners: [], similar_losers: [] };
    if (similarResponse.ok) {
      similarTrades = await similarResponse.json();
    }

    const review = trade.trade_reviews?.[0];
    let playbook = trade.playbook || review?.playbook;

    // Fallback: If no playbook from joined data, try to match by trade.playbook_id
    if (!playbook && trade.playbook_id) {
      console.log("No playbook from joins, trying to fetch by playbook_id:", trade.playbook_id);
      const { data: matchedPlaybook } = await supabase
        .from("playbooks")
        .select("*")
        .eq("id", trade.playbook_id)
        .maybeSingle();
      
      if (matchedPlaybook) {
        console.log("Matched playbook by ID:", matchedPlaybook.name);
        playbook = matchedPlaybook;
      }
    }

    // 5. Build prompt and call AI
    const userPrompt = buildUserPrompt(
      trade,
      review,
      playbook,
      features,
      complianceResult,
      similarTrades
    );

    // 6. Build multimodal messages with screenshots if available
    const screenshots = review?.screenshots || [];
    const hasScreenshots = Array.isArray(screenshots) && screenshots.length > 0;
    
    console.log(`Found ${screenshots.length} screenshots for visual analysis`);

    // Build user content - multimodal if screenshots exist
    const userContent: any[] = [{ type: "text", text: userPrompt }];
    
    if (hasScreenshots) {
      // Add up to 4 screenshots to avoid token limits
      for (const screenshot of screenshots.slice(0, 4)) {
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

    console.log("Calling Lovable AI with structured output...");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: hasScreenshots ? userContent : userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "trade_analysis",
              description: "Structured analysis of a trade against the trader's playbook and history",
              parameters: {
                type: "object",
                properties: {
                  technical_review: {
                    type: "object",
                    properties: {
                      matched_rules: {
                        type: "array",
                        items: { type: "string" },
                        description: "Rules from the playbook that were followed correctly"
                      },
                      deviations: {
                        type: "array",
                        items: { type: "string" },
                        description: "Rules or conditions that were violated"
                      },
                      failure_type: {
                        type: "string",
                        enum: ["structural", "execution", "both", "none"],
                        description: "Whether the outcome was due to setup issues (structural), trade management issues (execution), both, or neither"
                      }
                    },
                    required: ["matched_rules", "deviations", "failure_type"]
                  },
                  thesis_evaluation: {
                    type: "object",
                    description: "Evaluation of whether the trade thesis (idea) was correct, regardless of outcome",
                    properties: {
                      thesis_correct: {
                        type: "boolean",
                        description: "Whether the trade idea/thesis was fundamentally correct (e.g., price eventually went to target)"
                      },
                      thesis_explanation: {
                        type: "string",
                        description: "Explanation of why the thesis was correct or wrong"
                      },
                      failure_category: {
                        type: "string",
                        enum: ["thesis_wrong", "execution_failure", "external_factor", "no_failure"],
                        description: "Category of failure: thesis was wrong, execution was poor, external factor (news/late session), or no failure"
                      }
                    },
                    required: ["thesis_correct", "thesis_explanation", "failure_category"]
                  },
                  mistake_attribution: {
                    type: "object",
                    properties: {
                      primary: {
                        type: "string",
                        nullable: true,
                        description: "The main mistake made, if any"
                      },
                      secondary: {
                        type: "array",
                        items: { type: "string" },
                        description: "Contributing factors"
                      },
                      is_recurring: {
                        type: "boolean",
                        description: "Whether this appears to be a pattern based on similar trades"
                      }
                    },
                    required: ["primary", "secondary", "is_recurring"]
                  },
                  psychology_analysis: {
                    type: "object",
                    properties: {
                      influence: {
                        type: "string",
                        description: "How psychological state likely influenced the trade"
                      },
                      past_correlation: {
                        type: "string",
                        description: "How this correlates with past behavioral patterns"
                      },
                      psychology_vs_structure: {
                        type: "string",
                        enum: ["psychology", "structure", "both", "neither"],
                        description: "Whether psychology or market structure had more impact"
                      }
                    },
                    required: ["influence", "past_correlation", "psychology_vs_structure"]
                  },
                  comparison_to_past: {
                    type: "object",
                    properties: {
                      differs_from_winners: {
                        type: "array",
                        items: { type: "string" },
                        description: "How this trade differs from similar winning trades"
                      },
                      resembles_losers: {
                        type: "array",
                        items: { type: "string" },
                        description: "How this trade resembles similar losing trades"
                      }
                    },
                    required: ["differs_from_winners", "resembles_losers"]
                  },
                  actionable_guidance: {
                    type: "object",
                    properties: {
                      rule_to_reinforce: {
                        type: "string",
                        description: "One specific rule to reinforce or add based on this trade"
                      },
                      avoid_condition: {
                        type: "string",
                        description: "One specific condition under which to avoid similar trades"
                      }
                    },
                    required: ["rule_to_reinforce", "avoid_condition"]
                  },
                  visual_analysis: {
                    type: "object",
                    description: "Analysis based on chart screenshots (only if images provided)",
                    properties: {
                      entry_quality: {
                        type: "string",
                        description: "Assessment of entry location relative to price structure"
                      },
                      exit_quality: {
                        type: "string",
                        description: "Assessment of exit timing and location"
                      },
                      stop_placement: {
                        type: "string",
                        description: "Evaluation of stop loss placement relative to structure"
                      },
                      confirmations_visible: {
                        type: "array",
                        items: { type: "string" },
                        description: "Confirmation signals visually verified on the chart"
                      },
                      chart_observations: {
                        type: "array",
                        items: { type: "string" },
                        description: "Key observations from the chart that inform the analysis"
                      }
                    }
                  },
                  strategy_refinement: {
                    type: "object",
                    description: "Suggestions for improving the trading strategy",
                    properties: {
                      rule_suggestion: {
                        type: "string",
                        nullable: true,
                        description: "A new rule to add to the playbook based on this trade's outcome"
                      },
                      filter_recommendation: {
                        type: "string",
                        nullable: true,
                        description: "A condition to filter out similar losing setups in the future"
                      },
                      edge_observation: {
                        type: "string",
                        nullable: true,
                        description: "An observed edge or pattern that could be systematized"
                      }
                    }
                  },
                  confidence: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                    description: "Confidence in this analysis based on available data"
                  },
                  screenshots_analyzed: {
                    type: "boolean",
                    description: "Whether chart screenshots were analyzed"
                  }
                },
                required: [
                  "technical_review",
                  "thesis_evaluation",
                  "mistake_attribution",
                  "psychology_analysis",
                  "comparison_to_past",
                  "actionable_guidance",
                  "confidence",
                  "screenshots_analyzed"
                ]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "trade_analysis" } }
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log("AI response received");

    // Extract structured output from tool call
    let analysisOutput: AIAnalysisOutput | null = null;
    let rawAnalysis = "";

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        analysisOutput = JSON.parse(toolCall.function.arguments);
        rawAnalysis = toolCall.function.arguments;
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e);
      }
    }

    if (!analysisOutput) {
      // Fallback to content if tool call failed
      rawAnalysis = aiData.choices?.[0]?.message?.content || "No analysis generated";
      console.warn("Tool call not used, falling back to raw content");
    }

    // 6. Optionally store the AI review (skip if save=false)
    let savedReview = null;
    
    if (save) {
      const aiReviewData = {
        trade_id,
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
      };

      const { data: saved, error: saveError } = await supabase
        .from("ai_reviews")
        .upsert({ ...aiReviewData, updated_at: new Date().toISOString() }, { onConflict: "trade_id" })
        .select()
        .single();

      if (saveError) {
        console.error("Failed to save AI review:", saveError);
        return new Response(
          JSON.stringify({ error: "Analysis generated but failed to save. Please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      savedReview = saved;
      console.log("AI review saved:", savedReview.id);
    } else {
      console.log("Skipping save (save=false)");
    }

    return new Response(
      JSON.stringify({
        analysis: analysisOutput,
        compliance: complianceResult,
        similar_trades: similarTrades,
        raw_analysis: rawAnalysis,
        saved_review: savedReview,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("AI analysis error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
