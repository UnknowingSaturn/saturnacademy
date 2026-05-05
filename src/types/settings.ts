
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
  // Notion-style layout for the trade detail panel
  detail_visible_fields: string[];      // empty array = use defaults
  detail_field_order: string[];          // empty array = use defaults
  detail_visible_sections: string[];    // empty array = use defaults
  detail_section_order: string[];        // empty array = use defaults
  // Map field key -> renamed label (applies to detail sidebar AND table header)
  field_label_overrides: Record<string, string>;
  created_at: string;
  updated_at: string;
}

// Field keys that are CORE record data and cannot be hard-deleted (only hidden).
// Anything not in this set + not a custom field is an "editable system field".
export const CORE_FIELD_KEYS = new Set<string>([
  'trade_number', 'entry_time', 'date', 'day', 'pair', 'symbol',
  'direction', 'pnl', 'r_pct', 'r_multiple_actual', 'account_pct',
  'result', 'trade_type', 'status', 'account', 'read_quality',
]);

export function isCoreField(key: string): boolean {
  return CORE_FIELD_KEYS.has(key);
}

// Resolve the user-facing label for any field key, honoring user overrides.
export function resolveFieldLabel(
  key: string,
  fallback: string,
  overrides: Record<string, string> | undefined,
): string {
  return overrides?.[key]?.trim() || fallback;
}

// Catalog of fields available in the trade detail "Properties" sidebar.
// Each entry tells the renderer how to display + edit one row.
// Custom fields are appended dynamically at runtime.
export type DetailFieldKind =
  | 'readonly'           // pure display (e.g. P&L)
  | 'select'             // single select from property_options
  | 'multi-select'       // multi select from property_options
  | 'playbook-select'    // single select from playbooks
  | 'dual-playbook'      // planned + actual playbook side-by-side
  | 'dual-select'        // planned + actual property_options
  | 'dual-multi'         // planned + actual multi-select
  | 'text'               // free text inline edit
  | 'account-select';    // accounts dropdown (manual trades)

export interface DetailFieldDef {
  key: string;
  label: string;
  kind: DetailFieldKind;
  propertyName?: string;       // for select/multi → property_options group
  // For dual fields, we read/write two separate trade columns:
  plannedField?: string;
  actualField?: string;
  // For non-dual editable fields, we read/write one trade column / review field:
  field?: string;
  isReviewField?: boolean;     // true → store in trade_reviews, not trades
  defaultVisible?: boolean;
}

// Catalog of larger review sections inside the trade detail body.
export type DetailSectionKey =
  | 'screenshots'
  | 'checklist'
  | 'psychology_notes'
  | 'mistakes'
  | 'did_well'
  | 'to_improve'
  | 'actionable_steps';

export interface DetailSectionDef {
  key: DetailSectionKey;
  label: string;
  defaultVisible?: boolean;
}

// Default catalog used by both the renderer and the settings UI.
// Each planned/actual concept is its own independently-editable field
// so users can rename, hide, reorder, or delete them like Notion properties.
export const DETAIL_FIELD_CATALOG: DetailFieldDef[] = [
  { key: 'status',           label: 'Status',          kind: 'readonly', defaultVisible: true },
  { key: 'account',          label: 'Account',         kind: 'account-select', defaultVisible: true },
  { key: 'pair',             label: 'Pair',            kind: 'readonly', defaultVisible: true },
  { key: 'day',              label: 'Day',             kind: 'readonly', defaultVisible: true },
  { key: 'date',             label: 'Date (ET)',       kind: 'readonly', defaultVisible: true },
  { key: 'direction',        label: 'Direction',       kind: 'readonly', defaultVisible: true },
  { key: 'pnl',              label: 'P&L',             kind: 'readonly', defaultVisible: true },
  { key: 'r_pct',            label: 'R%',              kind: 'readonly', defaultVisible: true },
  { key: 'emotion',          label: 'Emotion',         kind: 'select',  propertyName: 'emotion', isReviewField: true, field: 'emotional_state_before', defaultVisible: true },
  { key: 'session',          label: 'Session',         kind: 'select',  propertyName: 'session', field: 'session', defaultVisible: true },
  { key: 'model',            label: 'Planned Model',   kind: 'playbook-select', field: 'playbook_id', defaultVisible: true },
  { key: 'actual_model',     label: 'Actual Model',    kind: 'playbook-select', field: 'actual_playbook_id', defaultVisible: true },
  { key: 'profile',          label: 'Planned Profile', kind: 'select', propertyName: 'profile', field: 'profile', defaultVisible: true },
  { key: 'actual_profile',   label: 'Actual Profile',  kind: 'select', propertyName: 'profile', field: 'actual_profile', defaultVisible: true },
  { key: 'regime',           label: 'Planned Regime',  kind: 'select', propertyName: 'regime', isReviewField: true, field: 'regime', defaultVisible: true },
  { key: 'actual_regime',    label: 'Actual Regime',   kind: 'select', propertyName: 'regime', field: 'actual_regime', defaultVisible: true },
  { key: 'alignment',        label: 'HTF Timeframes',  kind: 'multi-select', propertyName: 'timeframe', field: 'alignment', defaultVisible: true },
  { key: 'entry_timeframes', label: 'Entry Timeframes', kind: 'multi-select', propertyName: 'timeframe', field: 'entry_timeframes', defaultVisible: true },
  { key: 'place',            label: 'Place',           kind: 'text', field: 'place', defaultVisible: true },
];

// Migrate legacy "bundled" detail keys saved in user_settings to the new split keys.
// Keeps existing user layouts working after the catalog split.
const LEGACY_DETAIL_KEY_MIGRATION: Record<string, string[]> = {
  timeframes: ['alignment', 'entry_timeframes'],
};

