import { useMemo, useState } from "react";
import { Trade } from "@/types/trading";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface JournalCalendarViewProps {
  trades: Trade[];
  onTradeClick: (trade: Trade) => void;
}

interface DayData {
  date: Date;
  trades: Trade[];
  pnl: number;
  winRate: number;
  tradeCount: number;
}

export function JournalCalendarView({ trades, onTradeClick }: JournalCalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const calendarData = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

    const closedTrades = trades.filter(t => !t.is_open && t.exit_time);

    const dayDataMap: Map<string, DayData> = new Map();

    days.forEach(day => {
      const dayKey = format(day, "yyyy-MM-dd");
      const dayTrades = closedTrades.filter(t => 
        t.exit_time && isSameDay(new Date(t.exit_time), day)
      );
      const pnl = dayTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
      const wins = dayTrades.filter(t => (t.net_pnl || 0) > 0).length;
      const winRate = dayTrades.length > 0 ? (wins / dayTrades.length) * 100 : 0;

      dayDataMap.set(dayKey, {
        date: day,
        trades: dayTrades,
        pnl,
        winRate,
        tradeCount: dayTrades.length,
      });
    });

    return dayDataMap;
  }, [trades, currentMonth]);

  const monthStats = useMemo(() => {
    let totalPnl = 0;
    let totalTrades = 0;
    let winningDays = 0;
    let losingDays = 0;

    calendarData.forEach(day => {
      totalPnl += day.pnl;
      totalTrades += day.tradeCount;
      if (day.pnl > 0) winningDays++;
      else if (day.pnl < 0) losingDays++;
    });

    return { totalPnl, totalTrades, winningDays, losingDays };
  }, [calendarData]);

  const selectedDayData = useMemo(() => {
    if (!selectedDate) return null;
    const key = format(selectedDate, "yyyy-MM-dd");
    return calendarData.get(key) || null;
  }, [selectedDate, calendarData]);

  const firstDayOfMonth = getDay(startOfMonth(currentMonth));
  const daysArray = Array.from(calendarData.values());
  const isProfit = monthStats.totalPnl >= 0;

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const handleDayClick = (day: DayData) => {
    if (day.tradeCount > 0) {
      setSelectedDate(prev => 
        prev && isSameDay(prev, day.date) ? null : day.date
      );
    }
  };

  const getResultBadge = (trade: Trade) => {
    if (trade.is_open) return { label: 'Open', color: 'text-muted-foreground' };
    const pnl = trade.net_pnl || 0;
    if (pnl > 0) return { label: 'Win', color: 'text-profit' };
    if (pnl < 0) return { label: 'Loss', color: 'text-loss' };
    return { label: 'BE', color: 'text-muted-foreground' };
  };

  return (
    <div className="space-y-4">
      {/* Calendar Card */}
      <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
        style={{
          boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
        }}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-foreground">P&L Calendar</h3>
              <p className="text-sm text-muted-foreground">Click a day to view trades</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="h-8 w-8 rounded-lg"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold min-w-[120px] text-center">
                {format(currentMonth, "MMMM yyyy")}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="h-8 w-8 rounded-lg"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Month Stats */}
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="text-center">
              <p className={cn(
                "text-xl font-bold font-mono",
                isProfit ? "text-profit" : "text-loss"
              )}
              style={{
                textShadow: isProfit 
                  ? "0 0 20px hsl(var(--profit) / 0.4)"
                  : "0 0 20px hsl(var(--loss) / 0.4)"
              }}
              >
                {isProfit ? "+" : ""}${monthStats.totalPnl.toFixed(0)}
              </p>
              <p className="text-xs text-muted-foreground">Monthly P&L</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-foreground">{monthStats.totalTrades}</p>
              <p className="text-xs text-muted-foreground">Trades</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-profit">{monthStats.winningDays}</p>
              <p className="text-xs text-muted-foreground">Green Days</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-loss">{monthStats.losingDays}</p>
              <p className="text-xs text-muted-foreground">Red Days</p>
            </div>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="p-4">
          {/* Week day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekDays.map(day => (
              <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells for days before month starts */}
            {Array.from({ length: firstDayOfMonth }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}
            
            {daysArray.map(day => {
              const hasTradesOnDay = day.tradeCount > 0;
              const isGreen = day.pnl > 0;
              const isRed = day.pnl < 0;
              const isSelected = selectedDate && isSameDay(selectedDate, day.date);
              const intensity = hasTradesOnDay 
                ? Math.min(Math.abs(day.pnl) / 500, 1) * 0.5 + 0.1
                : 0;

              return (
                <button
                  key={day.date.toISOString()}
                  onClick={() => handleDayClick(day)}
                  disabled={!hasTradesOnDay}
                  className={cn(
                    "aspect-square rounded-lg p-1 transition-all duration-200 flex flex-col items-center justify-center gap-0.5 relative",
                    hasTradesOnDay && "cursor-pointer hover:scale-105",
                    !hasTradesOnDay && "opacity-50",
                    isGreen && "border border-profit/30",
                    isRed && "border border-loss/30",
                    !hasTradesOnDay && "border border-transparent",
                    isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  )}
                  style={{
                    backgroundColor: isGreen 
                      ? `hsl(152, 95%, 45%, ${intensity})`
                      : isRed 
                      ? `hsl(0, 85%, 58%, ${intensity})`
                      : "transparent",
                    boxShadow: hasTradesOnDay
                      ? isGreen 
                        ? `0 0 ${intensity * 20}px hsl(var(--profit) / ${intensity * 0.5})`
                        : `0 0 ${intensity * 20}px hsl(var(--loss) / ${intensity * 0.5})`
                      : "none"
                  }}
                >
                  <span className={cn(
                    "text-xs font-medium",
                    hasTradesOnDay ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {format(day.date, "d")}
                  </span>
                  {hasTradesOnDay && (
                    <>
                      <span className={cn(
                        "text-[10px] font-bold font-mono",
                        isGreen ? "text-profit" : "text-loss"
                      )}>
                        {isGreen ? "+" : ""}${Math.abs(day.pnl).toFixed(0)}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {day.tradeCount}t
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected Day Trade List */}
      {selectedDayData && selectedDayData.tradeCount > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-xl overflow-hidden"
          style={{
            boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.05), 0 8px 32px -8px hsl(0 0% 0% / 0.5)"
          }}
        >
          <div className="p-4 border-b border-border/50 flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-foreground">
                {format(selectedDayData.date, "EEEE, MMMM d, yyyy")}
              </h4>
              <p className="text-sm text-muted-foreground">
                {selectedDayData.tradeCount} trade{selectedDayData.tradeCount > 1 ? 's' : ''} • 
                <span className={cn("ml-1 font-mono", selectedDayData.pnl >= 0 ? "text-profit" : "text-loss")}>
                  {selectedDayData.pnl >= 0 ? "+" : ""}${selectedDayData.pnl.toFixed(2)}
                </span>
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedDate(null)}
              className="text-muted-foreground"
            >
              Close
            </Button>
          </div>
          
          <div className="divide-y divide-border/50">
            {selectedDayData.trades.map(trade => {
              const result = getResultBadge(trade);
              return (
                <button
                  key={trade.id}
                  onClick={() => onTradeClick(trade)}
                  className="w-full p-4 hover:bg-muted/50 transition-colors text-left flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-muted-foreground">
                        #{trade.trade_number}
                      </span>
                      <span className="font-semibold text-foreground">
                        {trade.symbol}
                      </span>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        trade.direction === 'buy' 
                          ? "bg-profit/20 text-profit" 
                          : "bg-loss/20 text-loss"
                      )}>
                        {trade.direction.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                      {trade.session && (
                        <span className="capitalize">{trade.session.replace(/_/g, ' ')}</span>
                      )}
                      {trade.model && (
                        <>
                          <span>•</span>
                          <span>{trade.model}</span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <p className={cn("font-mono font-semibold", result.color)}>
                      {trade.r_multiple_actual !== null 
                        ? `${trade.r_multiple_actual >= 0 ? '+' : ''}${trade.r_multiple_actual.toFixed(1)}R`
                        : '-'
                      }
                    </p>
                    <p className={cn("text-sm", result.color)}>
                      {result.label}
                    </p>
                  </div>
                  
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
