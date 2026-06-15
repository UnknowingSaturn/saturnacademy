// Report types — matching jsonb shapes in `reports` table

export type ReportType = 'weekly' | 'monthly' | 'custom';
export type ReportStatus = 'generating' | 'completed' | 'failed';
export type ReportGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ReportMetricsBlock {
  total_pnl: number;
  total_r: number;
  trade_count: number;
  win_rate: number;
  profit_factor: number;
  expectancy_r: number;
  max_drawdown_r: number;
  checklist_compliance_pct: number | null;
  avg_winner_r: number;
  avg_loser_r: number;
  avg_risk_pct: number | null;
}

export interface ReportMetrics {
  current: ReportMetricsBlock;
  prior: ReportMetricsBlock | null;
  deltas: Partial<Record<keyof ReportMetricsBlock, number>>;
  prior_period_label: string | null;
}

export interface CitedTradeRef {
  id: string;
  trade_number: number | null;
  symbol: string;
  date: string; // ISO
  net_pnl: number | null;
  r: number | null;
}

export interface EdgeCluster {
  label: string;            // "London / NAS100 / calm"
  dimensions: Record<string, string>;
  trades: number;
  wins: number;
  total_r: number;
  total_pnl: number;
  expectancy_r: number;
  trade_ids: string[];
  trade_refs: CitedTradeRef[];
}

export interface LeakCluster {
  label: string;            // human-readable behavioral pattern
  pattern_type: 'revenge' | 'overtrading_session' | 'overtrading_symbol' | 'oversize' | 'session_drift' | 'cluster';
  description: string;
  trades: number;
  wins: number;
  total_r: number;
  total_pnl: number;
  trade_ids: string[];
  trade_refs: CitedTradeRef[];
  worst_offender?: CitedTradeRef;
}

export interface ConsistencyAudit {
  time_discipline: {
    entry_hour_stddev_per_session: Record<string, number>;
    flagged_sessions: string[];
  };
  pair_concentration: {
    hhi: number;            // 0..1, higher = more concentrated
    top_symbol: string | null;
    top_symbol_share: number;
    flagged: boolean;
  };
  risk_consistency: {
    risk_pct_stddev: number;
    flagged: boolean;
    sample_size: number;
  };
  frequency_drift: {
    trades_per_day: number;
    baseline_trades_per_day: number;
    drift_ratio: number;    // current/baseline
    flagged: boolean;
  };
}

export interface PsychologyAnalysis {
  top_emotions: Array<{
    state: string;
    count: number;
    avg_r: number;
    sample_size_ok: boolean;
  }>;
  common_mistake_phrases: Array<{
    phrase: string;
    count: number;
    cost_r: number;
    trade_ids: string[];
  }>;
  emotion_outcome_correlations: Array<{
    state: string;
    n: number;
    win_rate: number;
    avg_r: number;
  }>;
  tilt_sequences: Array<{
    started_at: string;
    length: number;
    cumulative_r: number;
    trade_ids: string[];
  }>;
  reviewed_count: number;
  unreviewed_count: number;
}

export interface SenseiSection {
  heading: string;
  body: string;             // markdown
  cited_trade_ids: string[];
}

export interface SenseiNotes {
  sections: SenseiSection[];
}

export interface SchemaSuggestion {
  missing_field: string;
  reason: string;
  proposed_widget: 'select' | 'text' | 'rating' | 'number' | 'boolean';
  proposed_options?: string[];
  example_trade_ids: string[];
  proposed_question: {
    id: string;
    label: string;
    type: 'select' | 'text' | 'rating' | 'number' | 'boolean';
    options?: string[];
  };
}

// Planned-vs-actual playbook grading. Computed by generate-report when
// at least 5 trades carry both a planned and an actual classifier.
export interface ReadQualityBlock {
  graded_count: number;
  match: number;
  partial: number;
  mismatch: number;
  win_rate_when_correctly_read: number | null;
  win_rate_when_misread: number | null;
  top_misreads: Array<{ pair: string; count: number }>;
}

