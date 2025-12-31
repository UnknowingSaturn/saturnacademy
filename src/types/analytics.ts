export interface AnalyticsOverview {
  total_trades: number;
  total_pnl: number;
  win_rate: number;
  avg_r: number;
  profit_factor: number;
  date_range?: {
    start: string;
    end: string;
  };
}

export interface PlaybookPerformance {
  id: string;
  name: string;
  color: string;
  trades: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  total_pnl: number;
  expectancy: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface SymbolPerformance {
  symbol: string;
  trades: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  total_pnl: number;
  recommendation: 'focus' | 'neutral' | 'avoid';
}

export interface SessionMatrixEntry {
  session: string;
  direction: string;
  trades: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  total_pnl: number;
  avg_winner: number;
  avg_loser: number;
  rr_warning: boolean;
}

export interface JournalInsight {
  text: string;
  count: number;
}

export interface JournalInsights {
  common_mistakes: JournalInsight[];
  common_improvements: JournalInsight[];
  common_strengths: JournalInsight[];
  reviewed_trades: number;
  unreviewed_trades: number;
}

export interface DayPerformance {
  day: string;
  day_number: number;
  trades: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  total_pnl: number;
}

export interface RiskAnalysis {
  avg_risk_percent: number;
  risk_consistency: number;
  largest_loss_r: number;
  largest_win_r: number;
  trades_with_risk_data: number;
  risk_distribution: { bucket: string; count: number }[];
}

// Behavioral Analytics Types
export interface ChecklistCorrelation {
  full_pass: { trades: number; win_rate: number; avg_r: number };
  partial_pass: { trades: number; win_rate: number; avg_r: number };
  no_checklist: { trades: number; win_rate: number; avg_r: number };
}

export interface EmotionalImpact {
  state: string;
  trades: number;
  win_rate: number;
  avg_r: number;
}

export interface WinnerLoserComparison {
  playbook_name: string;
  winners: {
    count: number;
    avg_duration_minutes: number;
    avg_risk_percent: number;
    checklist_pass_rate: number;
  };
  losers: {
    count: number;
    avg_duration_minutes: number;
    avg_risk_percent: number;
    checklist_pass_rate: number;
  };
  key_differences: string[];
}

export interface RegimeByPlaybook {
  playbook_name: string;
  rotational: { trades: number; win_rate: number; avg_r: number };
  transitional: { trades: number; win_rate: number; avg_r: number };
  no_regime: { trades: number; win_rate: number; avg_r: number };
}

export interface RiskPatterns {
  winners_avg_risk: number;
  losers_avg_risk: number;
  risk_after_loss: number;
  risk_after_win: number;
  over_risking_on_losers: boolean;
}

export interface BehavioralAnalytics {
  checklist_correlation: ChecklistCorrelation;
  emotional_impact: EmotionalImpact[];
  winner_loser_comparison: WinnerLoserComparison[];
  regime_by_playbook: RegimeByPlaybook[];
  risk_patterns: RiskPatterns;
  sample_sizes: {
    total_trades: number;
    trades_with_checklist: number;
    trades_with_emotional_state: number;
    trades_with_regime: number;
  };
}

// AI Analysis Types
export interface MistakeMining {
  definition: string;
  frequency: number;
  total_r_lost: number;
  expectancy_impact: number;
  rule_change: string;
  skip_condition: string;
  sample_size?: number;
  confidence_level?: 'high' | 'medium' | 'low';
}

export interface Recommendation {
  trigger_condition: string;
  action: string;
  avoid: string;
  success_metric: string;
}

export interface PlaybookGrade {
  playbook_id: string;
  playbook_name: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  key_strength: string;
  key_weakness: string;
  focus_rule: string;
  sample_size?: number;
}

export interface EdgeSummary {
  what_works: string[];
  what_fails: string[];
  primary_leak: string;
  primary_edge: string;
}

export interface AIAnalysis {
  mistake_mining: MistakeMining[];
  recommendations: {
    rule_updates: Recommendation[];
    execution_updates: Recommendation[];
  };
  playbook_grades: PlaybookGrade[];
  edge_summary: EdgeSummary;
  insufficient_data: string[];
}

export interface TradeAnalytics {
  overview: AnalyticsOverview;
  playbook_comparison: PlaybookPerformance[];
  symbol_performance: SymbolPerformance[];
  session_matrix: SessionMatrixEntry[];
  journal_insights: JournalInsights;
  day_of_week: DayPerformance[];
  risk_analysis: RiskAnalysis;
  behavioral_analytics?: BehavioralAnalytics;
  ai_analysis?: AIAnalysis;
}
