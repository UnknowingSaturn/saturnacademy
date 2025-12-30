import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Trade, TradeReview, SessionType, ActionableStep, PartialClose } from '@/types/trading';
import { useToast } from '@/hooks/use-toast';
import { Json } from '@/integrations/supabase/types';

// Helper to transform database rows to typed Trade objects
function transformTrade(row: any): Trade {
  return {
    ...row,
    trade_type: row.trade_type || 'executed',
    partial_closes: (row.partial_closes as PartialClose[]) || [],
    review: row.trade_reviews?.[0] ? transformReview(row.trade_reviews[0]) : undefined,
    playbook: row.playbook || undefined,
    ai_review: row.ai_reviews?.[0] || undefined,
  };
}

function transformReview(row: any): TradeReview {
  return {
    ...row,
    checklist_answers: (row.checklist_answers as Record<string, boolean>) || {},
    mistakes: (row.mistakes as string[]) || [],
    did_well: (row.did_well as string[]) || [],
    to_improve: (row.to_improve as string[]) || [],
    actionable_steps: (row.actionable_steps as ActionableStep[]) || [],
    screenshots: (row.screenshots as string[]) || [],
  };
}

export function useTrades(filters?: {
  accountId?: string;
  symbol?: string;
  session?: SessionType;
  dateFrom?: string;
  dateTo?: string;
  isOpen?: boolean;
  isArchived?: boolean;
}) {
  return useQuery({
    queryKey: ['trades', filters],
    queryFn: async () => {
      let query = supabase
        .from('trades')
        .select(`
          *,
          playbook:playbooks (*),
          trade_reviews (
            *,
            playbook:playbooks (*)
          ),
          ai_reviews (*),
          account:accounts (*)
        `)
        .order('entry_time', { ascending: false });

      // Default to showing non-archived trades unless explicitly requested
      if (filters?.isArchived !== undefined) {
        query = query.eq('is_archived', filters.isArchived);
      } else {
        query = query.eq('is_archived', false);
      }

      if (filters?.accountId) query = query.eq('account_id', filters.accountId);
      if (filters?.symbol) query = query.eq('symbol', filters.symbol);
      if (filters?.session) query = query.eq('session', filters.session);
      if (filters?.dateFrom) query = query.gte('entry_time', filters.dateFrom);
      if (filters?.dateTo) query = query.lte('entry_time', filters.dateTo);
      if (filters?.isOpen !== undefined) query = query.eq('is_open', filters.isOpen);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(transformTrade);
    },
  });
}

export function useTrade(tradeId: string | undefined) {
  return useQuery({
    queryKey: ['trade', tradeId],
    queryFn: async () => {
      if (!tradeId) return null;
      const { data, error } = await supabase
        .from('trades')
        .select(`*, playbook:playbooks (*), trade_reviews (*, playbook:playbooks (*)), ai_reviews (*), account:accounts (*)`)
        .eq('id', tradeId)
        .maybeSingle();
      if (error) throw error;
      return data ? transformTrade(data) : null;
    },
    enabled: !!tradeId,
  });
}

export function useCreateTrade() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (trade: Partial<Trade> & { symbol: string; direction: 'buy' | 'sell'; total_lots: number; entry_price: number; entry_time: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('trades')
        .insert({
          user_id: user.id,
          symbol: trade.symbol,
          direction: trade.direction,
          total_lots: trade.total_lots,
          entry_price: trade.entry_price,
          entry_time: trade.entry_time,
          exit_price: trade.exit_price,
          exit_time: trade.exit_time,
          sl_initial: trade.sl_initial,
          tp_initial: trade.tp_initial,
          net_pnl: trade.net_pnl,
          r_multiple_actual: trade.r_multiple_actual,
          session: trade.session,
          is_open: trade.is_open ?? true,
          playbook_id: trade.playbook_id,
          place: trade.place,
          trade_type: trade.trade_type || 'executed',
          partial_closes: (trade.partial_closes || []) as unknown as Json,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      toast({ title: 'Trade created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create trade', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateTrade() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Trade> & { id: string }) => {
      const updateData: Record<string, unknown> = {};
      
      // Handle array fields
      if (updates.partial_closes) {
        updateData.partial_closes = updates.partial_closes as unknown as Json;
      }
      if (updates.alignment) {
        updateData.alignment = updates.alignment;
      }
      if (updates.entry_timeframes) {
        updateData.entry_timeframes = updates.entry_timeframes;
      }
      
      // Handle scalar fields
      const scalarFields = [
        'symbol', 'direction', 'total_lots', 'entry_price', 'entry_time',
        'exit_price', 'exit_time', 'sl_initial', 'tp_initial', 'sl_final',
        'tp_final', 'net_pnl', 'gross_pnl', 'commission', 'swap',
        'r_multiple_actual', 'r_multiple_planned', 'session', 'is_open',
        'playbook_id', 'profile', 'place', 'trade_number'
      ] as const;
      
      for (const field of scalarFields) {
        if (updates[field] !== undefined) {
          updateData[field] = updates[field];
        }
      }
      
      const { data, error } = await supabase
        .from('trades')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['trade', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
      toast({ title: 'Trade updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update trade', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteTrade() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (tradeId: string) => {
      const { error } = await supabase.from('trades').delete().eq('id', tradeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      toast({ title: 'Trade deleted successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to delete trade', description: error.message, variant: 'destructive' });
    },
  });
}

export function useBulkArchiveTrades() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (tradeIds: string[]) => {
      const { error } = await supabase
        .from('trades')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .in('id', tradeIds);
      if (error) throw error;
      return tradeIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
      queryClient.invalidateQueries({ queryKey: ['archived-trades'] });
      toast({ title: `${count} trade${count !== 1 ? 's' : ''} archived` });
    },
    onError: (error) => {
      toast({ title: 'Failed to archive trades', description: error.message, variant: 'destructive' });
    },
  });
}

export function useRestoreTrades() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (tradeIds: string[]) => {
      const { error } = await supabase
        .from('trades')
        .update({ is_archived: false, archived_at: null })
        .in('id', tradeIds);
      if (error) throw error;
      return tradeIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
      queryClient.invalidateQueries({ queryKey: ['archived-trades'] });
      toast({ title: `${count} trade${count !== 1 ? 's' : ''} restored` });
    },
    onError: (error) => {
      toast({ title: 'Failed to restore trades', description: error.message, variant: 'destructive' });
    },
  });
}

export function useArchiveAllTrades() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase
        .from('trades')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq('account_id', accountId)
        .eq('is_archived', false)
        .select('id');

      if (error) throw error;
      return data?.length || 0;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
      queryClient.invalidateQueries({ queryKey: ['archived-trades'] });
      toast({ title: `${count} trade${count !== 1 ? 's' : ''} archived` });
    },
    onError: (error) => {
      toast({ title: 'Failed to archive trades', description: error.message, variant: 'destructive' });
    },
  });
}

