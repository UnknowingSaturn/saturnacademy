import { Trade, SessionType, EmotionalState, TradeModel, TimeframeAlignment, TradeProfile } from "@/types/trading";
import { useUpdateTrade, useUpdateTradeReview, useCreateTradeReview } from "@/hooks/useTrades";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { BadgeSelect } from "./BadgeSelect";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calendar, Clock, TrendingUp, TrendingDown, DollarSign, Target, Hash } from "lucide-react";

interface TradePropertiesProps {
  trade: Trade;
}

const sessionOptions = [
  { value: "tokyo", label: "Tokyo", color: "tokyo" },
  { value: "london", label: "London", color: "london" },
  { value: "new_york", label: "New York", color: "newyork" },
  { value: "overlap_london_ny", label: "Overlap", color: "overlap" },
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

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function TradeProperties({ trade }: TradePropertiesProps) {
  const updateTrade = useUpdateTrade();
  const updateReview = useUpdateTradeReview();
  const createReview = useCreateTradeReview();

  const handleSessionChange = async (session: string) => {
    await updateTrade.mutateAsync({ id: trade.id, session: session as SessionType });
  };

  const handleModelChange = async (model: string) => {
    await updateTrade.mutateAsync({ id: trade.id, model: model as TradeModel });
  };

  const handleAlignmentChange = async (alignment: string[]) => {
    await updateTrade.mutateAsync({ id: trade.id, alignment: alignment as TimeframeAlignment[] });
  };

  const handleEntryTimeframesChange = async (timeframes: string[]) => {
    await updateTrade.mutateAsync({ id: trade.id, entry_timeframes: timeframes as TimeframeAlignment[] });
  };

  const handleProfileChange = async (profile: string) => {
    await updateTrade.mutateAsync({ id: trade.id, profile: profile as TradeProfile });
  };

  const handleEmotionChange = async (emotion: string) => {
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

  const pnl = trade.net_pnl || 0;
  const isWin = pnl > 0;
  const isLoss = pnl < 0;
  const day = dayNames[new Date(trade.entry_time).getDay()];

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Properties</div>

      {/* Status badge */}
      <div className="flex items-center gap-2 text-xs">
        <Badge variant={trade.is_open ? "outline" : isWin ? "default" : "destructive"}>
          {trade.is_open ? "OPEN" : isWin ? "WIN" : isLoss ? "LOSS" : "BE"}
        </Badge>
        {trade.trade_number && (
          <span className="text-muted-foreground">#{trade.trade_number}</span>
        )}
      </div>

      <Separator />

      {/* Basic Info */}
      <div className="space-y-3">
        <PropertyRow icon={<Hash className="w-3.5 h-3.5" />} label="Pair">
          <span className="font-semibold">{trade.symbol}</span>
        </PropertyRow>

        <PropertyRow icon={<Calendar className="w-3.5 h-3.5" />} label="Day">
          <span>{day}</span>
        </PropertyRow>

        <PropertyRow icon={<Clock className="w-3.5 h-3.5" />} label="Date">
          <span>{format(new Date(trade.entry_time), "MMM d, yyyy h:mm a")}</span>
        </PropertyRow>

        <PropertyRow
          icon={trade.direction === "buy" ? <TrendingUp className="w-3.5 h-3.5 text-profit" /> : <TrendingDown className="w-3.5 h-3.5 text-loss" />}
          label="Direction"
        >
          <span className={cn("font-semibold uppercase", trade.direction === "buy" ? "text-profit" : "text-loss")}>
            {trade.direction}
          </span>
        </PropertyRow>

        <PropertyRow icon={<DollarSign className="w-3.5 h-3.5" />} label="P&L">
          <span className={cn("font-mono-numbers font-bold", isWin && "text-profit", isLoss && "text-loss")}>
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
          </span>
        </PropertyRow>

        <PropertyRow icon={<Target className="w-3.5 h-3.5" />} label="R:R">
          <span
            className={cn(
              "font-mono-numbers font-bold",
              trade.r_multiple_actual && trade.r_multiple_actual >= 0 && "text-profit",
              trade.r_multiple_actual && trade.r_multiple_actual < 0 && "text-loss"
            )}
          >
            {trade.r_multiple_actual !== null
              ? `${trade.r_multiple_actual >= 0 ? "+" : ""}${trade.r_multiple_actual.toFixed(2)}`
              : "—"}
          </span>
        </PropertyRow>
      </div>

      <Separator />

      {/* Editable Properties */}
      <div className="space-y-3">
        <PropertyRow label="Emotion">
          <BadgeSelect
            value={trade.review?.emotional_state_before || ""}
            onChange={(v) => handleEmotionChange(v as string)}
            options={emotionOptions}
            placeholder="Select..."
          />
        </PropertyRow>

        <PropertyRow label="Session">
          <BadgeSelect
            value={trade.session || ""}
            onChange={(v) => handleSessionChange(v as string)}
            options={sessionOptions}
            placeholder="Select..."
          />
        </PropertyRow>

        <PropertyRow label="Model">
          <BadgeSelect
            value={trade.model || ""}
            onChange={(v) => handleModelChange(v as string)}
            options={modelOptions}
            placeholder="Select..."
          />
        </PropertyRow>

        <PropertyRow label="Alignment">
          <BadgeSelect
            value={trade.alignment || []}
            onChange={(v) => handleAlignmentChange(v as string[])}
            options={timeframeOptions}
            placeholder="Select..."
            multiple
          />
        </PropertyRow>

        <PropertyRow label="Entry TF">
          <BadgeSelect
            value={trade.entry_timeframes || []}
            onChange={(v) => handleEntryTimeframesChange(v as string[])}
            options={timeframeOptions}
            placeholder="Select..."
            multiple
          />
        </PropertyRow>

        <PropertyRow label="Profile">
          <BadgeSelect
            value={trade.profile || ""}
            onChange={(v) => handleProfileChange(v as string)}
            options={profileOptions}
            placeholder="Select..."
          />
        </PropertyRow>

        <PropertyRow label="Place">
          <span className="text-sm text-muted-foreground">{trade.place || "Empty"}</span>
        </PropertyRow>
      </div>

      <Separator />

      {/* Trade Details */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry Price</span>
          <span className="font-mono-numbers">{trade.entry_price}</span>
        </div>
        {trade.exit_price && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Exit Price</span>
            <span className="font-mono-numbers">{trade.exit_price}</span>
          </div>
        )}
        {trade.sl_initial && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Stop Loss</span>
            <span className="font-mono-numbers text-loss">{trade.sl_initial}</span>
          </div>
        )}
        {trade.tp_initial && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Take Profit</span>
            <span className="font-mono-numbers text-profit">{trade.tp_initial}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Lots</span>
          <span className="font-mono-numbers">{trade.total_lots}</span>
        </div>
      </div>
    </div>
  );
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
