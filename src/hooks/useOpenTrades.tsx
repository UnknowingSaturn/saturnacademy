import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Trade, TradeReview, Playbook } from "@/types/trading";
import { usePlaybooks } from "./usePlaybooks";

interface OpenTradeWithCompliance extends Trade {
  matchedPlaybook?: Playbook;
  complianceStatus: 'pending' | 'compliant' | 'violations';
}

function transformTrade(row: any): Trade {
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
    model: row.model,
    alignment: row.alignment,
    entry_timeframes: row.entry_timeframes,
    profile: row.profile,
    place: row.place,
    trade_number: row.trade_number,
    review: row.trade_reviews?.[0] ? transformReview(row.trade_reviews[0]) : undefined,
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

  return useQuery<OpenTradeWithCompliance[]>({
    queryKey: ["open-trades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trades")
        .select(`
          *,
          trade_reviews(*),
          accounts(*)
        `)
        .eq("is_open", true)
        .order("entry_time", { ascending: false });

      if (error) throw error;

      const trades = (data || []).map(transformTrade);
      
      // Enrich with playbook matching
      return trades.map((trade): OpenTradeWithCompliance => {
        // Find matched playbook by model name
        const matchedPlaybook = trade.model 
          ? playbooks.find(p => p.name === trade.model)
          : undefined;

        // Determine compliance status
        let complianceStatus: 'pending' | 'compliant' | 'violations' = 'pending';
        
        if (!matchedPlaybook) {
          complianceStatus = 'pending'; // No model selected yet
        } else {
          // Check auto-verified rules
          const violations: string[] = [];
          
          // Session filter check
          if (matchedPlaybook.session_filter && matchedPlaybook.session_filter.length > 0 && trade.session) {
            if (!matchedPlaybook.session_filter.includes(trade.session)) {
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
        };
      });
    },
    refetchInterval: 30000, // Refresh every 30 seconds for live trades
  });
}

export function useOpenTradesCount() {
  const { data: trades = [] } = useOpenTrades();
  return trades.length;
}
