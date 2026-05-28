// Trading types matching database schema

export type TradeDirection = 'buy' | 'sell';
export type EventType = 'open' | 'modify' | 'partial_close' | 'close';
export type AccountType = 'demo' | 'live' | 'prop';
export type PropFirm = 'ftmo' | 'fundednext' | 'other';
// Session is free-form text (matches session_definitions.key) — well-known values listed for UI defaults.
export type SessionType = string;
export const KNOWN_SESSIONS = ['tokyo', 'london', 'new_york', 'new_york_am', 'new_york_pm', 'overlap_london_ny', 'off_hours'] as const;
export type KnownSession = typeof KNOWN_SESSIONS[number];
export type RegimeType = 'rotational' | 'transitional';
export type NewsRisk = 'none' | 'low' | 'high';
export type TradeType = 'executed' | 'idea' | 'paper' | 'missed';
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

export type CopierRole = 'independent' | 'master' | 'receiver';


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
  broker_utc_offset: number; // Broker server UTC offset in hours (legacy MANUAL fallback)
  broker_dst_profile: 'EET_DST' | 'GMT_DST' | 'FIXED_PLUS_3' | 'FIXED_PLUS_2' | 'FIXED_PLUS_0' | 'MANUAL';
  // Copier fields
  copier_role: CopierRole;
  master_account_id: string | null;
  copier_enabled: boolean;
  // EA type from installation
  ea_type: EAType | null;
  // Historical sync settings
  sync_history_enabled: boolean;
  sync_history_from: string | null;
  // Multi-account sync tracking
  mt5_install_id?: string | null;
  last_sync_at?: string | null;
  // Live state — managed by EA heartbeats + mark-dormant-accounts cron
  live_state?: 'live' | 'dormant' | 'verifying' | 'stale';
  last_heartbeat_at?: string | null;
  force_resync?: boolean;
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
  original_lots: number | null;
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
  partial_fills?: PartialFill[];
  repair_events?: RepairEvent[];
  is_open: boolean;
  awaiting_exit?: boolean;
  is_archived?: boolean;
  archived_at?: string;
  created_at: string;
  updated_at: string;
  // Balance tracking
  balance_at_entry: number | null;
  equity_at_entry: number | null;
  // New Notion-style fields
  playbook_id: string | null; // UUID reference to playbooks table — PLANNED model at entry
  alignment: TimeframeAlignment[] | null;
  entry_timeframes: TimeframeAlignment[] | null;
  profile: TradeProfile | null; // PLANNED profile at entry
  place: string | null;
  // Hindsight grading — what the trade ACTUALLY turned out to be
  actual_playbook_id: string | null;
  actual_profile: TradeProfile | null;
  actual_regime: RegimeType | null;
  trade_number: number | null;
  trade_type: TradeType; // Type of trade: executed, idea, paper, or missed
  risk_percent: number | null; // Percentage of balance/equity risked (for idea/paper/missed trades)
  // Repair state — populated by ingest's gap-sync; 'advisory_closed' means we inferred the close
  // from a snapshot rather than seeing the actual DEAL_ENTRY_OUT event.
  repair_state?: 'none' | 'advisory_closed' | 'reconciled' | null;
  // Additive Phase D fields — resolved by trade_view at read time
  install_id?: string | null;
  broker_login?: string | null;
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

export interface PartialFill {
  id: string;
  trade_id: string;
  ticket: number | null;
  deal_id: number | null;
  lots: number;
  price: number;
  profit: number | null;
  commission: number | null;
  swap: number | null;
  occurred_at: string;
  created_at: string;
}

export interface RepairEvent {
  id: string;
  trade_id: string;
  action: string;
  source: string | null;
  metadata: Record<string, unknown>;
  applied_at: string;
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
  // Setup example screenshots
  screenshots: TradeScreenshot[];
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
