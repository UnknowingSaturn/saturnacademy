import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CustomFieldDefinition, CustomFieldType, CustomFieldOption, SYSTEM_FIELD_SOURCES } from "@/types/settings";
import { toast } from "sonner";

const transform = (row: any): CustomFieldDefinition => ({
  id: row.id,
  user_id: row.user_id,
  key: row.key,
  label: row.label,
  type: row.type as CustomFieldType,
  options: (row.options as CustomFieldOption[]) || [],
  default_value: row.default_value,
  sort_order: row.sort_order,
  is_active: row.is_active,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

// Fetch ALL definitions (active + inactive). Consumers filter as needed.
export function useCustomFieldDefinitions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['custom_field_definitions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await (supabase as any)
        .from('custom_field_definitions')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order');
      if (error) throw error;
      return ((data || []) as any[]).map(transform);
    },
    enabled: !!user?.id,
  });
}

export function useCreateCustomField() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      label: string;
      type: CustomFieldType;
      options?: CustomFieldOption[];
      default_value?: any;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');

      // Stable key derived from label, prefixed with cf_ to avoid collision with system columns.
      const slug = input.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'field';
      const key = `cf_${slug}_${Math.random().toString(36).slice(2, 6)}`;

      // Append at end of current sort order
      const { data: existing } = await (supabase as any)
        .from('custom_field_definitions')
        .select('sort_order')
        .eq('user_id', user.id)
        .order('sort_order', { ascending: false })
        .limit(1);
      const nextOrder = existing?.[0]?.sort_order != null ? existing[0].sort_order + 1 : 0;

      const { data, error } = await (supabase as any)
        .from('custom_field_definitions')
        .insert({
          user_id: user.id,
          key,
          label: input.label,
          type: input.type,
          options: (input.options || []) as any,
          default_value: input.default_value ?? null,
          sort_order: nextOrder,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return transform(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_field_definitions'] });
      toast.success('Column added');
    },
    onError: (e: any) => {
      console.error(e);
      toast.error('Failed to add column');
    },
  });
}

export function useUpdateCustomField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CustomFieldDefinition> & { id: string }) => {
      const dbUpdates: Record<string, any> = {};
      if (updates.label !== undefined) dbUpdates.label = updates.label;
      if (updates.options !== undefined) dbUpdates.options = updates.options as any;
      if (updates.default_value !== undefined) dbUpdates.default_value = updates.default_value;
      if (updates.sort_order !== undefined) dbUpdates.sort_order = updates.sort_order;
      if (updates.is_active !== undefined) dbUpdates.is_active = updates.is_active;

      const { error } = await (supabase as any)
        .from('custom_field_definitions')
        .update(dbUpdates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_field_definitions'] });
    },
    onError: (e: any) => {
      console.error(e);
      toast.error('Failed to update column');
    },
  });
}

// Hard delete the definition. Caller is responsible for first wiping values from trades if desired.
export function useDeleteCustomField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('custom_field_definitions')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_field_definitions'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      toast.success('Column removed');
    },
    onError: (e: any) => {
      console.error(e);
      toast.error('Failed to remove column');
    },
  });
}

// Erase a custom field's value from every trade for this user.
// Uses a single Postgres update with the jsonb minus operator (`#-` removes a path).
// We can't call that operator from the JS client directly, so we fetch trades that have
// the key and update each one. (Volume is small per user — this is fine.)
export function useEraseCustomFieldData() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (key: string) => {
      if (!user?.id) throw new Error('Not authenticated');

      // Pull all trades with that key set
      const { data: trades, error: fetchError } = await supabase
        .from('trades')
        .select('id, custom_fields' as any)
        .eq('user_id', user.id);
      if (fetchError) throw fetchError;

      const affected = ((trades || []) as any[]).filter(
        (t) => t.custom_fields && Object.prototype.hasOwnProperty.call(t.custom_fields, key)
      );

      for (const t of affected) {
        const next = { ...(t.custom_fields || {}) };
        delete next[key];
        const { error } = await (supabase as any)
          .from('trades')
          .update({ custom_fields: next })
          .eq('id', t.id);
        if (error) throw error;
      }

      return affected.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      toast.success(`Cleared values from ${count} trade${count === 1 ? '' : 's'}`);
    },
    onError: (e: any) => {
      console.error(e);
      toast.error('Failed to clear data');
    },
  });
}

// Bulk reorder
export function useReorderCustomFields() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      for (const item of items) {
        const { error } = await (supabase as any)
          .from('custom_field_definitions')
          .update({ sort_order: item.sort_order })
          .eq('id', item.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom_field_definitions'] });
    },
    onError: (e: any) => {
      console.error(e);
      toast.error('Failed to reorder columns');
    },
  });
}

// Erase a SYSTEM field's value across every relevant row for this user.
// Uses SYSTEM_FIELD_SOURCES so dual fields (regime, model, timeframes) and
// review-backed fields (emotion, news_risk, …) are wiped from the right table.
export function useEraseSystemFieldData() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (columnKey: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      const sources = SYSTEM_FIELD_SOURCES[columnKey];
      if (!sources || sources.length === 0) return 0;

      let total = 0;
      for (const { table, column } of sources) {
        // For trades: scope by user_id explicitly. For trade_reviews: RLS already
        // restricts rows to the user's own trades, so no extra filter is needed.
        let q: any = (supabase as any)
          .from(table)
          .update({ [column]: null })
          .not(column, 'is', null);
        if (table === 'trades') q = q.eq('user_id', user.id);
        const { data, error } = await q.select('id');
        if (error) throw error;
        total += data?.length || 0;
      }
      return total;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
      queryClient.invalidateQueries({ queryKey: ['trade_reviews'] });
      toast.success(`Cleared values from ${count} trade${count === 1 ? '' : 's'}`);
    },
    onError: (e: any) => {
      console.error(e);
      toast.error('Failed to clear data');
    },
  });
}

// Count rows that currently have a value for this system field, walking every
// underlying source table/column (so dual + review-backed fields are accurate).
export function useCountTradesWithSystemField(columnKey: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['system_field_value_count', user?.id, columnKey],
    queryFn: async () => {
      if (!user?.id || !columnKey) return 0;
      const sources = SYSTEM_FIELD_SOURCES[columnKey];
      if (!sources || sources.length === 0) return 0;

      let total = 0;
      for (const { table, column } of sources) {
        let q: any = (supabase as any)
          .from(table)
          .select('id', { count: 'exact', head: true })
          .not(column, 'is', null);
        if (table === 'trades') q = q.eq('user_id', user.id);
        const { count, error } = await q;
        if (error) throw error;
        total += count || 0;
      }
      return total;
    },
    enabled: !!user?.id && !!columnKey,
  });
}

// Count trades that currently have a value for this key (for the erase-data confirmation).
export function useCountTradesWithCustomField(key: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['custom_field_value_count', user?.id, key],
    queryFn: async () => {
      if (!user?.id || !key) return 0;
      const { data, error } = await supabase
        .from('trades')
        .select('id, custom_fields' as any)
        .eq('user_id', user.id);
      if (error) throw error;
      return ((data || []) as any[]).filter(
        (t) => t.custom_fields && Object.prototype.hasOwnProperty.call(t.custom_fields, key)
      ).length;
    },
    enabled: !!user?.id && !!key,
  });
}
