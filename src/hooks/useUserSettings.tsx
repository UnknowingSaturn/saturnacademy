import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  UserSettings, SessionDefinition, PropertyOption, FilterCondition,
  DEFAULT_VISIBLE_COLUMNS, DEFAULT_SESSIONS, DEFAULT_PROPERTY_OPTIONS,
  DEFAULT_LIVE_TRADE_QUESTIONS, LiveTradeQuestion, migrateDetailKeys,
} from "@/types/settings";
import { toast } from "sonner";
import { useEffect, useMemo, useRef } from "react";
import { setDisplayTimezone } from "@/lib/time";

// Legacy → canonical key map for label/override records (mirrors migrateDetailKeys).
const LEGACY_KEY_MAP: Record<string, string> = {
  emotion: 'emotional_state_before',
  pair: 'symbol',
  date: 'entry_time',
  r_pct: 'r_multiple_actual',
  pnl: 'net_pnl',
};

function migrateKeyedRecord<T>(rec: Record<string, T> | null | undefined): Record<string, T> {
  const out: Record<string, T> = { ...(rec || {}) };
  for (const [legacy, canonical] of Object.entries(LEGACY_KEY_MAP)) {
    if (out[legacy] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[legacy];
    }
    delete out[legacy];
  }
  return out;
}

function migrateKeyList(list: string[] | null | undefined): string[] {
  return (list || []).map((k) => LEGACY_KEY_MAP[k] ?? k);
}

// Transform database row to typed object
const transformSettings = (row: any): UserSettings => ({
  id: row.id,
  user_id: row.user_id,
  visible_columns: migrateKeyList(row.visible_columns) || DEFAULT_VISIBLE_COLUMNS,
  column_order: migrateKeyList(row.column_order) || DEFAULT_VISIBLE_COLUMNS,
  column_overrides: migrateKeyedRecord(row.column_overrides as Record<string, any>),
  default_filters: row.default_filters || [],
  live_trade_questions: (row.live_trade_questions as LiveTradeQuestion[]) || DEFAULT_LIVE_TRADE_QUESTIONS,
  display_timezone: row.display_timezone || 'America/New_York',
  detail_visible_fields: migrateDetailKeys((row.detail_visible_fields as string[]) || []),
  detail_field_order: migrateDetailKeys((row.detail_field_order as string[]) || []),
  detail_visible_sections: (row.detail_visible_sections as string[]) || [],
  detail_section_order: (row.detail_section_order as string[]) || [],
  field_label_overrides: migrateKeyedRecord(row.field_label_overrides as Record<string, string>),
  deleted_system_fields: migrateKeyList(row.deleted_system_fields as string[]),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const transformSession = (row: any): SessionDefinition => ({
  id: row.id,
  user_id: row.user_id,
  name: row.name,
  key: row.key,
  start_hour: row.start_hour,
  start_minute: row.start_minute,
  end_hour: row.end_hour,
  end_minute: row.end_minute,
  timezone: row.timezone,
  color: row.color,
  sort_order: row.sort_order,
  is_active: row.is_active,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const transformPropertyOption = (row: any): PropertyOption => ({
  id: row.id,
  user_id: row.user_id,
  property_name: row.property_name,
  value: row.value,
  label: row.label,
  color: row.color,
  sort_order: row.sort_order,
  is_active: row.is_active,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

// User Settings Hook
export function useUserSettings() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['user_settings', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      // Return default settings if none exist
      if (!data) {
        return {
          id: '',
          user_id: user.id,
          visible_columns: DEFAULT_VISIBLE_COLUMNS,
          column_order: DEFAULT_VISIBLE_COLUMNS,
          column_overrides: {},
          default_filters: [] as FilterCondition[],
          live_trade_questions: DEFAULT_LIVE_TRADE_QUESTIONS,
          display_timezone: 'America/New_York',
          detail_visible_fields: [],
          detail_field_order: [],
          detail_visible_sections: [],
          detail_section_order: [],
          field_label_overrides: {},
          deleted_system_fields: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as UserSettings;
      }

      return transformSettings(data);
    },
    enabled: !!user?.id,
  });

  // Sync the active display timezone with the formatter module whenever it changes.
  useEffect(() => {
    if (query.data?.display_timezone) {
      setDisplayTimezone(query.data.display_timezone);
    }
  }, [query.data?.display_timezone]);

  return query;
}

export function useUpdateUserSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (updates: Partial<UserSettings>) => {
      if (!user?.id) throw new Error('Not authenticated');

      // Convert to database format (JSONB expects Json type)
      const dbUpdates: Record<string, any> = {};
      if (updates.visible_columns) dbUpdates.visible_columns = updates.visible_columns;
      if (updates.column_order) dbUpdates.column_order = updates.column_order;
      if (updates.column_overrides !== undefined) dbUpdates.column_overrides = updates.column_overrides as any;
      if (updates.default_filters) dbUpdates.default_filters = updates.default_filters as any;
      if (updates.live_trade_questions) dbUpdates.live_trade_questions = updates.live_trade_questions as any;
      if (updates.display_timezone) dbUpdates.display_timezone = updates.display_timezone;
      if (updates.detail_visible_fields !== undefined) dbUpdates.detail_visible_fields = updates.detail_visible_fields as any;
      if (updates.detail_field_order !== undefined) dbUpdates.detail_field_order = updates.detail_field_order as any;
      if (updates.detail_visible_sections !== undefined) dbUpdates.detail_visible_sections = updates.detail_visible_sections as any;
      if (updates.detail_section_order !== undefined) dbUpdates.detail_section_order = updates.detail_section_order as any;
      if (updates.field_label_overrides !== undefined) dbUpdates.field_label_overrides = updates.field_label_overrides as any;
      if (updates.deleted_system_fields !== undefined) dbUpdates.deleted_system_fields = updates.deleted_system_fields as any;

      // Check if settings exist
      const { data: existing } = await supabase
        .from('user_settings')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('user_settings')
          .update(dbUpdates)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_settings')
          .insert({ user_id: user.id, ...dbUpdates });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user_settings'] });
    },
    onError: (error) => {
      toast.error('Failed to save settings');
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });
}

// Session Definitions Hook with auto-initialization
export function useSessionDefinitions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const initializingRef = useRef(false);

  const query = useQuery({
    queryKey: ['session_definitions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('session_definitions')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order');

      if (error) throw error;

      return (data || []).map(transformSession);
    },
    enabled: !!user?.id,
  });

  // Auto-initialize defaults if empty
  useEffect(() => {
    const initializeDefaults = async () => {
      if (!user?.id || initializingRef.current || query.isLoading) return;
      if (query.data && query.data.length === 0) {
        initializingRef.current = true;
        try {
          const sessions = DEFAULT_SESSIONS.map((s, i) => ({ 
            ...s, 
            user_id: user.id,
            sort_order: i 
          }));
          await supabase.from('session_definitions').insert(sessions);
          queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
        } catch (err) {
          console.error('Failed to initialize sessions:', err);
        } finally {
          initializingRef.current = false;
        }
      }
    };
    initializeDefaults();
  }, [user?.id, query.data, query.isLoading, queryClient]);

  return query;
}

