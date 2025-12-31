import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Trade, TradeReview, Playbook } from "@/types/trading";
import { usePlaybooks } from "./usePlaybooks";
import { detectSessionFromBrokerTime } from "@/lib/time";

export interface OpenTradeWithCompliance extends Trade {
  matchedPlaybook?: Playbook;
  complianceStatus: 'pending' | 'compliant' | 'violations';
  detectedSession?: string;
}

// Helper to normalize embedded trade_reviews (handles object or array)
function normalizeReviews(raw: any): any[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function transformTrade(row: any): Trade {
  // Normalize reviews - could be object or array after UNIQUE constraint
  const reviews = normalizeReviews(row.trade_reviews);
  const latestReview = reviews[0];

  return {
    id: row.id,
    user_id: row.user_id,
    account_id: row.account_id,
    terminal_id: row.terminal_id,
    ticket: row.ticket,
    symbol: row.symbol,
    direction: row.direction,
    total_lots: Number(row.total_lots),
    entry_price: Number(row.entry_price),
    entry_time: row.entry_time,
    exit_price: row.exit_price ? Number(row.exit_price) : null,
    exit_time: row.exit_time,
    sl_initial: row.sl_initial ? Number(row.sl_initial) : null,
    tp_initial: row.tp_initial ? Number(row.tp_initial) : null,
    sl_final: row.sl_final ? Number(row.sl_final) : null,
    tp_final: row.tp_final ? Number(row.tp_final) : null,
    gross_pnl: row.gross_pnl ? Number(row.gross_pnl) : null,
    commission: Number(row.commission || 0),
    swap: Number(row.swap || 0),
    net_pnl: row.net_pnl ? Number(row.net_pnl) : null,
    r_multiple_planned: row.r_multiple_planned ? Number(row.r_multiple_planned) : null,
    r_multiple_actual: row.r_multiple_actual ? Number(row.r_multiple_actual) : null,
    session: row.session,
    duration_seconds: row.duration_seconds,
    partial_closes: Array.isArray(row.partial_closes) ? row.partial_closes : [],
    is_open: row.is_open ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
    balance_at_entry: row.balance_at_entry ? Number(row.balance_at_entry) : null,
    equity_at_entry: row.equity_at_entry ? Number(row.equity_at_entry) : null,
    playbook_id: row.playbook_id,
    alignment: row.alignment,
    entry_timeframes: row.entry_timeframes,
    profile: row.profile,
    place: row.place,
    trade_number: row.trade_number,
    trade_group_id: row.trade_group_id || null,
    trade_type: row.trade_type || 'executed',
    risk_percent: row.risk_percent ? Number(row.risk_percent) : null,
    review: latestReview ? transformReview(latestReview) : undefined,
    account: row.accounts || undefined,
  };
}

function transformReview(row: any): TradeReview {
  return {
    id: row.id,
    trade_id: row.trade_id,
    playbook_id: row.playbook_id,
    checklist_answers: row.checklist_answers || {},
    score: row.score || 0,
    regime: row.regime,
    news_risk: row.news_risk || 'none',
    emotional_state_before: row.emotional_state_before,
    emotional_state_after: row.emotional_state_after,
    psychology_notes: row.psychology_notes,
    mistakes: Array.isArray(row.mistakes) ? row.mistakes : [],
    did_well: Array.isArray(row.did_well) ? row.did_well : [],
    to_improve: Array.isArray(row.to_improve) ? row.to_improve : [],
    actionable_steps: Array.isArray(row.actionable_steps) ? row.actionable_steps : [],
    thoughts: row.thoughts,
    screenshots: Array.isArray(row.screenshots) ? row.screenshots : [],
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function useOpenTrades() {
  const { data: playbooks = [] } = usePlaybooks();
  const queryClient = useQueryClient();

  // Subscribe to realtime updates for open trades
  useEffect(() => {
    const channel = supabase
      .channel('open-trades-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trades',
        },
        (payload) => {
          // Only invalidate if the trade is open or just became closed
          const newRecord = payload.new as { is_open?: boolean } | undefined;
          const oldRecord = payload.old as { is_open?: boolean } | undefined;
          
          if (newRecord?.is_open || oldRecord?.is_open) {
            queryClient.invalidateQueries({ queryKey: ['open-trades'] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery<OpenTradeWithCompliance[]>({
    queryKey: ["open-trades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trades")
        .select(`
          *,
          playbook:playbooks (*),
          trade_reviews(*),
          accounts(*)
        `)
        .eq("is_open", true)
        .eq("is_archived", false)
        .order("entry_time", { ascending: false });

      if (error) throw error;

      const trades = (data || []).map(transformTrade);
      
      // Enrich with playbook matching and session detection
      return trades.map((trade): OpenTradeWithCompliance => {
        // Find matched playbook by playbook_id (or from joined data)
        const matchedPlaybook = trade.playbook 
          || (trade.playbook_id ? playbooks.find(p => p.id === trade.playbook_id) : undefined);

        // Detect session using broker time offset
        const brokerOffset = trade.account?.broker_utc_offset ?? 0;
        const detectedSession = detectSessionFromBrokerTime(trade.entry_time, brokerOffset);

        // Determine compliance status
        let complianceStatus: 'pending' | 'compliant' | 'violations' = 'pending';
        
        if (!matchedPlaybook) {
          complianceStatus = 'pending'; // No model selected yet
        } else {
          // Check auto-verified rules
          const violations: string[] = [];
          
          // Session filter check - use detected session from broker time
          if (matchedPlaybook.session_filter && matchedPlaybook.session_filter.length > 0) {
            if (!matchedPlaybook.session_filter.includes(detectedSession)) {
              violations.push('session');
            }
          }
          
          // Symbol filter check
          if (matchedPlaybook.symbol_filter && matchedPlaybook.symbol_filter.length > 0) {
            const normalizedSymbol = trade.symbol.replace(/[^A-Za-z]/g, '').toUpperCase();
            const symbolMatch = matchedPlaybook.symbol_filter.some(s => 
              normalizedSymbol.includes(s.replace(/[^A-Za-z]/g, '').toUpperCase())
            );
            if (!symbolMatch) {
              violations.push('symbol');
            }
          }

          complianceStatus = violations.length > 0 ? 'violations' : 'compliant';
        }

        return {
          ...trade,
          matchedPlaybook,
          complianceStatus,
          detectedSession,
        };
      });
    },
    refetchInterval: 60000, // Reduced to 60s since we have realtime now
  });
}

export function useOpenTradesCount() {
  const { data: trades = [] } = useOpenTrades();
  return trades.length;
}
