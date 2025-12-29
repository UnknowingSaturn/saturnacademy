// Trading types matching database schema

export type TradeDirection = 'buy' | 'sell';
export type EventType = 'open' | 'modify' | 'partial_close' | 'close';
export type AccountType = 'demo' | 'live' | 'prop';
export type PropFirm = 'ftmo' | 'fundednext' | 'other';
export type SessionType = 'tokyo' | 'london' | 'new_york' | 'new_york_am' | 'new_york_pm' | 'overlap_london_ny' | 'off_hours';
export type RegimeType = 'rotational' | 'transitional';
export type NewsRisk = 'none' | 'low' | 'high';
export type EmotionalState = 
  | 'great' | 'good' | 'calm' | 'confident' | 'focused'
  | 'alright' | 'okay' | 'normal'
  | 'rough' | 'anxious' | 'fomo' | 'revenge' | 'tilted' | 'exhausted';
export type AIProvider = 'openai' | 'gemini' | 'lovable';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  broker: string | null;
  account_number: string | null;
  terminal_id: string | null;
  account_type: AccountType;
  prop_firm: PropFirm | null;
  balance_start: number;
  equity_current: number;
  is_active: boolean;
  api_key: string | null;
  broker_utc_offset: number; // Broker server UTC offset in hours (e.g., 2 for UTC+2)
  created_at: string;
  updated_at: string;
}

export interface TradeEvent {
  id: string;
  idempotency_key: string;
  account_id: string | null;
  terminal_id: string | null;
  event_type: EventType;
  ticket: number;
  symbol: string;
  direction: TradeDirection;
  lot_size: number;
  price: number;
  sl: number | null;
  tp: number | null;
  commission: number;
  swap: number;
  profit: number | null;
  event_timestamp: string;
  raw_payload: Record<string, unknown> | null;
  ingested_at: string;
  processed: boolean;
}

// Model types for trade categorization (now dynamic from playbooks)
export type TimeframeAlignment = '1min' | '5min' | '15min' | '1hr' | '4hr' | 'daily';
export type TradeProfile = 'consolidation' | 'expansion' | 'reversal' | 'continuation';

// Chart timeframes for screenshot gallery
export type ChartTimeframe = '1m' | '5m' | '15m' | '30m' | '1H' | '4H' | 'D' | 'W' | 'M';

export interface TradeScreenshot {
  id: string;
  timeframe: ChartTimeframe;
  url: string;
  description: string;
  created_at: string;
}

export interface Trade {
  id: string;
  user_id: string;
  account_id: string | null;
  terminal_id: string | null;
  ticket: number | null;
  symbol: string;
  direction: TradeDirection;
  total_lots: number;
  entry_price: number;
  entry_time: string;
  exit_price: number | null;
  exit_time: string | null;
  sl_initial: number | null;
  tp_initial: number | null;
  sl_final: number | null;
  tp_final: number | null;
  gross_pnl: number | null;
  commission: number;
  swap: number;
  net_pnl: number | null;
  r_multiple_planned: number | null;
  r_multiple_actual: number | null;
  session: SessionType | null;
  duration_seconds: number | null;
  partial_closes: PartialClose[];
  is_open: boolean;
  created_at: string;
  updated_at: string;
  // New Notion-style fields
  playbook_id: string | null; // UUID reference to playbooks table
  alignment: TimeframeAlignment[] | null;
  entry_timeframes: TimeframeAlignment[] | null;
  profile: TradeProfile | null;
  place: string | null;
  trade_number: number | null;
  // Joined data
  review?: TradeReview;
  account?: Account;
  playbook?: Playbook;
}

export interface PartialClose {
  time: string;
  lots: number;
  price: number;
  pnl: number;
}

