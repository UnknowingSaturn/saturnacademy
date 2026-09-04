import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface Mt5Install {
  id: string;
  user_id: string;
  install_id: string;
  api_key: string;
  label: string | null;
  status: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export type InstallHealth = 'live' | 'quiet' | 'revoked' | 'never';

export function installHealth(install: Mt5Install, now = Date.now()): InstallHealth {
  if (install.status !== 'active') return 'revoked';
  if (!install.last_seen_at) return 'never';
  const ageMin = (now - new Date(install.last_seen_at).getTime()) / 60000;
  return ageMin <= 30 ? 'live' : 'quiet';
}

export function useMt5Installs() {
  return useQuery({
    queryKey: ['mt5-installs'],
    // Poll so the health strip reflects reality without a manual refresh.
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mt5_installs')
        .select('*')
        .order('last_seen_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as Mt5Install[];
    },
  });
}

export function useSetInstallStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'revoked' }) => {
      const { error } = await supabase.from('mt5_installs').update({ status }).eq('id', id);
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      queryClient.invalidateQueries({ queryKey: ['mt5-installs'] });
      toast.success(status === 'revoked' ? 'Install revoked' : 'Install re-enabled');
    },
    onError: (error) => {
      toast.error('Failed to update install', { description: error.message });
    },
  });
}

export function useRotateInstallKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const apiKey = crypto.randomUUID();
      const { error } = await supabase.from('mt5_installs').update({ api_key: apiKey }).eq('id', id);
      if (error) throw error;
      return apiKey;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mt5-installs'] });
      toast.success('Connection key rotated', {
        description: 'Update the EA on that machine with the new key.',
      });
    },
    onError: (error) => {
      toast.error('Failed to rotate key', { description: error.message });
    },
  });
}
