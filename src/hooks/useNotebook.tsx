import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { NotebookEntry, NotebookGoal } from '@/types/notebook';
import { useToast } from '@/hooks/use-toast';
import { Json } from '@/integrations/supabase/types';
import { format } from 'date-fns';

function transformEntry(row: any): NotebookEntry {
  return {
    ...row,
    goals: (row.goals as NotebookGoal[]) || [],
    tags: row.tags || [],
  };
}

export function useNotebookEntries(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ['notebook-entries', dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('notebook_entries')
        .select('*')
        .order('entry_date', { ascending: false });

      if (dateFrom) query = query.gte('entry_date', dateFrom);
      if (dateTo) query = query.lte('entry_date', dateTo);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(transformEntry);
    },
  });
}

export function useNotebookEntry(date: string) {
  return useQuery({
    queryKey: ['notebook-entry', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notebook_entries')
        .select('*')
        .eq('entry_date', date)
        .maybeSingle();

      if (error) throw error;
      return data ? transformEntry(data) : null;
    },
  });
}

export function useTodayEntry() {
  const today = format(new Date(), 'yyyy-MM-dd');
  return useNotebookEntry(today);
}

export function useUpsertNotebookEntry() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (entry: Partial<NotebookEntry> & { entry_date: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('notebook_entries')
        .upsert({
          user_id: user.id,
          entry_date: entry.entry_date,
          content: entry.content,
          market_conditions: entry.market_conditions,
          mood_rating: entry.mood_rating,
          energy_level: entry.energy_level,
          goals: (entry.goals || []) as unknown as Json,
          reflection: entry.reflection,
          tags: entry.tags || [],
        }, {
          onConflict: 'user_id,entry_date',
        })
        .select()
        .single();

      if (error) throw error;
      return transformEntry(data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notebook-entries'] });
      queryClient.invalidateQueries({ queryKey: ['notebook-entry', variables.entry_date] });
      toast({ title: 'Entry saved' });
    },
    onError: (error) => {
      toast({ title: 'Failed to save entry', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteNotebookEntry() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from('notebook_entries')
        .delete()
        .eq('id', entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notebook-entries'] });
      toast({ title: 'Entry deleted' });
    },
    onError: (error) => {
      toast({ title: 'Failed to delete entry', description: error.message, variant: 'destructive' });
    },
  });
}
