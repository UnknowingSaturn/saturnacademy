import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { 
  CopierRole, 
  CopierSymbolMapping, 
  CopierReceiverSettings, 
  CopierExecution,
  CopierConfigVersion,
  RiskMode
} from '@/types/copier';

// Fetch all accounts with copier data
export function useCopierAccounts() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['copier-accounts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

// Update account copier role
export function useUpdateCopierRole() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      accountId, 
      role, 
      masterAccountId 
    }: { 
      accountId: string; 
      role: CopierRole; 
      masterAccountId?: string | null;
    }) => {
      const { error } = await supabase
        .from('accounts')
        .update({ 
          copier_role: role,
          master_account_id: role === 'receiver' ? masterAccountId : null,
          copier_enabled: role !== 'independent'
        })
        .eq('id', accountId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copier-accounts'] });
      toast.success('Account role updated');
    },
    onError: (error) => {
      toast.error('Failed to update role: ' + error.message);
    },
  });
}

// Fetch symbol mappings for a master account
export function useSymbolMappings(masterAccountId?: string) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['copier-symbol-mappings', masterAccountId],
    queryFn: async () => {
      let query = supabase
        .from('copier_symbol_mappings')
        .select('*')
        .eq('user_id', user!.id);
      
      if (masterAccountId) {
        query = query.eq('master_account_id', masterAccountId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: true });
      
      if (error) throw error;
      return data as CopierSymbolMapping[];
    },
    enabled: !!user,
  });
}

// Create symbol mapping
export function useCreateSymbolMapping() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (mapping: Omit<CopierSymbolMapping, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('copier_symbol_mappings')
        .insert({
          ...mapping,
          user_id: user!.id,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copier-symbol-mappings'] });
      toast.success('Symbol mapping created');
    },
    onError: (error) => {
      toast.error('Failed to create mapping: ' + error.message);
    },
  });
}

// Update symbol mapping
export function useUpdateSymbolMapping() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CopierSymbolMapping> & { id: string }) => {
      const { error } = await supabase
        .from('copier_symbol_mappings')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copier-symbol-mappings'] });
      toast.success('Mapping updated');
    },
    onError: (error) => {
      toast.error('Failed to update mapping: ' + error.message);
    },
  });
}

// Delete symbol mapping
export function useDeleteSymbolMapping() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('copier_symbol_mappings')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copier-symbol-mappings'] });
      toast.success('Mapping deleted');
    },
    onError: (error) => {
      toast.error('Failed to delete mapping: ' + error.message);
    },
  });
}

// Fetch receiver settings
export function useReceiverSettings(receiverAccountId?: string) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['copier-receiver-settings', receiverAccountId],
    queryFn: async () => {
      let query = supabase
        .from('copier_receiver_settings')
        .select('*')
        .eq('user_id', user!.id);
      
      if (receiverAccountId) {
        query = query.eq('receiver_account_id', receiverAccountId);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as CopierReceiverSettings[];
    },
    enabled: !!user,
  });
}

// Upsert receiver settings
export function useUpsertReceiverSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (settings: Omit<CopierReceiverSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('copier_receiver_settings')
        .upsert({
          ...settings,
          user_id: user!.id,
        }, {
          onConflict: 'receiver_account_id',
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copier-receiver-settings'] });
      toast.success('Settings saved');
    },
    onError: (error) => {
      toast.error('Failed to save settings: ' + error.message);
    },
  });
}

// Fetch copier executions
export function useCopierExecutions(filters?: {
  receiverAccountId?: string;
  status?: 'success' | 'failed' | 'skipped';
  limit?: number;
  offset?: number;
  dateFrom?: Date;
  dateTo?: Date;
}) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['copier-executions', filters],
    queryFn: async () => {
      let query = supabase
        .from('copier_executions')
        .select('*')
        .eq('user_id', user!.id)
        .order('executed_at', { ascending: false });
      
      if (filters?.receiverAccountId) {
        query = query.eq('receiver_account_id', filters.receiverAccountId);
      }
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.dateFrom) {
        query = query.gte('executed_at', filters.dateFrom.toISOString());
      }
      if (filters?.dateTo) {
        query = query.lte('executed_at', filters.dateTo.toISOString());
      }
      if (filters?.limit) {
        query = query.limit(filters.limit);
      }
      if (filters?.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 25) - 1);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as CopierExecution[];
    },
    enabled: !!user,
  });
}