// Unified session lookup — single source of truth for session label + color.
// Built on session_definitions, with a built-in "Off Hours" fallback so
// trades whose session = 'off_hours' still render with a sensible badge.
export function useSessionLookup() {
  const { data: sessions = [], isLoading } = useSessionDefinitions();

  return useMemo(() => {
    const byKey: Record<string, { name: string; color: string; sort_order: number }> = {
      off_hours: { name: 'Off Hours', color: '#6B7280', sort_order: 9999 },
      unknown: { name: 'Unknown', color: '#6B7280', sort_order: 10000 },
    };
    for (const s of sessions) {
      byKey[s.key] = { name: s.name, color: s.color, sort_order: s.sort_order };
    }
    const options = sessions
      .filter((s) => s.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ value: s.key, label: s.name, customColor: s.color, color: 'primary' as const }));
    return { byKey, options, isLoading };
  }, [sessions, isLoading]);
}

// Create a new session
export function useCreateSession() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (session: Omit<SessionDefinition, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('session_definitions')
        .insert({ ...session, user_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
      toast.success('Session created');
    },
    onError: (error) => {
      toast.error('Failed to create session');
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SessionDefinition> & { id: string }) => {
      const { data, error } = await supabase
        .from('session_definitions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
    },
    onError: (error) => {
      toast.error('Failed to update session');
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('session_definitions')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
      toast.success('Session deleted');
    },
    onError: (error) => {
      toast.error('Failed to delete session');
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });
}

export function useReorderSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessions: { id: string; sort_order: number }[]) => {
      for (const session of sessions) {
        const { error } = await supabase
          .from('session_definitions')
          .update({ sort_order: session.sort_order })
          .eq('id', session.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
    },
    onError: (error) => {
      toast.error('Failed to reorder sessions');
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });
}

