import { useMemo, useState } from "react";
import { Trade } from "@/types/trading";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface PnLCalendarProps {
  trades: Trade[];
  onDayClick?: (date: Date, trades: Trade[]) => void;
}

interface DayData {
  date: Date;
  trades: Trade[];
  pnl: number;
  winRate: number;
  tradeCount: number;
}

export function PnLCalendar({ trades, onDayClick }: PnLCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

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

  const firstDayOfMonth = getDay(startOfMonth(currentMonth));
  const daysArray = Array.from(calendarData.values());
  const isProfit = monthStats.totalPnl >= 0;

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
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
            <p className="text-sm text-muted-foreground">Daily performance breakdown</p>
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
            const intensity = hasTradesOnDay 
              ? Math.min(Math.abs(day.pnl) / 500, 1) * 0.5 + 0.1
              : 0;

            return (
              <button
                key={day.date.toISOString()}
                onClick={() => onDayClick?.(day.date, day.trades)}
                disabled={!hasTradesOnDay}
                className={cn(
                  "aspect-square rounded-lg p-1 transition-all duration-200 flex flex-col items-center justify-center gap-0.5 relative",
                  hasTradesOnDay && "cursor-pointer hover:scale-105",
                  !hasTradesOnDay && "opacity-50",
                  isGreen && "border border-profit/30",
                  isRed && "border border-loss/30",
                  !hasTradesOnDay && "border border-transparent"
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
  );
}