export function useArchivedTrades() {
  return useQuery({
    queryKey: ['archived-trades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trades')
        .select(`
          *,
          playbook:playbooks (*),
          trade_reviews (
            *,
            playbook:playbooks (*)
          ),
          ai_reviews (*),
          account:accounts (*)
        `)
        .eq('is_archived', true)
        .order('archived_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(transformTrade);
    },
  });
}

export function useCreateTradeReview() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { review: Partial<TradeReview> & { trade_id: string }; silent?: boolean }) => {
      const { review, silent } = params;
      const { data, error } = await supabase
        .from('trade_reviews')
        .insert({
          trade_id: review.trade_id,
          playbook_id: review.playbook_id,
          score: review.score ?? 0,
          regime: review.regime,
          news_risk: review.news_risk ?? 'none',
          emotional_state_before: review.emotional_state_before,
          emotional_state_after: review.emotional_state_after,
          psychology_notes: review.psychology_notes,
          thoughts: review.thoughts,
          checklist_answers: (review.checklist_answers || {}) as unknown as Json,
          mistakes: (review.mistakes || []) as unknown as Json,
          did_well: (review.did_well || []) as unknown as Json,
          to_improve: (review.to_improve || []) as unknown as Json,
          actionable_steps: (review.actionable_steps || []) as unknown as Json,
          screenshots: (review.screenshots || []) as unknown as Json,
        })
        .select()
        .single();

      if (error) throw error;
      return { data, silent };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['trade', variables.review.trade_id] });
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
      if (!result.silent) {
        toast({ title: 'Review saved successfully' });
      }
    },
    onError: (error) => {
      toast({ title: 'Failed to save review', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateTradeReview() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, silent, ...updates }: Partial<TradeReview> & { id: string; silent?: boolean }) => {
      const updateData: Record<string, unknown> = {};
      if (updates.checklist_answers) updateData.checklist_answers = updates.checklist_answers as unknown as Json;
      if (updates.mistakes) updateData.mistakes = updates.mistakes as unknown as Json;
      if (updates.did_well) updateData.did_well = updates.did_well as unknown as Json;
      if (updates.to_improve) updateData.to_improve = updates.to_improve as unknown as Json;
      if (updates.actionable_steps) updateData.actionable_steps = updates.actionable_steps as unknown as Json;
      if (updates.screenshots) updateData.screenshots = updates.screenshots as unknown as Json;
      if (updates.score !== undefined) updateData.score = updates.score;
      if (updates.regime) updateData.regime = updates.regime;
      if (updates.news_risk) updateData.news_risk = updates.news_risk;
      if (updates.emotional_state_before) updateData.emotional_state_before = updates.emotional_state_before;
      if (updates.emotional_state_after) updateData.emotional_state_after = updates.emotional_state_after;
      if (updates.psychology_notes) updateData.psychology_notes = updates.psychology_notes;
      if (updates.thoughts) updateData.thoughts = updates.thoughts;
      if (updates.playbook_id !== undefined) updateData.playbook_id = updates.playbook_id;

      const { data, error } = await supabase
        .from('trade_reviews')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { data, silent };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['open-trades'] });
      if (!result.silent) {
        toast({ title: 'Review updated successfully' });
      }
    },
    onError: (error) => {
      toast({ title: 'Failed to update review', description: error.message, variant: 'destructive' });
    },
  });
}