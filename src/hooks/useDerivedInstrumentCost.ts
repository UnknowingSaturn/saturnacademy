// ============================================================================
// useDerivedInstrumentCost — learn an instrument's real cash-per-tick and
// commission from the journal instead of trusting a hard-coded catalogue.
//
// Your broker's contract size is whatever it is; the only ground truth is what
// your own fills paid. For every closed executed trade on the symbol:
//
//     tickValue = |gross P&L| / ((|exit - entry| / tickSize) * lots)
//
// The MEDIAN of that ratio is used (not the mean) so one mis-recorded fill or a
// partially closed leg can't move the number. Commission per side per lot comes
// from the same rows. Anything below a minimum sample count is ignored — a
// wrong override is worse than the catalogue default.
// ============================================================================

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSymbol } from "../../shared/quant/symbolAliasing";
import { instrumentSpec, type InstrumentSpec } from "../../shared/quant/ict/instruments";

const MIN_SAMPLES = 8;

export interface DerivedCost {
  tickValue: number | null;
  commissionPerSide: number | null;
  samples: number;
  /** Spread in ticks — journal rows can't measure it, so it stays modelled. */
  note: string;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function useDerivedInstrumentCost(symbol: string) {
  const canonical = normalizeSymbol(symbol.toUpperCase());

  const query = useQuery({
    queryKey: ["derived-instrument-cost", canonical],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DerivedCost> => {
      const { data, error } = await supabase
        .from("trades")
        .select("symbol,entry_price,exit_price,total_lots,gross_pnl,commission")
        .eq("trade_type", "executed")
        .eq("is_open", false)
        .not("exit_price", "is", null)
        .not("gross_pnl", "is", null)
        .limit(1000);
      if (error) throw new Error(error.message);

      const spec = instrumentSpec(canonical);
      const ratios: number[] = [];
      const comms: number[] = [];
      for (const t of data ?? []) {
        if (normalizeSymbol(String(t.symbol).toUpperCase()) !== canonical) continue;
        const lots = Number(t.total_lots ?? 0);
        const points = Math.abs(Number(t.exit_price) - Number(t.entry_price));
        const gross = Math.abs(Number(t.gross_pnl));
        if (!(lots > 0) || !(points > 0) || !(gross > 0)) continue;
        const ticks = points / spec.tickSize;
        const perTick = gross / (ticks * lots);
        if (Number.isFinite(perTick) && perTick > 0) ratios.push(perTick);
        const comm = Math.abs(Number(t.commission ?? 0));
        if (comm > 0) comms.push(comm / (2 * lots));
      }

      return {
        tickValue: ratios.length >= MIN_SAMPLES ? median(ratios) : null,
        commissionPerSide: comms.length >= MIN_SAMPLES ? median(comms) : null,
        samples: ratios.length,
        note:
          ratios.length >= MIN_SAMPLES
            ? `Derived from ${ratios.length} of your own closed fills.`
            : `Only ${ratios.length} closed fills on ${canonical} — using catalogue defaults (need ${MIN_SAMPLES}).`,
      };
    },
  });

  const override = useMemo((): Partial<InstrumentSpec> | null => {
    const d = query.data;
    if (!d) return null;
    const out: Partial<InstrumentSpec> = {};
    if (d.tickValue != null) out.tickValue = d.tickValue;
    if (d.commissionPerSide != null) out.commissionPerSide = d.commissionPerSide;
    return Object.keys(out).length ? out : null;
  }, [query.data]);

  return { derived: query.data ?? null, override, isLoading: query.isLoading };
}
