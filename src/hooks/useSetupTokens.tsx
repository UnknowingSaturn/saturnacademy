import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface SetupToken {
  id: string;
  user_id: string;
  token: string;
  used: boolean;
  used_at: string | null;
  expires_at: string;
  created_at: string;
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
