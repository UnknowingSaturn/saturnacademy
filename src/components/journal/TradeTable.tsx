import { useState, useMemo } from "react";
import { Trade, SessionType, EmotionalState, TimeframeAlignment, TradeProfile } from "@/types/trading";
import { useUpdateTrade, useUpdateTradeReview, useCreateTradeReview } from "@/hooks/useTrades";
import { usePropertyOptions } from "@/hooks/useUserSettings";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { cn } from "@/lib/utils";
import { formatDateET, formatTimeET, getDayNameET } from "@/lib/time";
import { BadgeSelect } from "./BadgeSelect";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu";
import { Input } from "@/components/ui/input";
import { ChevronRight } from "lucide-react";
import { DEFAULT_COLUMNS, ColumnDefinition } from "@/types/settings";

interface TradeTableProps {
  trades: Trade[];
  onTradeClick: (trade: Trade) => void;
  visibleColumns?: string[];
  onEditProperty?: (propertyName: string) => void;
}

export function TradeTable({ trades, onTradeClick, visibleColumns, onEditProperty }: TradeTableProps) {
  const updateTrade = useUpdateTrade();
  const updateReview = useUpdateTradeReview();
  const createReview = useCreateTradeReview();
  const [editingPlace, setEditingPlace] = useState<string | null>(null);
  const [placeValue, setPlaceValue] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Fetch property options
  const { data: sessionOptions = [] } = usePropertyOptions('session');
  const { data: timeframeOptions = [] } = usePropertyOptions('timeframe');
  const { data: profileOptions = [] } = usePropertyOptions('profile');
  const { data: emotionOptions = [] } = usePropertyOptions('emotion');
  
  // Fetch playbooks for model options
  const { data: playbooks } = usePlaybooks();
  
  // Generate dynamic model options from playbooks - use playbook ID as value
  const playbookModelOptions = useMemo(() => {
    if (!playbooks || playbooks.length === 0) return [];
    return playbooks.map((pb) => ({
      value: pb.id,
      label: pb.name,
      customColor: pb.color || undefined, // Use actual playbook hex color
    }));
  }, [playbooks]);

  // Convert property options to BadgeSelect format
  const formatOptions = (options: any[]) => options.map(o => ({
    value: o.value,
    label: o.label,
    color: getColorKey(o.color),
  }));

  // Map hex colors to theme color keys
  const getColorKey = (hexColor: string): string => {
    const colorMap: Record<string, string> = {
      '#22C55E': 'profit',
      '#EF4444': 'loss',
      '#EAB308': 'breakeven',
      '#3B82F6': 'primary',
      '#6B7280': 'muted',
      '#EC4899': 'tokyo',
      '#F59E0B': 'newyork',
    };
    return colorMap[hexColor] || 'muted';
  };

  // Default visible columns
  const activeColumns = visibleColumns || DEFAULT_COLUMNS.filter(c => 
    ['trade_number', 'entry_time', 'day', 'symbol', 'session', 'model', 'alignment', 'entry_timeframes', 'profile', 'r_multiple_actual', 'result', 'emotional_state_before', 'place'].includes(c.key)
  ).map(c => c.key);

  // Sort trades
  const sortedTrades = useMemo(() => {
    if (!sortColumn) return trades;

    return [...trades].sort((a, b) => {
      let aVal: any = a[sortColumn as keyof Trade];
      let bVal: any = b[sortColumn as keyof Trade];

      // Handle special columns
      if (sortColumn === 'result') {
        aVal = a.net_pnl || 0;
        bVal = b.net_pnl || 0;
      } else if (sortColumn === 'emotional_state_before') {
        aVal = a.review?.emotional_state_before || '';
        bVal = b.review?.emotional_state_before || '';
      }

      if (aVal === null || aVal === undefined) return sortDirection === 'asc' ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortDirection === 'asc' ? -1 : 1;

      if (typeof aVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [trades, sortColumn, sortDirection]);

  const handleSort = (column: string, direction: 'asc' | 'desc') => {
    if (sortColumn === column && sortDirection === direction) {
      // Clear sort
      setSortColumn(null);
    } else {
      setSortColumn(column);
      setSortDirection(direction);
    }
  };

  const handleSessionChange = async (trade: Trade, session: string) => {
    await updateTrade.mutateAsync({ id: trade.id, session: session as SessionType });
  };

  const handleModelChange = async (trade: Trade, playbookId: string) => {
    await updateTrade.mutateAsync({ id: trade.id, playbook_id: playbookId || null });
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

  const getColumn = (key: string): ColumnDefinition | undefined => 
    DEFAULT_COLUMNS.find(c => c.key === key);

  // Build grid template columns based on visible columns using minmax() for proportional scaling
  const gridCols = activeColumns.map(key => {
    const col = getColumn(key);
    return col?.width || 'minmax(80px, 1fr)';
  }).join(' ') + ' 40px'; // Fixed width for expand arrow

  return (
    <div className="border border-border rounded-lg overflow-x-auto">
      <div className="w-full">
        {/* Header */}
        <div 
          className="grid gap-2 px-4 py-3 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider"
          style={{ gridTemplateColumns: gridCols }}
        >
          {activeColumns.map(key => {
            const column = getColumn(key);
            if (!column) return null;

            return (
              <div key={key} className={cn(key === 'r_multiple_actual' && 'text-right', key === 'result' && 'text-center')}>
                <ColumnHeaderMenu
                  column={column}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  onFilter={() => {}}
                  onHide={() => {}}
                  onEditProperty={onEditProperty}
                >
                  {column.label}
                </ColumnHeaderMenu>
              </div>
            );
          })}
          <div></div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border">
          {sortedTrades.map((trade) => {
            const result = getResultBadge(trade);
            const day = getDayNameET(trade.entry_time);

            return (
              <div
                key={trade.id}
                className={cn(
                  "grid gap-2 px-4 py-2 items-center",
                  "hover:bg-accent/30 transition-colors group cursor-pointer",
                  trade.net_pnl && trade.net_pnl > 0 && "border-l-2 border-l-profit",
                  trade.net_pnl && trade.net_pnl < 0 && "border-l-2 border-l-loss"
                )}
                style={{ gridTemplateColumns: gridCols }}
                onClick={() => onTradeClick(trade)}
              >
                {activeColumns.map(key => {
                  if (key === 'trade_number') {
                    return (
                      <div key={key} className="text-sm font-mono-numbers text-muted-foreground">
                        {trade.trade_number || "—"}
                      </div>
                    );
                  }

                  if (key === 'entry_time') {
                    return (
                      <div key={key} className="text-sm">
                        <div className="font-medium">{formatDateET(trade.entry_time)}</div>
                        <div className="text-xs text-muted-foreground">{formatTimeET(trade.entry_time)}</div>
                      </div>
                    );
                  }

                  if (key === 'day') {
                    return <div key={key} className="text-sm text-muted-foreground">{day}</div>;
                  }

                  if (key === 'symbol') {
                    return <div key={key} className="font-semibold text-sm">{trade.symbol}</div>;
                  }

                  if (key === 'session') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.session || ""}
                          onChange={(v) => handleSessionChange(trade, v as string)}
                          options={formatOptions(sessionOptions).length > 0 ? formatOptions(sessionOptions) : [
                            { value: "new_york_am", label: "NY AM", color: "newyork" },
                            { value: "london", label: "London", color: "london" },
                            { value: "tokyo", label: "Tokyo", color: "tokyo" },
                            { value: "new_york_pm", label: "NY PM", color: "newyork" },
                            { value: "off_hours", label: "Off Hours", color: "muted" },
                          ]}
                          placeholder="Session"
                        />
                      </div>
                    );
                  }

                  if (key === 'model') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.playbook_id || ""}
                          onChange={(v) => handleModelChange(trade, v as string)}
                          options={playbookModelOptions.length > 0 ? playbookModelOptions : [
                            { value: "", label: "No playbooks", color: "muted" },
                          ]}
                          placeholder="Strategy"
                        />
                      </div>
                    );
                  }

                  if (key === 'alignment') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.alignment || []}
                          onChange={(v) => handleAlignmentChange(trade, v as string[])}
                          options={formatOptions(timeframeOptions).length > 0 ? formatOptions(timeframeOptions) : [
                            { value: "1min", label: "1min", color: "muted" },
                            { value: "5min", label: "5min", color: "muted" },
                            { value: "15min", label: "15min", color: "primary" },
                            { value: "1hr", label: "1hr", color: "primary" },
                            { value: "4hr", label: "4hr", color: "profit" },
                            { value: "daily", label: "Daily", color: "profit" },
                          ]}
                          placeholder="Align"
                          multiple
                        />
                      </div>
                    );
                  }

                  if (key === 'entry_timeframes') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.entry_timeframes || []}
                          onChange={(v) => handleEntryTimeframesChange(trade, v as string[])}
                          options={formatOptions(timeframeOptions).length > 0 ? formatOptions(timeframeOptions) : [
                            { value: "1min", label: "1min", color: "muted" },
                            { value: "5min", label: "5min", color: "muted" },
                            { value: "15min", label: "15min", color: "primary" },
                            { value: "1hr", label: "1hr", color: "primary" },
                            { value: "4hr", label: "4hr", color: "profit" },
                            { value: "daily", label: "Daily", color: "profit" },
                          ]}
                          placeholder="Entry"
                          multiple
                        />
                      </div>
                    );
                  }

                  if (key === 'profile') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.profile || ""}
                          onChange={(v) => handleProfileChange(trade, v as string)}
                          options={formatOptions(profileOptions).length > 0 ? formatOptions(profileOptions) : [
                            { value: "consolidation", label: "Consolidation", color: "primary" },
                            { value: "expansion", label: "Expansion", color: "profit" },
                            { value: "reversal", label: "Reversal", color: "breakeven" },
                            { value: "continuation", label: "Continuation", color: "muted" },
                          ]}
                          placeholder="Profile"
                        />
                      </div>
                    );
                  }

                  if (key === 'r_multiple_actual') {
                    return (
                      <div key={key} className="text-right">
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
                    );
                  }

                  if (key === 'result') {
                    return (
                      <div key={key} className="text-center">
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
                    );
                  }

                  if (key === 'emotional_state_before') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.review?.emotional_state_before || ""}
                          onChange={(v) => handleEmotionChange(trade, v as string)}
                          options={formatOptions(emotionOptions).length > 0 ? formatOptions(emotionOptions) : [
                            { value: "great", label: "Great", color: "profit" },
                            { value: "good", label: "Good", color: "profit" },
                            { value: "calm", label: "Calm", color: "profit" },
                            { value: "normal", label: "Normal", color: "muted" },
                            { value: "anxious", label: "Anxious", color: "loss" },
                            { value: "fomo", label: "FOMO", color: "loss" },
                          ]}
                          placeholder="Emotion"
                        />
                      </div>
                    );
                  }

                  if (key === 'place') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
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
                    );
                  }

                  return null;
                })}

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
