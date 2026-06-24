import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Trade, TradeReview, SessionType } from '@/types/trading';
import { toast } from "sonner";
import { Json } from '@/integrations/supabase/types';
import { transformTrade } from '@/lib/tradeTransform';
import { TRADE_SELECT, tradeKeys, invalidateAllTradeCaches } from './_shared/tradeQueries';

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
    queryKey: tradeKeys.list(filters),
    queryFn: async () => {
      let query = supabase
        .from('trades')
        .select(TRADE_SELECT)
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
    queryKey: tradeKeys.detail(tradeId),
    queryFn: async () => {
      if (!tradeId) return null;
      const { data, error } = await supabase
        .from('trades')
        .select(TRADE_SELECT)
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
  return useMutation({
    mutationFn: async (trade: Partial<Trade> & { symbol: string; direction: 'buy' | 'sell'; total_lots: number; entry_price: number; entry_time: string; risk_percent?: number }) => {
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
          risk_percent: trade.risk_percent,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateAllTradeCaches(queryClient);
      toast.success('Trade created successfully');
    },
    onError: (error) => {
      toast.error('Failed to create trade', { description: error.message });
    },
  });
}

export function useUpdateTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Trade> & { id: string }) => {
      const updateData: Record<string, unknown> = {};

      // Array fields
      if (updates.alignment) {
        updateData.alignment = updates.alignment;
      }
      if (updates.entry_timeframes) {
        updateData.entry_timeframes = updates.entry_timeframes;
      }
      // Custom fields (jsonb) — explicit allowlist so silent strip never recurs
      if ((updates as any).custom_fields !== undefined) {
        updateData.custom_fields = (updates as any).custom_fields as unknown as Json;
      }

      // Handle scalar fields
      const scalarFields = [
        'symbol', 'direction', 'total_lots', 'entry_price', 'entry_time',
        'exit_price', 'exit_time', 'sl_initial', 'tp_initial', 'sl_final',
        'tp_final', 'net_pnl', 'gross_pnl', 'commission', 'swap',
        'r_multiple_actual', 'r_multiple_planned', 'session', 'is_open',
        'playbook_id', 'profile', 'place', 'trade_number', 'account_id',
        'actual_playbook_id', 'actual_profile', 'actual_regime',
        'first_half_setup', 'second_half_setup'
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
      invalidateAllTradeCaches(queryClient, { tradeId: variables.id });
      toast.success('Trade updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update trade', { description: error.message });
    },
  });
}

export function useDeleteTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tradeId: string) => {
      const { error } = await supabase.from('trades').delete().eq('id', tradeId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAllTradeCaches(queryClient);
      toast.success('Trade deleted successfully');
    },
    onError: (error) => {
      toast.error('Failed to delete trade', { description: error.message });
    },
  });
}

export function useBulkArchiveTrades() {
  const queryClient = useQueryClient();
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
      invalidateAllTradeCaches(queryClient);
      toast.success(`${count} trade${count !== 1 ? 's' : ''} archived`);
    },
    onError: (error) => {
      toast.error('Failed to archive trades', { description: error.message });
    },
  });
}

export function useRestoreTrades() {
  const queryClient = useQueryClient();
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
      invalidateAllTradeCaches(queryClient);
      toast.success(`${count} trade${count !== 1 ? 's' : ''} restored`);
    },
    onError: (error) => {
      toast.error('Failed to restore trades', { description: error.message });
    },
  });
}

export function useArchiveAllTrades() {
  const queryClient = useQueryClient();
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
      invalidateAllTradeCaches(queryClient);
      toast.success(`${count} trade${count !== 1 ? 's' : ''} archived`);
    },
    onError: (error) => {
      toast.error('Failed to archive trades', { description: error.message });
    },
  });
}

export function useArchivedTrades() {
  return useQuery({
    queryKey: tradeKeys.archived,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trades')
        .select(TRADE_SELECT)
        .eq('is_archived', true)
        .order('archived_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(transformTrade);
    },
  });
}

// Upsert hook - creates or updates review by trade_id (idempotent, prevents duplicates)
export function useUpsertTradeReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { review: Partial<TradeReview> & { trade_id: string }; silent?: boolean }) => {
      const { review, silent } = params;

      // Build a partial payload — only include columns the caller explicitly provided.
      // Postgres UPSERT will only update the columns present in the INSERT payload, so omitted
      // fields are preserved on existing rows. This is the single source of truth that prevents
      // any panel from clobbering another panel's data.
      const payload: Record<string, any> = { trade_id: review.trade_id };
      if ('playbook_id' in review)            payload.playbook_id = review.playbook_id;
      if ('score' in review)                  payload.score = review.score ?? 0;
      if ('regime' in review)                 payload.regime = review.regime;
      if ('news_risk' in review)              payload.news_risk = review.news_risk ?? 'none';
      if ('emotional_state_before' in review) payload.emotional_state_before = review.emotional_state_before;
      if ('emotional_state_after' in review)  payload.emotional_state_after = review.emotional_state_after;
      if ('psychology_notes' in review)       payload.psychology_notes = review.psychology_notes;
      if ('thoughts' in review)               payload.thoughts = review.thoughts;
      if ('checklist_answers' in review)      payload.checklist_answers = (review.checklist_answers || {}) as unknown as Json;
      if ('mistakes' in review)               payload.mistakes = (review.mistakes || []) as unknown as Json;
      if ('did_well' in review)               payload.did_well = (review.did_well || []) as unknown as Json;
      if ('to_improve' in review)             payload.to_improve = (review.to_improve || []) as unknown as Json;
      if ('actionable_steps' in review)       payload.actionable_steps = (review.actionable_steps || []) as unknown as Json;
      if ('screenshots' in review)            payload.screenshots = (review.screenshots || []) as unknown as Json;

      const { data, error } = await supabase
        .from('trade_reviews')
        .upsert(payload as any, { onConflict: 'trade_id' })
        .select()
        .single();

      if (error) throw error;
      return { data, silent };
    },
    onSuccess: (result, variables) => {
      invalidateAllTradeCaches(queryClient, { tradeId: variables.review.trade_id });
      if (!result.silent) {
        toast.success('Review saved successfully');
      }
    },
    onError: (error) => {
      toast.error('Failed to save review', { description: error.message });
    },
  });
}
