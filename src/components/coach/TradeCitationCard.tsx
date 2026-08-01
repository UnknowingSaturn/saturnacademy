import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TradeCitation {
  symbol: string;
  side?: string | null;
  date?: string | null;
  /** e.g. "TKY Continuation playbook trade" */
  detail?: string | null;
  /** signed R multiple, when the model quoted one */
  r?: number | null;
  tradeId?: string | null;
}

/**
 * Compact, report-style rendering of a trade the Coach cited in prose.
 * Purely presentational — the data is parsed from the assistant message.
 */
export function TradeCitationCard({ c }: { c: TradeCitation }) {
  const navigate = useNavigate();
  const win = c.r != null ? c.r >= 0 : null;

  const go = () => {
    if (c.tradeId) navigate(`/journal?trade=${c.tradeId}`);
    else navigate(`/journal?symbol=${encodeURIComponent(c.symbol)}`);
  };

  return (
    <button
      type="button"
      onClick={go}
      className={cn(
        "group w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left",
        "border border-border/70 bg-muted/30 hover:bg-muted/60 hover:border-border transition-colors",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold tracking-tight text-foreground">{c.symbol}</span>
          {c.side && (
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide",
                /sell|short/i.test(c.side) ? "bg-loss/10 text-loss" : "bg-profit/10 text-profit",
              )}
            >
              {c.side}
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {[c.date, c.detail].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {c.r != null && (
          <span
            className={cn(
              "px-2 py-1 rounded border text-[11px] font-mono font-bold",
              win ? "bg-profit/10 border-profit/20 text-profit" : "bg-loss/10 border-loss/20 text-loss",
            )}
          >
            {c.r > 0 ? "+" : ""}
            {c.r.toFixed(2)}R
          </span>
        )}
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}
