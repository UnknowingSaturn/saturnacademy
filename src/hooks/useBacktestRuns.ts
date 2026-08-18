// ============================================================================
// useBacktestRuns — run history for the backtest lab.
//
// Runs are first-class objects: a stored run carries its config, its metrics
// and its fills, so a result can be re-opened, compared, and (because the
// config hash is stored) recognised as already computed instead of re-run.
// ============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { IctBacktestResponse } from "@/workers/ictBacktest.worker";
import type { BacktestTrade } from "../../shared/quant/ict/engine";

export interface BacktestRunRow {
  id: string;
  label: string;
  config: Record<string, unknown>;
  config_hash: string;
  symbols: string[];
  date_from: string | null;
  date_to: string | null;
  include_holdout: boolean;
  status: string;
  metrics: Record<string, unknown>;
  trade_count: number;
  created_at: string;
}

export function useBacktestRuns(symbol?: string) {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["backtest-runs", symbol ?? "all"],
    queryFn: async (): Promise<BacktestRunRow[]> => {
      let q = supabase
        .from("backtest_runs")
        .select("id,label,config,config_hash,symbols,date_from,date_to,include_holdout,status,metrics,trade_count,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (symbol) q = q.contains("symbols", [symbol]);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as BacktestRunRow[];
    },
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("backtest_runs").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Run deleted");
      void qc.invalidateQueries({ queryKey: ["backtest-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Rehydrate a stored run into the same shape the worker returns. */
  const load = useMutation({
    mutationFn: async (row: BacktestRunRow): Promise<IctBacktestResponse> => {
      const { data, error } = await supabase
        .from("backtest_trades")
        .select("*")
        .eq("run_id", row.id)
        .order("entry_ts", { ascending: true });
      if (error) throw new Error(error.message);

      const trades = (data ?? []).map((t): BacktestTrade => ({
        symbol: t.symbol,
        sessionDate: t.session_date,
        windowKey: t.window_key,
        journalSession: t.window_key,
        direction: t.direction as "long" | "short",
        setupIndex: 0,
        setupTs: t.setup_ts ? Date.parse(t.setup_ts) : Date.parse(t.entry_ts),
        entryIndex: 0,
        entryTs: Date.parse(t.entry_ts),
        entryPrice: t.entry_price,
        stopPrice: t.stop_price,
        targetPrice: t.target_price,
        exitIndex: 0,
        exitTs: t.exit_ts ? Date.parse(t.exit_ts) : Date.parse(t.entry_ts),
        exitPrice: t.exit_price ?? t.entry_price,
        exitReason: (t.exit_reason ?? "window_end") as BacktestTrade["exitReason"],
        barsHeld: t.bars_held ?? 0,
        riskPoints: Math.abs(t.entry_price - t.stop_price),
        grossPoints: 0,
        grossPnl: t.gross_pnl ?? 0,
        commission: 0,
        spreadCost: 0,
        size: 0,
        riskCash: 0,
        netPnl: t.net_pnl ?? 0,
        rMultiple: t.r_multiple ?? 0,
        maePoints: t.mae_points ?? 0,
        mfePoints: t.mfe_points ?? 0,
        ambiguousBar: t.ambiguous_bar,
      }));

      const metrics = row.metrics as {
        summary?: IctBacktestResponse["summary"];
        stats?: IctBacktestResponse["stats"];
        walkForward?: IctBacktestResponse["walkForward"];
      };
      let cash = 0;
      let r = 0;
      const equity = trades.map((t) => {
        cash += t.netPnl;
        r += t.rMultiple;
        return { ts: t.exitTs, equity: cash, r };
      });

      return {
        id: -1,
        ok: true,
        mode: row.include_holdout ? "walkforward" : "single",
        summary: metrics.summary,
        stats: metrics.stats,
        walkForward: metrics.walkForward
          ? { ...metrics.walkForward, oosEquity: equity }
          : undefined,
        trades,
        equity,
        noTrades: [],
      };
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { runs: list.data ?? [], isLoading: list.isLoading, remove, load };
}