// Fetch copier executions with realtime subscription
export function useCopierExecutionsRealtime(filters?: {
  receiverAccountId?: string;
  status?: 'success' | 'failed' | 'skipped';
  limit?: number;
  offset?: number;
  dateFrom?: Date;
  dateTo?: Date;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Subscribe to realtime updates
  React.useEffect(() => {
    if (!user) return;
    
    const channel = supabase
      .channel('copier-executions-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'copier_executions',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Invalidate queries to refetch on new execution
          queryClient.invalidateQueries({ queryKey: ['copier-executions'] });
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);
  
  return useQuery({
    queryKey: ['copier-executions', filters],
    queryFn: async () => {
      let query = supabase
        .from('copier_executions')
        .select('*')
        .eq('user_id', user!.id)
        .order('executed_at', { ascending: false });
      
      if (filters?.receiverAccountId) {
        query = query.eq('receiver_account_id', filters.receiverAccountId);
      }
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.dateFrom) {
        query = query.gte('executed_at', filters.dateFrom.toISOString());
      }
      if (filters?.dateTo) {
        query = query.lte('executed_at', filters.dateTo.toISOString());
      }
      if (filters?.limit) {
        query = query.limit(filters.limit);
      }
      if (filters?.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 25) - 1);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as CopierExecution[];
    },
    enabled: !!user,
    refetchInterval: 30000, // Also poll every 30 seconds as fallback
  });
}

// Fetch config versions
export function useConfigVersions() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['copier-config-versions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('copier_config_versions')
        .select('*')
        .eq('user_id', user!.id)
        .order('version', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data as CopierConfigVersion[];
    },
    enabled: !!user,
  });
}

// Create config version
export function useCreateConfigVersion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async ({ configHash }: { configHash: string }) => {
      // Get latest version
      const { data: latest } = await supabase
        .from('copier_config_versions')
        .select('version')
        .eq('user_id', user!.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      const newVersion = (latest?.version || 0) + 1;
      
      const { data, error } = await supabase
        .from('copier_config_versions')
        .insert({
          user_id: user!.id,
          version: newVersion,
          config_hash: configHash,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copier-config-versions'] });
    },
  });
}

// Calculate copier statistics
export function useCopierStats() {
  const { data: executions } = useCopierExecutions({ limit: 1000 });
  
  if (!executions || executions.length === 0) {
    return {
      totalExecutions: 0,
      successRate: 0,
      avgSlippage: 0,
      failedCount: 0,
    };
  }
  
  const successful = executions.filter(e => e.status === 'success');
  const failed = executions.filter(e => e.status === 'failed');
  
  const avgSlippage = successful.length > 0
    ? successful.reduce((sum, e) => sum + (e.slippage_pips || 0), 0) / successful.length
    : 0;
  
  return {
    totalExecutions: executions.length,
    successRate: (successful.length / executions.length) * 100,
    avgSlippage,
    failedCount: failed.length,
  };
}

// Default receiver settings
export const DEFAULT_RECEIVER_SETTINGS: Omit<CopierReceiverSettings, 'id' | 'user_id' | 'receiver_account_id' | 'created_at' | 'updated_at'> = {
  risk_mode: 'balance_multiplier' as RiskMode,
  risk_value: 1.0,
  max_slippage_pips: 3.0,
  max_daily_loss_r: 3.0,
  allowed_sessions: ['tokyo', 'london', 'new_york_am', 'new_york_pm'],
  manual_confirm_mode: false,
  prop_firm_safe_mode: false,
  poll_interval_ms: 1000,
};

// Prop firm safe mode preset
export const PROP_FIRM_SAFE_PRESET: Partial<CopierReceiverSettings> = {
  max_slippage_pips: 2.0,
  max_daily_loss_r: 2.0,
  manual_confirm_mode: true,
  prop_firm_safe_mode: true,
  poll_interval_ms: 3000,
};
