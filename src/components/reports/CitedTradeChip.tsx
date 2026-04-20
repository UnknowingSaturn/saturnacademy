import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, parseISO } from "date-fns";

interface CitedTradeChipProps {
  tradeId: string;
}

export function CitedTradeChip({ tradeId }: CitedTradeChipProps) {
  const navigate = useNavigate();
  const { data: trade } = useQuery({
    queryKey: ["trade-chip", tradeId],
    queryFn: async () => {
      const { data } = await supabase
        .from("trades")
        .select("trade_number, symbol, direction, entry_time, net_pnl, r_multiple_actual")
        .eq("id", tradeId)
        .maybeSingle();
      return data;
    },
  });

  const num = trade?.trade_number ? `#${trade.trade_number}` : `#${tradeId.slice(0, 4)}`;
  const r = trade?.r_multiple_actual;
  const pnl = trade?.net_pnl ?? 0;
  const isWin = pnl > 0;
  const sym = trade?.symbol || "";
  const rLabel = r != null ? `${r >= 0 ? "+" : ""}${r.toFixed(1)}R` : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => navigate(`/journal?trade=${tradeId}`)}
          className={`inline-flex items-center gap-1 align-baseline mx-0.5 px-1.5 py-0.5 rounded-md border text-[11px] font-mono leading-tight transition-colors hover:bg-accent ${
            isWin
              ? "border-success/30 text-success bg-success/5"
              : "border-destructive/30 text-destructive bg-destructive/5"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isWin ? "bg-success" : "bg-destructive"}`} />
          <span className="font-semibold">{num}</span>
          {sym && <span className="opacity-80">{sym}</span>}
          {rLabel && <span className="opacity-90">{rLabel}</span>}
        </button>
      </TooltipTrigger>
      {trade && (
        <TooltipContent>
          <div className="text-xs space-y-1">
            <div className="font-semibold">{trade.symbol} {trade.direction}</div>
            <div className="text-muted-foreground">{format(parseISO(trade.entry_time), "MMM d, HH:mm")}</div>
            <div>P&L: {pnl.toFixed(2)} {r != null && `· ${r.toFixed(2)}R`}</div>
          </div>
        </TooltipContent>
      )}
    </Tooltip>
  );
}
