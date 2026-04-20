import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
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

  const label = trade?.trade_number ? `#${trade.trade_number}` : tradeId.slice(0, 6);
  const r = trade?.r_multiple_actual;
  const isWin = (trade?.net_pnl ?? 0) > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => navigate(`/journal?trade=${tradeId}`)}
          className="inline-flex items-center"
        >
          <Badge
            variant="outline"
            className={`cursor-pointer text-xs font-mono mx-0.5 ${
              isWin ? "border-success/40 text-success" : "border-destructive/40 text-destructive"
            }`}
          >
            {label}
          </Badge>
        </button>
      </TooltipTrigger>
      {trade && (
        <TooltipContent>
          <div className="text-xs space-y-1">
            <div className="font-semibold">{trade.symbol} {trade.direction}</div>
            <div className="text-muted-foreground">{format(parseISO(trade.entry_time), "MMM d, HH:mm")}</div>
            <div>P&L: {(trade.net_pnl ?? 0).toFixed(2)} {r != null && `· ${r.toFixed(2)}R`}</div>
          </div>
        </TooltipContent>
      )}
    </Tooltip>
  );
}
