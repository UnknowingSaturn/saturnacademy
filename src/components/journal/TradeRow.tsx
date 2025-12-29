import { useState } from "react";
import { Trade, SessionType } from "@/types/trading";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { cn } from "@/lib/utils";
import { formatDateET, formatTimeET } from "@/lib/time";
import { ChevronDown, ChevronRight, Image, Sparkles, BookOpen } from "lucide-react";
import { TradeReviewPanel } from "./TradeReviewPanel";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TradeRowProps {
  trade: Trade;
}

const sessionBadges: Record<SessionType, string> = {
  new_york_am: "session-newyork",
  new_york_pm: "session-newyork",
  new_york: "session-newyork",
  overlap_london_ny: "session-newyork",
  london: "session-london",
  tokyo: "session-tokyo",
  off_hours: "bg-muted text-muted-foreground",
};

const sessionLabels: Record<SessionType, string> = {
  new_york_am: "New York AM",
  new_york_pm: "New York PM",
  new_york: "New York",
  overlap_london_ny: "LDN/NY Overlap",
  london: "London",
  tokyo: "Tokyo",
  off_hours: "Off Hours",
};

export function TradeRow({ trade }: TradeRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: playbooks } = usePlaybooks();

  const pnl = trade.net_pnl || 0;
  const isWin = pnl > 0;
  const isLoss = pnl < 0;
  const isBreakeven = pnl === 0 && !trade.is_open;

  const score = trade.review?.score || 0;
  const hasScreenshots = trade.review?.screenshots && trade.review.screenshots.length > 0;
  const hasReview = !!trade.review;
  
  // Get playbook info - use playbook_id directly or from joined data
  const playbookId = trade.playbook_id || trade.review?.playbook_id;
  const playbookFromJoin = trade.playbook;
  const playbookFromId = playbookId ? playbooks?.find(p => p.id === playbookId) : null;
  const playbook = playbookFromJoin || playbookFromId;

  return (
    <div className={cn(
      "trade-row group",
      isWin && "trade-row-win",
      isLoss && "trade-row-loss",
      isBreakeven && "trade-row-breakeven",
      isExpanded && "bg-accent/20"
    )}>
      {/* Ambient Glow Effect for Wins */}
      {isWin && !isExpanded && (
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-profit/5 via-transparent to-transparent" />
        </div>
      )}

      {/* Collapsed Row */}
      <div 
        className={cn(
          "relative flex items-center gap-4 p-4 cursor-pointer transition-all duration-200",
          "hover:bg-accent/30",
          isExpanded && "bg-accent/40"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <button className={cn(
          "p-1.5 rounded-md transition-colors",
          isExpanded ? "bg-primary/20 text-primary" : "hover:bg-muted"
        )}>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {/* Date (ET) */}
        <div className="w-24 shrink-0">
          <p className="text-sm font-medium">
            {formatDateET(trade.entry_time)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatTimeET(trade.entry_time)}
          </p>
        </div>

        {/* Symbol & Direction */}
        <div className="w-28 shrink-0">
          <p className="font-semibold tracking-tight">{trade.symbol}</p>
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "text-xs font-bold uppercase px-1.5 py-0.5 rounded",
              trade.direction === "buy" 
                ? "bg-profit/15 text-profit" 
                : "bg-loss/15 text-loss"
            )}>
              {trade.direction}
            </span>
            <span className="text-xs text-muted-foreground font-mono-numbers">
              {trade.total_lots}L
            </span>
          </div>
        </div>

        {/* Session */}
        <div className="w-24 shrink-0">
          {trade.session && (
            <span className={cn("session-badge", sessionBadges[trade.session])}>
              {sessionLabels[trade.session]}
            </span>
          )}
        </div>

        {/* RR (Risk-Reward) */}
        <div className="w-20 shrink-0 text-center">
          {trade.r_multiple_actual !== null ? (
            <span className={cn(
              "font-mono-numbers font-bold text-sm",
              trade.r_multiple_actual >= 0 ? "text-profit text-glow-profit" : "text-loss"
            )}>
              {trade.r_multiple_actual >= 0 ? "+" : ""}{trade.r_multiple_actual.toFixed(2)}R
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </div>

        {/* P&L */}
        <div className="w-28 shrink-0 text-right">
          {trade.is_open ? (
            <Badge variant="outline" className="animate-pulse">Open</Badge>
          ) : (
            <div>
              <span className={cn(
                "font-mono-numbers font-bold text-lg",
                isWin && "text-profit text-glow-profit",
                isLoss && "text-loss",
                isBreakeven && "text-breakeven"
              )}>
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Score */}
        <div className="w-16 shrink-0 text-center">
          {hasReview ? (
            <span className={cn(
              "score-indicator w-9 h-9 text-xs",
              score >= 4 && "score-high",
              score >= 2 && score < 4 && "score-medium",
              score < 2 && "score-low"
            )}>
              {score}/5
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>

        {/* Indicators */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {/* Playbook badge with custom color */}
          {playbook && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span 
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full cursor-default"
                  style={{ 
                    backgroundColor: `${playbook.color}20`,
                    color: playbook.color,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: `${playbook.color}40`
                  }}
                >
                  <BookOpen className="w-3 h-3" />
                  <span className="max-w-[80px] truncate">{playbook.name}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{playbook.name}</p>
                {playbook.description && (
                  <p className="text-xs text-muted-foreground">{playbook.description}</p>
                )}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Emotional State */}
          {trade.review?.emotional_state_before && (
            <span className={cn(
              "text-xs capitalize px-2 py-0.5 rounded-full",
              ["great", "good", "calm", "confident", "focused"].includes(trade.review.emotional_state_before) 
                && "bg-profit/10 text-profit border border-profit/20",
              ["alright", "okay", "normal"].includes(trade.review.emotional_state_before) 
                && "bg-muted text-muted-foreground border border-border",
              ["rough", "anxious", "fomo", "revenge", "tilted", "exhausted"].includes(trade.review.emotional_state_before) 
                && "bg-loss/10 text-loss border border-loss/20"
            )}>
              {trade.review.emotional_state_before}
            </span>
          )}

          {/* Screenshot indicator */}
          {hasScreenshots && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Image className="w-3.5 h-3.5" />
              {trade.review?.screenshots?.length}
            </span>
          )}

          {/* AI Analysis indicator */}
          {trade.review?.thoughts && trade.review.thoughts.includes("**VERDICT**") && (
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          )}
        </div>
      </div>

      {/* Expanded Review Panel */}
      {isExpanded && (
        <div className="expand-content border-t border-border bg-card/50 backdrop-blur-sm">
          <TradeReviewPanel trade={trade} />
        </div>
      )}
    </div>
  );
}
