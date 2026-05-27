import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Account, AccountType, PropFirm } from '@/types/trading';
import { useToast } from '@/hooks/use-toast';

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return (data || []) as Account[];
    },
  });
}

export function useAccount(accountId: string | undefined) {
  return useQuery({
    queryKey: ['account', accountId],
    queryFn: async () => {
      if (!accountId) return null;
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', accountId)
        .maybeSingle();
      
      if (error) throw error;
      return data as Account | null;
    },
    enabled: !!accountId,
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (account: Omit<Account, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'api_key'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Generate API key for MT5 ingestion
      const apiKey = crypto.randomUUID();

      const { data, error } = await supabase
        .from('accounts')
        .insert({
          ...account,
          user_id: user.id,
          api_key: apiKey,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({ title: 'Account created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create account', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Account> & { id: string }) => {
      const { data, error } = await supabase
        .from('accounts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account', variables.id] });
      toast({ title: 'Account updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update account', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await supabase
        .from('accounts')
        .update({ is_active: false })
        .eq('id', accountId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({ title: 'Account deleted successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to delete account', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateSyncSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      accountId, 
      syncEnabled, 
      syncFrom 
    }: {
      accountId: string;
      syncEnabled: boolean;
      syncFrom: Date | null;
    }) => {
      const { error } = await supabase
        .from('accounts')
        .update({
          sync_history_enabled: syncEnabled,
          sync_history_from: syncFrom?.toISOString() || null,
        })
        .eq('id', accountId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({ title: 'Sync settings saved' });
    },
    onError: (error) => {
      toast({ title: 'Failed to save sync settings', description: error.message, variant: 'destructive' });
    },
  });
}

/**
 * Flags one or more accounts for a full EA replay on the next poll.
 * Optionally extends the history window via sync_history_from.
 * The EA clears force_resync after its next sync-account-state call.
 */
export function useForceResync() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      accountIds,
      syncFrom,
    }: {
      accountIds: string[];
      syncFrom?: Date | null;
    }) => {
      if (accountIds.length === 0) return { count: 0 };
      const patch: Record<string, unknown> = { force_resync: true };
      if (syncFrom !== undefined) {
        patch.sync_history_enabled = true;
        patch.sync_history_from = syncFrom?.toISOString() ?? null;
      }
      const { error } = await supabase
        .from('accounts')
        .update(patch)
        .in('id', accountIds);
      if (error) throw error;
      return { count: accountIds.length };
    },
    onSuccess: ({ count }) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({
        title: count === 1 ? 'Resync queued' : `Resync queued for ${count} accounts`,
        description: 'EA will replay history on its next poll (within ~30s of the terminal being open).',
      });
    },
    onError: (error) => {
      toast({ title: 'Failed to queue resync', description: error.message, variant: 'destructive' });
    },
  });
}

/**
 * Clears force_resync on one or more accounts. Used by the "Stop resync"
 * button on the account card once the user is satisfied the ledger is
 * complete after a full history replay.
 */
export function useStopResync() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (accountIds: string[]) => {
      if (accountIds.length === 0) return { count: 0 };
      const { error } = await supabase
        .from('accounts')
        .update({ force_resync: false })
        .in('id', accountIds);
      if (error) throw error;
      return { count: accountIds.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({ title: 'Resync stopped' });
    },
    onError: (error) => {
      toast({ title: 'Failed to stop resync', description: error.message, variant: 'destructive' });
    },
  });
}