// ---------------------------------------------------------------------------
// Property Options — now stored as `custom_field_definitions` rows where
// scope='system_options' and key=property_name. The `options` jsonb on that row
// holds the full list. The public hook surface below preserves the original
// PropertyOption shape (with synthetic ids of `${rowId}::${value}`) so call
// sites in PropertyOptionsPanel / SystemOptionsEditor / TradeProperties keep
// working unchanged.
// ---------------------------------------------------------------------------

type RawOption = {
  value: string;
  label: string;
  color: string;
  sort_order?: number;
  is_active?: boolean;
};

const makeOptionId = (rowId: string, value: string) => `${rowId}::${value}`;
const parseOptionId = (id: string): { rowId: string; value: string } => {
  const idx = id.indexOf('::');
  if (idx < 0) return { rowId: '', value: id };
  return { rowId: id.slice(0, idx), value: id.slice(idx + 2) };
};

const expandOptions = (row: any): PropertyOption[] => {
  const opts: RawOption[] = Array.isArray(row?.options) ? row.options : [];
  return opts.map((o, i) => ({
    id: makeOptionId(row.id, o.value),
    user_id: row.user_id,
    property_name: row.key,
    value: o.value,
    label: o.label,
    color: o.color,
    sort_order: o.sort_order ?? i,
    is_active: o.is_active ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
};

async function fetchSystemOptionsRow(userId: string, propertyName: string) {
  const { data, error } = await supabase
    .from('custom_field_definitions')
    .select('*')
    .eq('user_id', userId)
    .eq('scope', 'system_options')
    .eq('key', propertyName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function writeOptions(rowId: string, options: RawOption[]) {
  const { error } = await supabase
    .from('custom_field_definitions')
    .update({ options: options as any })
    .eq('id', rowId);
  if (error) throw error;
}

// Property Options Hook with auto-initialization
// Pass activeOnly=true to filter out soft-deleted options for end-user dropdowns.
export function usePropertyOptions(propertyName?: string, activeOnly: boolean = false) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const initializingRef = useRef(false);

  const query = useQuery<PropertyOption[]>({
    queryKey: ['property_options', user?.id, propertyName, activeOnly],
    queryFn: async () => {
      if (!user?.id) return [];

      let q = supabase
        .from('custom_field_definitions')
        .select('*')
        .eq('user_id', user.id)
        .eq('scope', 'system_options');

      if (propertyName) q = q.eq('key', propertyName);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data || []) as any[];
      const expanded = rows.flatMap(expandOptions);
      const filtered = activeOnly ? expanded.filter((o) => o.is_active) : expanded;
      return filtered.sort((a, b) => a.sort_order - b.sort_order);
    },
    enabled: !!user?.id,
  });

  // Auto-initialize defaults if the requested property has no row yet.
  useEffect(() => {
    const initializeDefaults = async () => {
      if (!user?.id || !propertyName || initializingRef.current || query.isLoading) return;
      if (query.data && query.data.length === 0) {
        initializingRef.current = true;
        try {
          const defaults = DEFAULT_PROPERTY_OPTIONS.filter((o) => o.property_name === propertyName);
          if (defaults.length === 0) return;
          const options: RawOption[] = defaults.map((o, i) => ({
            value: o.value,
            label: o.label,
            color: o.color,
            sort_order: i,
            is_active: true,
          }));
          await supabase.from('custom_field_definitions').insert({
            user_id: user.id,
            scope: 'system_options',
            key: propertyName,
            label: propertyName,
            type: 'select',
            options: options as any,
          });
          queryClient.invalidateQueries({ queryKey: ['property_options'] });
        } catch (err) {
          console.error('Failed to initialize property options:', err);
        } finally {
          initializingRef.current = false;
        }
      }
    };
    initializeDefaults();
  }, [user?.id, query.data, query.isLoading, queryClient, propertyName]);

  return query;
}

export function useCreatePropertyOption() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (option: Omit<PropertyOption, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      if (!user?.id) throw new Error('Not authenticated');
      const row = await fetchSystemOptionsRow(user.id, option.property_name);
      const next: RawOption = {
        value: option.value,
        label: option.label,
        color: option.color,
        sort_order: option.sort_order,
        is_active: option.is_active,
      };
      if (row) {
        const current: RawOption[] = Array.isArray(row.options) ? (row.options as any) : [];
        if (current.some((o) => o.value === next.value)) {
          throw new Error(`Option "${option.value}" already exists`);
        }
        await writeOptions(row.id, [...current, next]);
      } else {
        const { error } = await supabase.from('custom_field_definitions').insert({
          user_id: user.id,
          scope: 'system_options',
          key: option.property_name,
          label: option.property_name,
          type: 'select',
          options: [next] as any,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
      toast.success('Option created');
    },
    onError: (error) => {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to create option');
    },
  });
}

export function useUpdatePropertyOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PropertyOption> & { id: string }) => {
      const { rowId, value } = parseOptionId(id);
      if (!rowId) throw new Error('Invalid option id');
      const { data: row, error: rowErr } = await supabase
        .from('custom_field_definitions')
        .select('id, options')
        .eq('id', rowId)
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) throw new Error('Property row not found');
      const current: RawOption[] = Array.isArray(row.options) ? (row.options as any) : [];
      const next = current.map((o) =>
        o.value === value
          ? {
              ...o,
              ...(updates.value !== undefined ? { value: updates.value } : {}),
              ...(updates.label !== undefined ? { label: updates.label } : {}),
              ...(updates.color !== undefined ? { color: updates.color } : {}),
              ...(updates.sort_order !== undefined ? { sort_order: updates.sort_order } : {}),
              ...(updates.is_active !== undefined ? { is_active: updates.is_active } : {}),
            }
          : o,
      );
      await writeOptions(rowId, next);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
    },
    onError: (error) => {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to update option');
    },
  });
}

