// Trading types matching database schema

export type TradeDirection = 'buy' | 'sell';
export type EventType = 'open' | 'modify' | 'partial_close' | 'close';
export type AccountType = 'demo' | 'live' | 'prop';
export type PropFirm = 'ftmo' | 'fundednext' | 'other';
export type SessionType = 'tokyo' | 'london' | 'new_york' | 'overlap_london_ny' | 'off_hours';
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

// Model types for trade categorization
export type TradeModel = 'type_a' | 'type_b' | 'type_c';
export type TimeframeAlignment = '1min' | '5min' | '15min' | '1hr' | '4hr' | 'daily';
export type TradeProfile = 'consolidation' | 'expansion' | 'reversal' | 'continuation';

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
  model: TradeModel | null;
  alignment: TimeframeAlignment[] | null;
  entry_timeframes: TimeframeAlignment[] | null;
  profile: TradeProfile | null;
  place: string | null;
  trade_number: number | null;
  // Joined data
  review?: TradeReview;
  account?: Account;
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
  session_filter: SessionType[] | null;
  symbol_filter: string[] | null;
  checklist_questions: ChecklistQuestion[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
  screenshots: string[];
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