export function migrateDetailKeys(keys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const expanded = LEGACY_DETAIL_KEY_MIGRATION[k] ?? [k];
    for (const e of expanded) {
      if (!seen.has(e)) { seen.add(e); out.push(e); }
    }
  }
  return out;
}

export const DETAIL_SECTION_CATALOG: DetailSectionDef[] = [
  { key: 'screenshots',       label: 'Screenshots',       defaultVisible: true },
  { key: 'checklist',         label: 'Playbook Checklist', defaultVisible: true },
  { key: 'psychology_notes',  label: 'Psychology Notes',   defaultVisible: true },
  { key: 'mistakes',          label: 'Mistakes',           defaultVisible: true },
  { key: 'did_well',          label: 'What I Did Well',    defaultVisible: true },
  { key: 'to_improve',        label: 'To Improve',         defaultVisible: true },
  { key: 'actionable_steps',  label: 'Actionable Steps',   defaultVisible: true },
];

export const DEFAULT_DETAIL_VISIBLE_FIELDS = DETAIL_FIELD_CATALOG.filter(f => f.defaultVisible).map(f => f.key);
export const DEFAULT_DETAIL_FIELD_ORDER   = DETAIL_FIELD_CATALOG.map(f => f.key);
export const DEFAULT_DETAIL_VISIBLE_SECTIONS = DETAIL_SECTION_CATALOG.filter(s => s.defaultVisible).map(s => s.key);
export const DEFAULT_DETAIL_SECTION_ORDER   = DETAIL_SECTION_CATALOG.map(s => s.key);

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
  { key: 'profile', label: 'Planned Profile', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'profile', category: 'editable' },
  { key: 'actual_profile', label: 'Actual Profile', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'profile', category: 'editable' },
  { key: 'regime', label: 'Planned Regime', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'regime', category: 'editable' },
  { key: 'actual_regime', label: 'Actual Regime', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'regime', category: 'editable' },
  { key: 'emotional_state_before', label: 'Emotion', type: 'select', sortable: true, filterable: true, hideable: true, width: 'minmax(90px, 1.2fr)', propertyName: 'emotion', category: 'editable' },
  { key: 'place', label: 'Place', type: 'text', sortable: true, filterable: true, hideable: true, width: 'minmax(80px, 1fr)', category: 'editable' },
];

// Source map: where each system field's data physically lives.
// Some fields live on `trades`, some on `trade_reviews`, and "dual" fields span two columns.
// This is the single source of truth for both counting and bulk-erasing system fields.
export type SystemFieldSource = { table: 'trades' | 'trade_reviews'; column: string };

export const SYSTEM_FIELD_SOURCES: Record<string, SystemFieldSource[]> = {
  // ── Single-column trades fields ────────────────────────────────────────────
  session:          [{ table: 'trades', column: 'session' }],
  profile:          [{ table: 'trades', column: 'profile' }],
  place:            [{ table: 'trades', column: 'place' }],
  alignment:        [{ table: 'trades', column: 'alignment' }],
  entry_timeframes: [{ table: 'trades', column: 'entry_timeframes' }],
  actual_profile:   [{ table: 'trades', column: 'actual_profile' }],
  actual_regime:    [{ table: 'trades', column: 'actual_regime' }],
  playbook_id:        [{ table: 'trades', column: 'playbook_id' }],
  actual_playbook_id: [{ table: 'trades', column: 'actual_playbook_id' }],
  model:              [{ table: 'trades', column: 'playbook_id' }],
  actual_model:       [{ table: 'trades', column: 'actual_playbook_id' }],

  // ── Single-column trade_reviews fields ─────────────────────────────────────
  emotion:                [{ table: 'trade_reviews', column: 'emotional_state_before' }],
  emotional_state_before: [{ table: 'trade_reviews', column: 'emotional_state_before' }],
  news_risk:              [{ table: 'trade_reviews', column: 'news_risk' }],
  psychology_notes:       [{ table: 'trade_reviews', column: 'psychology_notes' }],

  // Planned regime lives on trade_reviews
  regime: [{ table: 'trade_reviews', column: 'regime' }],
};

// Back-compat alias: anything in SYSTEM_FIELD_SOURCES is erasable.
export const ERASABLE_SYSTEM_FIELDS: Record<string, true> = Object.fromEntries(
  Object.keys(SYSTEM_FIELD_SOURCES).map((k) => [k, true as const])
);

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
  entry_time: true,
  symbol: true,
};

export function canEraseSystemField(key: string): boolean {
  return key in SYSTEM_FIELD_SOURCES;
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
  // Regimes (market state — overlaps with Profile, kept user-editable so you can rename/remove)
  { property_name: 'regime', value: 'rotational', label: 'Rotational', color: '#3B82F6', sort_order: 0, is_active: true },
  { property_name: 'regime', value: 'transitional', label: 'Transitional', color: '#22C55E', sort_order: 1, is_active: true },
  // Sessions (display labels only — actual time windows live in session_definitions)
  { property_name: 'session', value: 'tokyo', label: 'Tokyo', color: '#A855F7', sort_order: 0, is_active: true },
  { property_name: 'session', value: 'london', label: 'London', color: '#F59E0B', sort_order: 1, is_active: true },
  { property_name: 'session', value: 'new_york_am', label: 'New York AM', color: '#3B82F6', sort_order: 2, is_active: true },
  { property_name: 'session', value: 'new_york_pm', label: 'New York PM', color: '#0EA5E9', sort_order: 3, is_active: true },
  { property_name: 'session', value: 'off_hours', label: 'Off Hours', color: '#6B7280', sort_order: 4, is_active: true },
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