export function useDeletePropertyOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { rowId, value } = parseOptionId(id);
      if (!rowId) throw new Error('Invalid option id');
      const { data: row, error: rowErr } = await supabase
        .from('custom_field_definitions')
        .select('id, options')
        .eq('id', rowId)
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) return;
      const current: RawOption[] = Array.isArray(row.options) ? (row.options as any) : [];
      const next = current.filter((o) => o.value !== value);
      await writeOptions(rowId, next);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
      toast.success('Option deleted');
    },
    onError: (error) => {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete option');
    },
  });
}

// Bulk update sort orders for property options — single write per row now
// instead of one query per option (was the audit's N+1 reorder bug).
export function useReorderPropertyOptions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: { id: string; sort_order: number }[]) => {
      if (updates.length === 0) return;
      const byRow = new Map<string, { value: string; sort_order: number }[]>();
      for (const u of updates) {
        const { rowId, value } = parseOptionId(u.id);
        if (!rowId) continue;
        if (!byRow.has(rowId)) byRow.set(rowId, []);
        byRow.get(rowId)!.push({ value, sort_order: u.sort_order });
      }
      for (const [rowId, list] of byRow.entries()) {
        const { data: row, error: rowErr } = await supabase
          .from('custom_field_definitions')
          .select('id, options')
          .eq('id', rowId)
          .maybeSingle();
        if (rowErr) throw rowErr;
        if (!row) continue;
        const current: RawOption[] = Array.isArray(row.options) ? (row.options as any) : [];
        const orderMap = new Map(list.map((l) => [l.value, l.sort_order]));
        const next = current
          .map((o) => ({ ...o, sort_order: orderMap.get(o.value) ?? o.sort_order ?? 0 }))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        await writeOptions(rowId, next);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
    },
    onError: (error) => {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to reorder options');
    },
  });
}

// Bulk initialize default sessions + system option rows for a brand-new user.
export function useInitializeDefaults() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated');

      const { data: existingSessions } = await supabase
        .from('session_definitions')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);

      if (!existingSessions || existingSessions.length === 0) {
        const sessions = DEFAULT_SESSIONS.map((s, i) => ({ ...s, user_id: user.id, sort_order: i }));
        await supabase.from('session_definitions').insert(sessions);
      }

      const { data: existingRows } = await supabase
        .from('custom_field_definitions')
        .select('key')
        .eq('user_id', user.id)
        .eq('scope', 'system_options');

      const existing = new Set((existingRows || []).map((r: any) => r.key));
      const byProperty = new Map<string, RawOption[]>();
      DEFAULT_PROPERTY_OPTIONS.forEach((o) => {
        if (existing.has(o.property_name)) return;
        if (!byProperty.has(o.property_name)) byProperty.set(o.property_name, []);
        byProperty.get(o.property_name)!.push({
          value: o.value,
          label: o.label,
          color: o.color,
          sort_order: byProperty.get(o.property_name)!.length,
          is_active: true,
        });
      });
      const newRows = Array.from(byProperty.entries()).map(([propertyName, options]) => ({
        user_id: user.id,
        scope: 'system_options',
        key: propertyName,
        label: propertyName,
        type: 'select',
        options: options as any,
      }));
      if (newRows.length > 0) {
        await supabase.from('custom_field_definitions').insert(newRows);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
      toast.success('Settings initialized');
    },
    onError: (error) => {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to initialize settings');
    },
  });
}
