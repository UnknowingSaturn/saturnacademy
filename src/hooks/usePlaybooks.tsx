import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Playbook, ChecklistQuestion, SessionType, RegimeType, EntryZoneRules } from '@/types/trading';
import { useToast } from '@/hooks/use-toast';
import { Json } from '@/integrations/supabase/types';

function transformPlaybook(row: any): Playbook {
  return {
    ...row,
    checklist_questions: (row.checklist_questions as ChecklistQuestion[]) || [],
    session_filter: row.session_filter as SessionType[] | null,
    symbol_filter: row.symbol_filter as string[] | null,
    valid_regimes: (row.valid_regimes as RegimeType[]) || [],
    entry_zone_rules: (row.entry_zone_rules as EntryZoneRules) || {},
    confirmation_rules: (row.confirmation_rules as string[]) || [],
    invalidation_rules: (row.invalidation_rules as string[]) || [],
    management_rules: (row.management_rules as string[]) || [],
    failure_modes: (row.failure_modes as string[]) || [],
  };
}

export function usePlaybooks() {
  return useQuery({
    queryKey: ['playbooks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('playbooks')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []).map(transformPlaybook);
    },
  });
}

export function usePlaybook(playbookId: string | undefined) {
  return useQuery({
    queryKey: ['playbook', playbookId],
    queryFn: async () => {
      if (!playbookId) return null;
      const { data, error } = await supabase.from('playbooks').select('*').eq('id', playbookId).maybeSingle();
      if (error) throw error;
      return data ? transformPlaybook(data) : null;
    },
    enabled: !!playbookId,
  });
}

export function useCreatePlaybook() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (playbook: Partial<Playbook> & { name: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('playbooks')
        .insert({
          user_id: user.id,
          name: playbook.name,
          description: playbook.description,
          is_active: playbook.is_active ?? true,
          checklist_questions: (playbook.checklist_questions || []) as unknown as Json,
          session_filter: playbook.session_filter || null,
          symbol_filter: playbook.symbol_filter || null,
          valid_regimes: playbook.valid_regimes || [],
          entry_zone_rules: (playbook.entry_zone_rules || {}) as unknown as Json,
          confirmation_rules: playbook.confirmation_rules || [],
          invalidation_rules: playbook.invalidation_rules || [],
          management_rules: playbook.management_rules || [],
          failure_modes: playbook.failure_modes || [],
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      toast({ title: 'Playbook created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create playbook', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdatePlaybook() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Playbook> & { id: string }) => {
      const updateData: Record<string, unknown> = {};
      
      // Map all fields explicitly
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.is_active !== undefined) updateData.is_active = updates.is_active;
      if (updates.checklist_questions !== undefined) {
        updateData.checklist_questions = updates.checklist_questions as unknown as Json;
      }
      if (updates.session_filter !== undefined) updateData.session_filter = updates.session_filter;
      if (updates.symbol_filter !== undefined) updateData.symbol_filter = updates.symbol_filter;
      if (updates.valid_regimes !== undefined) updateData.valid_regimes = updates.valid_regimes;
      if (updates.entry_zone_rules !== undefined) {
        updateData.entry_zone_rules = updates.entry_zone_rules as unknown as Json;
      }
      if (updates.confirmation_rules !== undefined) updateData.confirmation_rules = updates.confirmation_rules;
      if (updates.invalidation_rules !== undefined) updateData.invalidation_rules = updates.invalidation_rules;
      if (updates.management_rules !== undefined) updateData.management_rules = updates.management_rules;
      if (updates.failure_modes !== undefined) updateData.failure_modes = updates.failure_modes;
      
      const { data, error } = await supabase.from('playbooks').update(updateData).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      queryClient.invalidateQueries({ queryKey: ['playbook', variables.id] });
      toast({ title: 'Playbook updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update playbook', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeletePlaybook() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (playbookId: string) => {
      const { error } = await supabase.from('playbooks').update({ is_active: false }).eq('id', playbookId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      toast({ title: 'Playbook deleted successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to delete playbook', description: error.message, variant: 'destructive' });
    },
  });
}