export interface Playbook {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string; // Customizable color for card and model column
  session_filter: SessionType[] | null;
  symbol_filter: string[] | null;
  checklist_questions: ChecklistQuestion[];
  // Enhanced playbook rules for AI analysis
  valid_regimes: RegimeType[];
  entry_zone_rules: EntryZoneRules;
  confirmation_rules: string[];
  invalidation_rules: string[];
  management_rules: string[];
  failure_modes: string[];
  // Risk management limits
  max_r_per_trade: number | null;
  max_daily_loss_r: number | null;
  max_trades_per_session: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EntryZoneRules {
  min_percentile?: number;
  max_percentile?: number;
  require_htf_alignment?: boolean;
}

export interface ChecklistQuestion {
  id: string;
  question: string;
  order: number;
}

export interface TradeReview {
  id: string;
  trade_id: string;
  playbook_id: string | null;
  checklist_answers: Record<string, boolean>;
  score: number;
  regime: RegimeType | null;
  news_risk: NewsRisk;
  emotional_state_before: EmotionalState | null;
  emotional_state_after: EmotionalState | null;
  psychology_notes: string | null;
  mistakes: string[];
  did_well: string[];
  to_improve: string[];
  actionable_steps: ActionableStep[];
  thoughts: string | null;
  screenshots: TradeScreenshot[] | string[]; // Supports both new and legacy formats
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  playbook?: Playbook;
}

export interface ActionableStep {
  text: string;
  completed: boolean;
}

export interface TradeComment {
  id: string;
  trade_id: string;
  user_id: string;
  content: string;
  screenshot_url: string | null;
  created_at: string;
}

export interface AIPrompt {
  id: string;
  user_id: string | null;
  name: string;
  prompt_type: string;
  provider: AIProvider;
  system_prompt: string;
  user_prompt_template: string | null;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PropFirmRule {
  id: string;
  firm: PropFirm;
  rule_name: string;
  rule_type: string;
  value: number;
  is_percentage: boolean;
  description: string | null;
  created_at: string;
}

// API Types
export interface EventIngestionRequest {
  idempotency_key: string;
  terminal_id: string;
  account_id?: string;
  event_type: EventType;
  ticket: number;
  symbol: string;
  direction: TradeDirection;
  lot_size: number;
  price: number;
  sl?: number;
  tp?: number;
  commission?: number;
  swap?: number;
  profit?: number;
  timestamp: string;
  raw_payload?: Record<string, unknown>;
}

export interface EventIngestionResponse {
  status: 'accepted' | 'duplicate' | 'error';
  event_id?: string;
  message: string;
  retry_after?: number;
}

export interface OverlayTrade {
  ticket: number;
  symbol: string;
  direction: TradeDirection;
  entry: { price: number; time: string };
  exit: { price: number; time: string } | null;
  sl: number | null;
  tp: number | null;
  r_multiple: number | null;
  result: 'win' | 'loss' | 'breakeven' | 'open';
}

// Trade Features (computed by edge function)
export interface TradeFeatures {
  id: string;
  trade_id: string;
  day_of_week: number | null;
  time_since_session_open_mins: number | null;
  volatility_regime: 'low' | 'normal' | 'high' | null;
  range_size_pips: number | null;
  entry_percentile: number | null;
  distance_to_mean_pips: number | null;
  htf_bias: 'bull' | 'bear' | 'neutral' | null;
  entry_efficiency: number | null;
  exit_efficiency: number | null;
  stop_location_quality: number | null;
  computed_at: string;
}

// AI Analysis structured output
export interface AIAnalysisOutput {
  technical_review: {
    matched_rules: string[];
    deviations: string[];
    failure_type: 'structural' | 'execution' | 'both' | 'none';
  };
  mistake_attribution: {
    primary: string | null;
    secondary: string[];
    is_recurring: boolean;
  };
  psychology_analysis: {
    influence: string;
    past_correlation: string;
    psychology_vs_structure: 'psychology' | 'structure' | 'both' | 'neither';
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
  confidence: 'low' | 'medium' | 'high';
  screenshots_analyzed?: boolean;
}

// AI Review (stored in database)
export interface AIReview {
  id: string;
  trade_id: string;
  technical_review: AIAnalysisOutput['technical_review'];
  mistake_attribution: AIAnalysisOutput['mistake_attribution'];
  psychology_analysis: AIAnalysisOutput['psychology_analysis'];
  comparison_to_past: AIAnalysisOutput['comparison_to_past'];
  actionable_guidance: AIAnalysisOutput['actionable_guidance'];
  confidence: AIAnalysisOutput['confidence'];
  setup_compliance_score: number;
  rule_violations: string[];
  context_alignment_score: number;
  similar_winners: string[];
  similar_losers: string[];
  raw_analysis: string;
  created_at: string;
  updated_at: string;
}

// AI Feedback for learning loop
export interface AIFeedback {
  id: string;
  ai_review_id: string;
  user_id: string;
  is_accurate: boolean | null;
  is_useful: boolean | null;
  feedback_notes: string | null;
  created_at: string;
}

// Similar trade for display
export interface SimilarTrade {
  trade_id: string;
  similarity_score: number;
  net_pnl: number;
  r_multiple: number | null;
  symbol: string;
  session: string | null;
  entry_percentile: number | null;
}

// Dashboard metrics
export interface DashboardMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgRMultiple: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
  currentStreak: { type: 'win' | 'loss'; count: number };
  bySession: Record<SessionType, SessionMetrics>;
}

export interface SessionMetrics {
  trades: number;
  winRate: number;
  totalPnl: number;
  avgR: number;
}

// CSV Import types
export interface CSVImportRow {
  date?: string;
  pair?: string;
  symbol?: string;
  session?: string;
  direction?: string;
  entry_price?: string;
  exit_price?: string;
  sl?: string;
  tp?: string;
  lot_size?: string;
  rr?: string;
  result?: string;
  pnl?: string;
  emotional_state?: string;
  notes?: string;
  [key: string]: string | undefined;
}

export interface CSVColumnMapping {
  csvColumn: string;
  dbField: keyof Trade | 'emotional_state' | 'notes' | 'skip';
}