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
