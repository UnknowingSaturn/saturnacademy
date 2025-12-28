import { useState } from "react";
import { Trade, SessionType } from "@/types/trading";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TradeReviewPanel } from "./TradeReviewPanel";

interface TradeRowProps {
  trade: Trade;
}

const sessionBadges: Record<SessionType, string> = {
  tokyo: "session-tokyo",
  london: "session-london",
  new_york: "session-newyork",
  overlap_london_ny: "session-overlap",
  off_hours: "bg-muted text-muted-foreground",
};

const sessionLabels: Record<SessionType, string> = {
  tokyo: "Tokyo",
  london: "London",
  new_york: "New York",
  overlap_london_ny: "Overlap",
  off_hours: "Off Hours",
};

export function TradeRow({ trade }: TradeRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const pnl = trade.net_pnl || 0;
  const isWin = pnl > 0;
  const isLoss = pnl < 0;
  const isBreakeven = pnl === 0 && !trade.is_open;

  const score = trade.review?.score || 0;

  return (
    <div className={cn(
      "trade-row",
      isWin && "trade-row-win",
      isLoss && "trade-row-loss",
      isBreakeven && "trade-row-breakeven"
    )}>
      {/* Collapsed Row */}
      <div 
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <button className="p-1 rounded hover:bg-muted">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {/* Date */}
        <div className="w-24 shrink-0">
          <p className="text-sm font-medium">
            {format(new Date(trade.entry_time), "MMM d")}
          </p>
          <p className="text-xs text-muted-foreground">
            {format(new Date(trade.entry_time), "HH:mm")}
          </p>
        </div>

        {/* Symbol & Direction */}
        <div className="w-28 shrink-0">
          <p className="font-medium">{trade.symbol}</p>
          <p className={cn(
            "text-xs font-medium uppercase",
            trade.direction === "buy" ? "text-profit" : "text-loss"
          )}>
            {trade.direction}
          </p>
        </div>

        {/* Session */}
        <div className="w-24 shrink-0">
          {trade.session && (
            <span className={cn("session-badge", sessionBadges[trade.session])}>
              {sessionLabels[trade.session]}
            </span>
          )}
        </div>

        {/* R:R */}
        <div className="w-20 shrink-0 text-center">
          {trade.r_multiple_actual !== null ? (
            <span className={cn(
              "font-mono-numbers font-medium",
              trade.r_multiple_actual >= 0 ? "text-profit" : "text-loss"
            )}>
              {trade.r_multiple_actual >= 0 ? "+" : ""}{trade.r_multiple_actual.toFixed(2)}R
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>

        {/* P&L */}
        <div className="w-24 shrink-0 text-right">
          {trade.is_open ? (
            <span className="text-sm text-muted-foreground">Open</span>
          ) : (
            <span className={cn(
              "font-mono-numbers font-medium",
              isWin && "text-profit",
              isLoss && "text-loss"
            )}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </span>
          )}
        </div>

        {/* Score */}
        <div className="w-16 shrink-0 text-center">
          {trade.review ? (
            <span className={cn(
              "score-indicator w-8 h-8",
              score >= 4 && "score-high",
              score >= 2 && score < 4 && "score-medium",
              score < 2 && "score-low"
            )}>
              {score}/5
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No review</span>
          )}
        </div>

        {/* Emotional State */}
        <div className="flex-1 min-w-0">
          {trade.review?.emotional_state_before && (
            <span className={cn(
              "text-xs capitalize",
              ["great", "good", "calm", "confident", "focused"].includes(trade.review.emotional_state_before) && "emotion-positive",
              ["alright", "okay", "normal"].includes(trade.review.emotional_state_before) && "emotion-neutral",
              ["rough", "anxious", "fomo", "revenge", "tilted", "exhausted"].includes(trade.review.emotional_state_before) && "emotion-negative"
            )}>
              {trade.review.emotional_state_before}
            </span>
          )}
        </div>
      </div>

      {/* Expanded Review Panel */}
      {isExpanded && (
        <div className="expand-content border-t border-border bg-muted/20">
          <TradeReviewPanel trade={trade} />
        </div>
      )}
    </div>
  );
}