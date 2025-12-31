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

export interface TradeAnalytics {
  overview: AnalyticsOverview;
  playbook_comparison: PlaybookPerformance[];
  symbol_performance: SymbolPerformance[];
  session_matrix: SessionMatrixEntry[];
  journal_insights: JournalInsights;
  day_of_week: DayPerformance[];
  risk_analysis: RiskAnalysis;
}