export interface ReportGoal {
  id: string;
  text: string;             // "Reduce post-loss trades opened within 30min from 5 to ≤1"
  metric: string;           // machine-checkable metric name
  baseline: number;
  target: number;
  comparator: 'lte' | 'gte' | 'eq';
  status?: 'pending' | 'met' | 'missed';
  actual?: number;
}

export interface PriorGoalsEvaluation {
  evaluated_at: string;
  goals: Array<ReportGoal & { status: 'met' | 'missed'; actual: number }>;
}

export interface QuantBucketSummary {
  label: string;
  n: number;
  win_rate_pct: number;
  expected_r: number;
  expected_r_ci: [number, number] | null;
  mfe_p75_r: number | null;
  mae_p75_r: number | null;
  sl_drift: "too_wide" | "too_tight" | "aligned" | null;
  most_common_tp_hit: string | null;
  suggested_sl_pips: number | null;
  /** "pips" for FX/metals/crypto/oil, "points" for indices. */
  sl_unit: "pips" | "points";
  tp_ladder_r: number[];
  tp1_star: { r: number; hit_rate_pct: number; expectancy_r: number } | null;
  suggested_risk_pct: number | null;
  /** Prop-firm-aware cap; null when no prop firm linked. */
  suggested_risk_pct_propfirm_cap: number | null;
  confidence: "high" | "medium" | "low";
  top_trade_ids: string[];
  bottom_trade_ids: string[];
}

export interface QuantAdvice {
  bucket_label: string;
  finding: string;
  parameter: "sl" | "tp" | "risk" | "strategy";
  current_value: string;
  suggested_value: string;
  expected_uplift_r: number;
  confidence: "high" | "medium" | "low";
  unit?: "pips" | "points" | "R" | "%";
  n_eligible?: number;
  bias_warning?: boolean;
  cited_trade_ids: string[];
}

export interface PropFirmContext {
  firm: string;
  balance: number;
  daily_loss_dollars: number | null;
  max_drawdown_dollars: number | null;
  profit_target_dollars: number | null;
}

export interface SenseiQuality {
  /** Numbers cited in Sensei prose that don't match any deterministic fact (±5%). */
  ungrounded_numbers: Array<{ section: string; value: number }>;
  warnings: string[];
}

export interface QuantBlock {
  coverage: { sl: number; mfe: number; mae: number; total: number };
  baseline: QuantBucketSummary;
  buckets_top: QuantBucketSummary[];
  buckets_bottom: QuantBucketSummary[];
  strategy_replay: Array<{
    preset_id: string;
    label: string;
    n_eligible: number;
    total_considered: number;
    win_rate: number;
    expectancy_r: number;
    delta_vs_current: number;
    /** Bias-adjusted delta, computed on the trade intersection with `current`. */
    delta_vs_current_intersection: number | null;
    n_comparable: number;
    bias_warning: boolean;
    mean_reached_r: number | null;
    ci: [number, number] | null;
  }>;
  min_eligible_sample: number;
  prop_firm_context: PropFirmContext | null;
  advice?: QuantAdvice[];
  sensei_quality?: SenseiQuality;
}

export interface Report {
  id: string;
  user_id: string;
  account_id: string | null;
  report_type: ReportType;
  period_start: string;
  period_end: string;
  generated_at: string;

  metrics: ReportMetrics;
  edge_clusters: EdgeCluster[];
  leak_clusters: LeakCluster[];
  consistency: ConsistencyAudit;
  psychology: PsychologyAnalysis;

  sensei_notes: SenseiNotes | null;
  sensei_model: string | null;
  sensei_regenerated_at?: string | null;

  schema_suggestions: SchemaSuggestion[];
  goals: ReportGoal[];
  prior_goals_evaluation: PriorGoalsEvaluation | null;

  read_quality: ReadQualityBlock | null;
  quant: QuantBlock | null;

  verdict: string | null;
  grade: ReportGrade | null;

  status: ReportStatus;
  error_message: string | null;

  created_at: string;
  updated_at: string;
}
