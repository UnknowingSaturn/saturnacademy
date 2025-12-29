export interface UserSettings {
  id: string;
  user_id: string;
  visible_columns: string[];
  column_order: string[];
  default_filters: FilterCondition[];
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
}

export const DEFAULT_COLUMNS: ColumnDefinition[] = [
  { key: 'trade_number', label: '#', type: 'number', sortable: true, filterable: true, hideable: false, width: '50px' },
  { key: 'entry_time', label: 'Date (EST)', type: 'date', sortable: true, filterable: true, hideable: true, width: '120px' },
  { key: 'day', label: 'Day', type: 'text', sortable: true, filterable: true, hideable: true, width: '60px' },
  { key: 'symbol', label: 'Pair', type: 'text', sortable: true, filterable: true, hideable: false, width: '80px' },
  { key: 'session', label: 'Session', type: 'select', sortable: true, filterable: true, hideable: true, width: '100px', propertyName: 'session' },
  { key: 'model', label: 'Model', type: 'select', sortable: true, filterable: true, hideable: true, width: '90px', propertyName: 'model' },
  { key: 'alignment', label: 'Alignment', type: 'multi-select', sortable: false, filterable: true, hideable: true, width: '100px', propertyName: 'timeframe' },
  { key: 'entry_timeframes', label: 'Entry', type: 'multi-select', sortable: false, filterable: true, hideable: true, width: '100px', propertyName: 'timeframe' },
  { key: 'profile', label: 'Profile', type: 'select', sortable: true, filterable: true, hideable: true, width: '100px', propertyName: 'profile' },
  { key: 'r_multiple_actual', label: 'R%', type: 'number', sortable: true, filterable: true, hideable: true, width: '80px' },
  { key: 'result', label: 'Result', type: 'badge', sortable: true, filterable: true, hideable: true, width: '80px' },
  { key: 'emotional_state_before', label: 'Emotion', type: 'select', sortable: true, filterable: true, hideable: true, width: '100px', propertyName: 'emotion' },
  { key: 'place', label: 'Place', type: 'text', sortable: true, filterable: true, hideable: true, width: '100px' },
];

export const DEFAULT_VISIBLE_COLUMNS = [
  'trade_number', 'entry_time', 'day', 'symbol', 'session', 'model', 
  'alignment', 'entry_timeframes', 'profile', 'r_multiple_actual', 'result', 'emotional_state_before', 'place'
];

export const DEFAULT_SESSIONS: Omit<SessionDefinition, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  { name: 'Tokyo', key: 'tokyo', start_hour: 19, start_minute: 0, end_hour: 4, end_minute: 0, timezone: 'America/New_York', color: '#EC4899', sort_order: 0, is_active: true },
  { name: 'London', key: 'london', start_hour: 3, start_minute: 0, end_hour: 12, end_minute: 0, timezone: 'America/New_York', color: '#3B82F6', sort_order: 1, is_active: true },
  { name: 'NY AM', key: 'new_york_am', start_hour: 8, start_minute: 0, end_hour: 12, end_minute: 0, timezone: 'America/New_York', color: '#F59E0B', sort_order: 2, is_active: true },
  { name: 'NY PM', key: 'new_york_pm', start_hour: 12, start_minute: 0, end_hour: 17, end_minute: 0, timezone: 'America/New_York', color: '#F59E0B', sort_order: 3, is_active: true },
  { name: 'Off Hours', key: 'off_hours', start_hour: 17, start_minute: 0, end_hour: 19, end_minute: 0, timezone: 'America/New_York', color: '#6B7280', sort_order: 4, is_active: true },
];

export const DEFAULT_PROPERTY_OPTIONS: Omit<PropertyOption, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  // Models
  { property_name: 'model', value: 'type_a', label: 'Type A', color: '#3B82F6', sort_order: 0, is_active: true },
  { property_name: 'model', value: 'type_b', label: 'Type B', color: '#22C55E', sort_order: 1, is_active: true },
  { property_name: 'model', value: 'type_c', label: 'Type C', color: '#EAB308', sort_order: 2, is_active: true },
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
