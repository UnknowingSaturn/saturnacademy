import { AIReview, AIAnalysisOutput, SimilarTrade } from "@/types/trading";

export interface AIAnalysisDisplayData {
  analysis: AIAnalysisOutput | null;
  compliance: {
    setup_compliance_score: number;
    context_alignment_score: number;
    rule_violations: string[];
    matched_rules: string[];
  };
  similarTrades: {
    similar_winners: SimilarTrade[];
    similar_losers: SimilarTrade[];
  };
}

/**
 * Transforms an AIReview from the database into the display format
 * used by AIAnalysisDisplay component.
 */
export function aiReviewToDisplayFormat(aiReview: AIReview): AIAnalysisDisplayData {
  return {
    analysis: {
      technical_review: aiReview.technical_review || { matched_rules: [], deviations: [], failure_type: 'none' },
      thesis_evaluation: aiReview.thesis_evaluation,
      mistake_attribution: aiReview.mistake_attribution || { primary: null, secondary: [], is_recurring: false },
      psychology_analysis: aiReview.psychology_analysis || { influence: '', past_correlation: '', psychology_vs_structure: 'neither' },
      comparison_to_past: aiReview.comparison_to_past || { differs_from_winners: [], resembles_losers: [] },
      actionable_guidance: aiReview.actionable_guidance || { rule_to_reinforce: '', avoid_condition: '' },
      visual_analysis: aiReview.visual_analysis,
      strategy_refinement: aiReview.strategy_refinement,
      confidence: aiReview.confidence || 'low',
      screenshots_analyzed: aiReview.screenshots_analyzed ?? false,
    },
    compliance: {
      setup_compliance_score: aiReview.setup_compliance_score || 0,
      context_alignment_score: aiReview.context_alignment_score || 0,
      rule_violations: aiReview.rule_violations || [],
      matched_rules: aiReview.technical_review?.matched_rules || [],
    },
    similarTrades: {
      similar_winners: [], // Similar trades are stored as IDs, would need separate fetch
      similar_losers: [],
    },
  };
}

/**
 * Check if an AIReview has any meaningful analysis data
 */
export function hasAIAnalysis(aiReview: AIReview | undefined | null): boolean {
  if (!aiReview) return false;
  
  // Check if technical_review has any content
  const tech = aiReview.technical_review;
  if (tech && (tech.matched_rules?.length > 0 || tech.deviations?.length > 0)) {
    return true;
  }
  
  // Check if there's raw analysis
  if (aiReview.raw_analysis && aiReview.raw_analysis.trim().length > 0) {
    return true;
  }
  
  return false;
}
