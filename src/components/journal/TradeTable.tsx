import { useState } from "react";
import { Trade, SessionType, EmotionalState, TradeModel, TimeframeAlignment, TradeProfile } from "@/types/trading";
import { useUpdateTrade, useUpdateTradeReview, useCreateTradeReview } from "@/hooks/useTrades";
import { cn } from "@/lib/utils";
import { formatDateET, formatTimeET, getDayNameET } from "@/lib/time";
import { BadgeSelect } from "./BadgeSelect";
import { Input } from "@/components/ui/input";
import { ChevronRight } from "lucide-react";

interface TradeTableProps {
  trades: Trade[];
  onTradeClick: (trade: Trade) => void;
}

const sessionOptions = [
  { value: "new_york_am", label: "NY AM", color: "newyork" },
  { value: "london", label: "London", color: "london" },
  { value: "tokyo", label: "Tokyo", color: "tokyo" },
  { value: "new_york_pm", label: "NY PM", color: "newyork" },
  { value: "off_hours", label: "Off Hours", color: "muted" },
];

const modelOptions = [
  { value: "type_a", label: "Type A", color: "primary" },
  { value: "type_b", label: "Type B", color: "profit" },
  { value: "type_c", label: "Type C", color: "breakeven" },
];

const emotionOptions = [
  { value: "great", label: "Great", color: "profit" },
  { value: "good", label: "Good", color: "profit" },
  { value: "calm", label: "Calm", color: "profit" },
  { value: "confident", label: "Confident", color: "profit" },
  { value: "focused", label: "Focused", color: "profit" },
  { value: "alright", label: "Alright", color: "muted" },
  { value: "okay", label: "Okay", color: "muted" },
  { value: "normal", label: "Normal", color: "muted" },
  { value: "rough", label: "Rough", color: "loss" },
  { value: "anxious", label: "Anxious", color: "loss" },
  { value: "fomo", label: "FOMO", color: "loss" },
  { value: "revenge", label: "Revenge", color: "loss" },
  { value: "tilted", label: "Tilted", color: "loss" },
  { value: "exhausted", label: "Exhausted", color: "loss" },
];

const timeframeOptions = [
  { value: "1min", label: "1min", color: "muted" },
  { value: "5min", label: "5min", color: "muted" },
  { value: "15min", label: "15min", color: "primary" },
  { value: "1hr", label: "1hr", color: "primary" },
  { value: "4hr", label: "4hr", color: "profit" },
  { value: "daily", label: "Daily", color: "profit" },
];

const profileOptions = [
  { value: "consolidation", label: "Consolidation", color: "primary" },
  { value: "expansion", label: "Expansion", color: "profit" },
  { value: "reversal", label: "Reversal", color: "breakeven" },
  { value: "continuation", label: "Continuation", color: "muted" },
];



