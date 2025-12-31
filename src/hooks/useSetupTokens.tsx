import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type CopierRole = 'independent' | 'master' | 'receiver';

interface SetupToken {
  id: string;
  user_id: string;
  token: string;
  used: boolean;
  used_at: string | null;
  expires_at: string;
  created_at: string;
  copier_role?: CopierRole;
  master_account_id?: string | null;
  sync_history_enabled?: boolean;
  sync_history_from?: string | null;
}

export function useSetupTokens() {
  return useQuery({
    queryKey: ['setup-tokens'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('setup_tokens')
        .select('*')
        .eq('used', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as SetupToken[];
    },
  });
}

export function useCreateSetupToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const { data, error } = await supabase
        .from('setup_tokens')
        .insert({
          user_id: user.id,
          token,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data as SetupToken;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-tokens'] });
    },
  });
}

interface CreateCopierTokenParams {
  role: CopierRole;
  masterAccountId?: string;
  syncHistoryEnabled?: boolean;
  syncHistoryFrom?: string;
}

export function useCreateCopierSetupToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      role, 
      masterAccountId,
      syncHistoryEnabled = true,
      syncHistoryFrom,
    }: CreateCopierTokenParams) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Call the edge function to create the token
      const { data, error } = await supabase.functions.invoke('copier-setup-token', {
        body: {
          role,
          master_account_id: masterAccountId,
          sync_history_enabled: syncHistoryEnabled,
          sync_history_from: syncHistoryFrom,
        },
      });

      if (error) throw error;
      return data as { token: string; expires_at: string; role: CopierRole; master_account_id: string | null };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['copier-accounts'] });
    },
  });
}

export function useDeleteSetupToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tokenId: string) => {
      const { error } = await supabase
        .from('setup_tokens')
        .delete()
        .eq('id', tokenId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-tokens'] });
    },
  });
}
