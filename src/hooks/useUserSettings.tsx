import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { UserSettings, SessionDefinition, PropertyOption, FilterCondition, DEFAULT_VISIBLE_COLUMNS, DEFAULT_SESSIONS, DEFAULT_PROPERTY_OPTIONS } from "@/types/settings";
import { toast } from "sonner";

// Transform database row to typed object
const transformSettings = (row: any): UserSettings => ({
  id: row.id,
  user_id: row.user_id,
  visible_columns: row.visible_columns || DEFAULT_VISIBLE_COLUMNS,
  column_order: row.column_order || DEFAULT_VISIBLE_COLUMNS,
  default_filters: row.default_filters || [],
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

  return useQuery({
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
          default_filters: [] as FilterCondition[],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as UserSettings;
      }

      return transformSettings(data);
    },
    enabled: !!user?.id,
  });
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
      if (updates.default_filters) dbUpdates.default_filters = updates.default_filters as any;

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
    },
  });
}

// Session Definitions Hook
export function useSessionDefinitions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['session_definitions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('session_definitions')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order');

      if (error) throw error;

      // Return default sessions if none exist
      if (!data || data.length === 0) {
        return DEFAULT_SESSIONS.map((s, i) => ({
          ...s,
          id: `default-${i}`,
          user_id: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })) as SessionDefinition[];
      }

      return data.map(transformSession);
    },
    enabled: !!user?.id,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (session: Omit<SessionDefinition, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('session_definitions')
        .insert({ user_id: user.id, ...session });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
      toast.success('Session created');
    },
    onError: (error) => {
      toast.error('Failed to create session');
      console.error(error);
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SessionDefinition> & { id: string }) => {
      const { error } = await supabase
        .from('session_definitions')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
    },
    onError: (error) => {
      toast.error('Failed to update session');
      console.error(error);
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
    },
  });
}

// Property Options Hook
export function usePropertyOptions(propertyName?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['property_options', user?.id, propertyName],
    queryFn: async () => {
      if (!user?.id) return [];

      let query = supabase
        .from('property_options')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order');

      if (propertyName) {
        query = query.eq('property_name', propertyName);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Return default options if none exist
      if (!data || data.length === 0) {
        const defaults = propertyName 
          ? DEFAULT_PROPERTY_OPTIONS.filter(o => o.property_name === propertyName)
          : DEFAULT_PROPERTY_OPTIONS;
        
        return defaults.map((o, i) => ({
          ...o,
          id: `default-${o.property_name}-${i}`,
          user_id: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })) as PropertyOption[];
      }

      return data.map(transformPropertyOption);
    },
    enabled: !!user?.id,
  });
}

export function useCreatePropertyOption() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (option: Omit<PropertyOption, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      if (!user?.id) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('property_options')
        .insert({ user_id: user.id, ...option });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
      toast.success('Option created');
    },
    onError: (error) => {
      toast.error('Failed to create option');
      console.error(error);
    },
  });
}

export function useUpdatePropertyOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PropertyOption> & { id: string }) => {
      const { error } = await supabase
        .from('property_options')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
    },
    onError: (error) => {
      toast.error('Failed to update option');
      console.error(error);
    },
  });
}

export function useDeletePropertyOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('property_options')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
      toast.success('Option deleted');
    },
    onError: (error) => {
      toast.error('Failed to delete option');
      console.error(error);
    },
  });
}

// Bulk initialize default options for a user
export function useInitializeDefaults() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated');

      // Initialize sessions
      const { data: existingSessions } = await supabase
        .from('session_definitions')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);

      if (!existingSessions || existingSessions.length === 0) {
        const sessions = DEFAULT_SESSIONS.map(s => ({ ...s, user_id: user.id }));
        await supabase.from('session_definitions').insert(sessions);
      }

      // Initialize property options
      const { data: existingOptions } = await supabase
        .from('property_options')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);

      if (!existingOptions || existingOptions.length === 0) {
        const options = DEFAULT_PROPERTY_OPTIONS.map(o => ({ ...o, user_id: user.id }));
        await supabase.from('property_options').insert(options);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session_definitions'] });
      queryClient.invalidateQueries({ queryKey: ['property_options'] });
      toast.success('Settings initialized');
    },
    onError: (error) => {
      toast.error('Failed to initialize settings');
      console.error(error);
    },
  });
}
