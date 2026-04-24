
export interface LiveTradeQuestion {
  id: string;
  type: 'text' | 'select' | 'rating';
  label: string;
  options?: string[];
}

export const DEFAULT_LIVE_TRADE_QUESTIONS: LiveTradeQuestion[] = [
  { id: "emotional_state", type: "select", label: "How are you feeling?", options: ["Focused", "Calm", "Confident", "Anxious", "FOMO", "Frustrated"] },
  { id: "setup_confidence", type: "rating", label: "Setup confidence (1-5)" },
  { id: "entry_reasoning", type: "text", label: "Why did you enter this trade?" },
  { id: "market_context", type: "text", label: "Market context / regime" },
];

export interface ColumnOverride {
  label?: string;
  width?: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  visible_columns: string[];
  column_order: string[];
  column_overrides: Record<string, ColumnOverride>;
  default_filters: FilterCondition[];
  live_trade_questions: LiveTradeQuestion[];
  display_timezone: string;
  created_at: string;
  updated_at: string;
}

export type CustomFieldType = 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url';

export interface CustomFieldOption {
  value: string;
  label: string;
  color?: string;
}

export interface CustomFieldDefinition {
  id: string;
  user_id: string;
  key: string;            // e.g. 'cf_setup_grade'
  label: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  default_value: any;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionDefinition {
  id: string;
  user_id: string;
  name: string;
  key: string;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  timezone: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PropertyOption {
  id: string;
  user_id: string;
  property_name: string;
  value: string;
  label: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FilterCondition {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string | number | string[] | null;
}

export type FilterOperator = 
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'is_empty'
  | 'is_not_empty'
  | 'in';

export interface ColumnDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multi-select' | 'badge';
  sortable: boolean;
  filterable: boolean;
  hideable: boolean;
  width?: string;
  propertyName?: string; // For columns that use property_options
  category: 'calculated' | 'editable';
}

// Columns ordered: calculated/auto fields first, then editable fields
// Using minmax() with fr units for proportional scaling that fills available space
export const DEFAULT_COLUMNS: ColumnDefinition[] = [
  // Calculated/Auto fields (left side) — all hideable now (Notion-style flexibility)
  { key: 'trade_number', label: '#', type: 'number', sortable: true, filterable: true, hideable: true, width: 'minmax(40px, 0.4fr)', category: 'calculated' },
  { key: 'account', label: 'Account', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(80px, 1fr)', category: 'calculated' },
  { key: 'entry_time', label: 'Date (EST)', type: 'date', sortable: true, filterable: true, hideable: true, width: 'minmax(110px, 1.5fr)', category: 'calculated' },
  { key: 'day', label: 'Day', type: 'text', sortable: true, filterable: true, hideable: true, width: 'minmax(50px, 0.5fr)', category: 'calculated' },
  { key: 'symbol', label: 'Pair', type: 'text', sortable: true, filterable: true, hideable: true, width: 'minmax(70px, 1fr)', category: 'calculated' },
  { key: 'r_multiple_actual', label: 'RR', type: 'number', sortable: true, filterable: true, hideable: true, width: 'minmax(60px, 0.8fr)', category: 'calculated' },
  { key: 'account_pct', label: 'Acct %', type: 'number', sortable: true, filterable: true, hideable: true, width: 'minmax(70px, 0.9fr)', category: 'calculated' },
  { key: 'result', label: 'Result', type: 'badge', sortable: true, filterable: true, hideable: true, width: 'minmax(70px, 0.8fr)', category: 'calculated' },
  { key: 'trade_type', label: 'Type', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(80px, 1fr)', category: 'calculated' },
  // User-editable fields (right side)
  { key: 'session', label: 'Session', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'session', category: 'editable' },
  { key: 'model', label: 'Planned Model', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.5fr)', propertyName: 'model', category: 'editable' },
  { key: 'actual_model', label: 'Actual Model', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.5fr)', propertyName: 'model', category: 'editable' },
  { key: 'read_quality', label: 'Read', type: 'badge', sortable: true, filterable: true, hideable: true, width: 'minmax(70px, 0.8fr)', category: 'calculated' },
  { key: 'alignment', label: 'Alignment', type: 'multi-select', sortable: false, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'timeframe', category: 'editable' },
  { key: 'entry_timeframes', label: 'Entry', type: 'multi-select', sortable: false, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'timeframe', category: 'editable' },
  { key: 'profile', label: 'Profile', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'profile', category: 'editable' },
  { key: 'emotional_state_before', label: 'Emotion', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'emotion', category: 'editable' },
  { key: 'place', label: 'Place', type: 'text', sortable: true, filterable: true, hideable: true, width: 'minmax(80px, 1fr)', category: 'editable' },
];

// System fields whose values can be safely bulk-wiped from every trade without breaking
// the journal. Anything NOT in this set is core record data (symbol, prices, lots, P&L, times)
// and only supports soft-delete (hide).
export const ERASABLE_SYSTEM_FIELDS: Record<string, true> = {
  session: true,
  playbook_id: true,
  actual_playbook_id: true,
  profile: true,
  actual_profile: true,
  actual_regime: true,
  place: true,
  alignment: true,
  entry_timeframes: true,
  emotional_state_before: true,
  // computed/display columns — non-destructive (no underlying field to wipe)
  // they are listed here so the UI can offer Erase as a no-op-safe action
  // omit: trade_number, account, day, symbol, entry_time, r_multiple_actual,
  //       account_pct, result, trade_type, model (display-only), actual_model,
  //       read_quality (computed)
};

// Some columns are computed/display-only — they have no underlying scalar field on `trades`,
// so "erase" doesn't make sense. They support soft-delete (hide) only.
export const COMPUTED_DISPLAY_COLUMNS: Record<string, true> = {
  trade_number: true,
  account: true,
  day: true,
  r_multiple_actual: true,
  account_pct: true,
  result: true,
  trade_type: true,
  read_quality: true,
  model: true,
  actual_model: true,
  entry_time: true,
  symbol: true,
};

export function canEraseSystemField(key: string): boolean {
  return ERASABLE_SYSTEM_FIELDS[key] === true;
}

export const DEFAULT_VISIBLE_COLUMNS = [
  // Calculated first
  'trade_number', 'entry_time', 'day', 'symbol', 'r_multiple_actual', 'account_pct', 'result',
  // Editable after
  'session', 'model', 'alignment', 'entry_timeframes', 'profile', 'emotional_state_before', 'place'
];

// Build a ColumnDefinition from a custom field definition so it slots into the same render path.
export function customFieldToColumn(def: CustomFieldDefinition): ColumnDefinition {
  const typeMap: Record<CustomFieldType, ColumnDefinition['type']> = {
    text: 'text',
    url: 'text',
    number: 'number',
    select: 'select',
    multi_select: 'multi-select',
    date: 'date',
    checkbox: 'badge',
  };
  return {
    key: def.key,
    label: def.label,
    type: typeMap[def.type],
    sortable: def.type !== 'multi_select',
    filterable: true,
    hideable: true,
    width: 'minmax(100px, 1.2fr)',
    category: 'editable',
  };
}

// Merge system columns + active custom field columns, applying user overrides (label, width).
export function buildColumnRegistry(
  customFields: CustomFieldDefinition[] = [],
  overrides: Record<string, ColumnOverride> = {}
): ColumnDefinition[] {
  const customCols = customFields
    .filter((f) => f.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(customFieldToColumn);

  return [...DEFAULT_COLUMNS, ...customCols].map((col) => {
    const ov = overrides[col.key];
    if (!ov) return col;
    return {
      ...col,
      label: ov.label ?? col.label,
      width: ov.width ?? col.width,
    };
  });
}

export const DEFAULT_SESSIONS: Omit<SessionDefinition, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  { name: 'Tokyo', key: 'tokyo', start_hour: 19, start_minute: 0, end_hour: 4, end_minute: 0, timezone: 'America/New_York', color: '#EC4899', sort_order: 0, is_active: true },
  { name: 'London', key: 'london', start_hour: 3, start_minute: 0, end_hour: 12, end_minute: 0, timezone: 'America/New_York', color: '#3B82F6', sort_order: 1, is_active: true },
  { name: 'NY AM', key: 'new_york_am', start_hour: 8, start_minute: 0, end_hour: 12, end_minute: 0, timezone: 'America/New_York', color: '#F59E0B', sort_order: 2, is_active: true },
  { name: 'NY PM', key: 'new_york_pm', start_hour: 12, start_minute: 0, end_hour: 17, end_minute: 0, timezone: 'America/New_York', color: '#F59E0B', sort_order: 3, is_active: true },
  { name: 'Off Hours', key: 'off_hours', start_hour: 17, start_minute: 0, end_hour: 19, end_minute: 0, timezone: 'America/New_York', color: '#6B7280', sort_order: 4, is_active: true },
];

export const DEFAULT_PROPERTY_OPTIONS: Omit<PropertyOption, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  // Models are now dynamic from playbooks - no static options needed
  // Profiles
  { property_name: 'profile', value: 'consolidation', label: 'Consolidation', color: '#3B82F6', sort_order: 0, is_active: true },
  { property_name: 'profile', value: 'expansion', label: 'Expansion', color: '#22C55E', sort_order: 1, is_active: true },
  { property_name: 'profile', value: 'reversal', label: 'Reversal', color: '#EAB308', sort_order: 2, is_active: true },
  { property_name: 'profile', value: 'continuation', label: 'Continuation', color: '#6B7280', sort_order: 3, is_active: true },
  // Timeframes
  { property_name: 'timeframe', value: '1min', label: '1min', color: '#6B7280', sort_order: 0, is_active: true },
  { property_name: 'timeframe', value: '5min', label: '5min', color: '#6B7280', sort_order: 1, is_active: true },
  { property_name: 'timeframe', value: '15min', label: '15min', color: '#3B82F6', sort_order: 2, is_active: true },
  { property_name: 'timeframe', value: '1hr', label: '1hr', color: '#3B82F6', sort_order: 3, is_active: true },
  { property_name: 'timeframe', value: '4hr', label: '4hr', color: '#22C55E', sort_order: 4, is_active: true },
  { property_name: 'timeframe', value: 'daily', label: 'Daily', color: '#22C55E', sort_order: 5, is_active: true },
  // Emotions
  { property_name: 'emotion', value: 'great', label: 'Great', color: '#22C55E', sort_order: 0, is_active: true },
  { property_name: 'emotion', value: 'good', label: 'Good', color: '#22C55E', sort_order: 1, is_active: true },
  { property_name: 'emotion', value: 'calm', label: 'Calm', color: '#22C55E', sort_order: 2, is_active: true },
  { property_name: 'emotion', value: 'confident', label: 'Confident', color: '#22C55E', sort_order: 3, is_active: true },
  { property_name: 'emotion', value: 'focused', label: 'Focused', color: '#22C55E', sort_order: 4, is_active: true },
  { property_name: 'emotion', value: 'alright', label: 'Alright', color: '#6B7280', sort_order: 5, is_active: true },
  { property_name: 'emotion', value: 'okay', label: 'Okay', color: '#6B7280', sort_order: 6, is_active: true },
  { property_name: 'emotion', value: 'normal', label: 'Normal', color: '#6B7280', sort_order: 7, is_active: true },
  { property_name: 'emotion', value: 'rough', label: 'Rough', color: '#EF4444', sort_order: 8, is_active: true },
  { property_name: 'emotion', value: 'anxious', label: 'Anxious', color: '#EF4444', sort_order: 9, is_active: true },
  { property_name: 'emotion', value: 'fomo', label: 'FOMO', color: '#EF4444', sort_order: 10, is_active: true },
  { property_name: 'emotion', value: 'revenge', label: 'Revenge', color: '#EF4444', sort_order: 11, is_active: true },
  { property_name: 'emotion', value: 'tilted', label: 'Tilted', color: '#EF4444', sort_order: 12, is_active: true },
  { property_name: 'emotion', value: 'exhausted', label: 'Exhausted', color: '#EF4444', sort_order: 13, is_active: true },
];