export function TradeTable({ trades, onTradeClick }: TradeTableProps) {
  const updateTrade = useUpdateTrade();
  const updateReview = useUpdateTradeReview();
  const createReview = useCreateTradeReview();
  const [editingPlace, setEditingPlace] = useState<string | null>(null);
  const [placeValue, setPlaceValue] = useState("");

  const handleSessionChange = async (trade: Trade, session: string) => {
    await updateTrade.mutateAsync({ id: trade.id, session: session as SessionType });
  };

  const handleModelChange = async (trade: Trade, model: string) => {
    await updateTrade.mutateAsync({ id: trade.id, model: model as TradeModel });
  };

  const handleAlignmentChange = async (trade: Trade, alignment: string[]) => {
    await updateTrade.mutateAsync({ id: trade.id, alignment: alignment as TimeframeAlignment[] });
  };

  const handleEntryTimeframesChange = async (trade: Trade, timeframes: string[]) => {
    await updateTrade.mutateAsync({ id: trade.id, entry_timeframes: timeframes as TimeframeAlignment[] });
  };

  const handleProfileChange = async (trade: Trade, profile: string) => {
    await updateTrade.mutateAsync({ id: trade.id, profile: profile as TradeProfile });
  };

  const handlePlaceChange = async (trade: Trade) => {
    await updateTrade.mutateAsync({ id: trade.id, place: placeValue || null });
    setEditingPlace(null);
  };

  const handleEmotionChange = async (trade: Trade, emotion: string) => {
    if (trade.review) {
      await updateReview.mutateAsync({
        id: trade.review.id,
        emotional_state_before: emotion as EmotionalState,
      });
    } else {
      await createReview.mutateAsync({
        trade_id: trade.id,
        emotional_state_before: emotion as EmotionalState,
      });
    }
  };

  const getResultBadge = (trade: Trade) => {
    const pnl = trade.net_pnl || 0;
    if (trade.is_open) return { label: "Open", color: "muted" };
    if (pnl > 0) return { label: "Win", color: "profit" };
    if (pnl < 0) return { label: "Loss", color: "loss" };
    return { label: "BE", color: "breakeven" };
  };

  return (
    <div className="border border-border rounded-lg overflow-x-auto">
      <div className="min-w-[1400px]">
        {/* Header */}
        <div className="grid grid-cols-[50px_120px_60px_80px_100px_90px_100px_100px_100px_80px_80px_100px_100px_1fr] gap-2 px-4 py-3 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <div>#</div>
          <div>Date (EST)</div>
          <div>Day</div>
          <div>Pair</div>
          <div>Session</div>
          <div>Model</div>
          <div>Alignment</div>
          <div>Entry</div>
          <div>Profile</div>
          <div className="text-right">R%</div>
          <div className="text-center">Result</div>
          <div>Emotion</div>
          <div>Place</div>
          <div></div>
        </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {trades.map((trade) => {
          const result = getResultBadge(trade);
          const day = getDayNameET(trade.entry_time);

          return (
            <div
              key={trade.id}
              className={cn(
                "grid grid-cols-[50px_120px_60px_80px_100px_90px_100px_100px_100px_80px_80px_100px_100px_1fr] gap-2 px-4 py-2 items-center",
                "hover:bg-accent/30 transition-colors group cursor-pointer",
                trade.net_pnl && trade.net_pnl > 0 && "border-l-2 border-l-profit",
                trade.net_pnl && trade.net_pnl < 0 && "border-l-2 border-l-loss"
              )}
              onClick={() => onTradeClick(trade)}
            >
              {/* Trade Number */}
              <div className="text-sm font-mono-numbers text-muted-foreground">
                {trade.trade_number || "—"}
              </div>

              {/* Date (ET) */}
              <div className="text-sm">
                <div className="font-medium">{formatDateET(trade.entry_time)}</div>
                <div className="text-xs text-muted-foreground">{formatTimeET(trade.entry_time)}</div>
              </div>

              {/* Day */}
              <div className="text-sm text-muted-foreground">{day}</div>

              {/* Pair/Symbol */}
              <div className="font-semibold text-sm">{trade.symbol}</div>

              {/* Session */}
              <div onClick={(e) => e.stopPropagation()}>
                <BadgeSelect
                  value={trade.session || ""}
                  onChange={(v) => handleSessionChange(trade, v as string)}
                  options={sessionOptions}
                  placeholder="Session"
                />
              </div>

              {/* Model */}
              <div onClick={(e) => e.stopPropagation()}>
                <BadgeSelect
                  value={trade.model || ""}
                  onChange={(v) => handleModelChange(trade, v as string)}
                  options={modelOptions}
                  placeholder="Model"
                />
              </div>

              {/* Alignment */}
              <div onClick={(e) => e.stopPropagation()}>
                <BadgeSelect
                  value={trade.alignment || []}
                  onChange={(v) => handleAlignmentChange(trade, v as string[])}
                  options={timeframeOptions}
                  placeholder="Align"
                  multiple
                />
              </div>

              {/* Entry Timeframes */}
              <div onClick={(e) => e.stopPropagation()}>
                <BadgeSelect
                  value={trade.entry_timeframes || []}
                  onChange={(v) => handleEntryTimeframesChange(trade, v as string[])}
                  options={timeframeOptions}
                  placeholder="Entry"
                  multiple
                />
              </div>

              {/* Profile */}
              <div onClick={(e) => e.stopPropagation()}>
                <BadgeSelect
                  value={trade.profile || ""}
                  onChange={(v) => handleProfileChange(trade, v as string)}
                  options={profileOptions}
                  placeholder="Profile"
                />
              </div>

              {/* R% */}
              <div className="text-right">
                <span
                  className={cn(
                    "font-mono-numbers font-bold text-sm",
                    trade.r_multiple_actual && trade.r_multiple_actual >= 0 && "text-profit",
                    trade.r_multiple_actual && trade.r_multiple_actual < 0 && "text-loss"
                  )}
                >
                  {trade.r_multiple_actual !== null
                    ? `${trade.r_multiple_actual >= 0 ? "+" : ""}${trade.r_multiple_actual.toFixed(1)}%`
                    : "—"}
                </span>
              </div>

              {/* Result */}
              <div className="text-center">
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
                    result.color === "profit" && "bg-profit/15 text-profit border-profit/30",
                    result.color === "loss" && "bg-loss/15 text-loss border-loss/30",
                    result.color === "breakeven" && "bg-breakeven/15 text-breakeven border-breakeven/30",
                    result.color === "muted" && "bg-muted text-muted-foreground border-border"
                  )}
                >
                  {result.label}
                </span>
              </div>

              {/* Emotion */}
              <div onClick={(e) => e.stopPropagation()}>
                <BadgeSelect
                  value={trade.review?.emotional_state_before || ""}
                  onChange={(v) => handleEmotionChange(trade, v as string)}
                  options={emotionOptions}
                  placeholder="Emotion"
                />
              </div>

              {/* Place */}
              <div onClick={(e) => e.stopPropagation()}>
                {editingPlace === trade.id ? (
                  <Input
                    value={placeValue}
                    onChange={(e) => setPlaceValue(e.target.value)}
                    onBlur={() => handlePlaceChange(trade)}
                    onKeyDown={(e) => e.key === "Enter" && handlePlaceChange(trade)}
                    className="h-7 text-sm"
                    autoFocus
                  />
                ) : (
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      setEditingPlace(trade.id);
                      setPlaceValue(trade.place || "");
                    }}
                  >
                    {trade.place || "Add place..."}
                  </button>
                )}
              </div>

              {/* Expand arrow */}
              <div className="flex justify-end">
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
