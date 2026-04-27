import { useState, useMemo } from "react";
import { useTrades } from "@/hooks/useTrades";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Check, CheckSquare, Square } from "lucide-react";
import {
  format,
  parseISO,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
  isSameDay,
} from "date-fns";
import { cn } from "@/lib/utils";

interface Props {
  selectedTradeIds: Set<string>;
  onAddTrade: (tradeId: string) => void;
  onRemoveTrade: (tradeId: string) => void;
  onBulkAdd?: (tradeIds: string[]) => void;
  onBulkRemove?: (tradeIds: string[]) => void;
}

type RangeKey = "all" | "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "custom";

const RANGE_CHIPS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "custom", label: "Custom" },
];

function rangeFor(key: RangeKey, customFrom?: string, customTo?: string): { from: Date | null; to: Date | null } {
  const now = new Date();
  switch (key) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "this_week":
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case "last_week": {
      const lw = subWeeks(now, 1);
      return { from: startOfWeek(lw, { weekStartsOn: 1 }), to: endOfWeek(lw, { weekStartsOn: 1 }) };
    }
    case "this_month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "custom":
      return {
        from: customFrom ? startOfDay(parseISO(customFrom)) : null,
        to: customTo ? endOfDay(parseISO(customTo)) : null,
      };
    default:
      return { from: null, to: null };
  }
}

export function TradePickerPanel({
  selectedTradeIds,
  onAddTrade,
  onRemoveTrade,
  onBulkAdd,
  onBulkRemove,
}: Props) {
  const { data: trades = [], isLoading } = useTrades();
  const [search, setSearch] = useState("");
  const [rangeKey, setRangeKey] = useState<RangeKey>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const { from, to } = rangeFor(rangeKey, customFrom, customTo);
    let list = trades.filter((t) => {
      if (!t.entry_time) return false;
      const dt = parseISO(t.entry_time);
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      if (q) {
        const hay =
          (t.symbol?.toLowerCase() || "") +
          " " +
          (t.session?.toLowerCase() || "") +
          " " +
          (t.entry_time?.toLowerCase() || "");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Cap: tighter when no date filter, looser otherwise
    const cap = rangeKey === "all" && !q ? 100 : 500;
    return list.slice(0, cap);
  }, [trades, search, rangeKey, customFrom, customTo]);

  // Group filtered trades by day
  const grouped = useMemo(() => {
    const map = new Map<string, { date: Date; items: typeof filtered }>();
    for (const t of filtered) {
      if (!t.entry_time) continue;
      const dt = parseISO(t.entry_time);
      const key = format(dt, "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, { date: dt, items: [] });
      map.get(key)!.items.push(t);
    }
    return Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [filtered]);

  const visibleIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedTradeIds.has(id));
  const anyVisibleSelected = visibleIds.some((id) => selectedTradeIds.has(id));

  const handleSelectAllVisible = () => {
    if (allVisibleSelected) {
      onBulkRemove?.(visibleIds);
    } else {
      const toAdd = visibleIds.filter((id) => !selectedTradeIds.has(id));
      onBulkAdd?.(toAdd);
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-r border-border bg-card overflow-hidden">
      <div className="p-3 border-b border-border space-y-2 shrink-0">
        <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
          Pick trades
        </div>

        {/* Date range chips */}
        <div className="flex flex-wrap gap-1">
          {RANGE_CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => setRangeKey(c.key)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                rangeKey === c.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent text-muted-foreground"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {rangeKey === "custom" && (
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-7 text-[11px]"
            />
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-7 text-[11px]"
            />
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol / session…"
            className="pl-8 h-8 text-xs"
          />
        </div>

        {/* Bulk action */}
        {visibleIds.length > 0 && (onBulkAdd || onBulkRemove) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectAllVisible}
            className="w-full justify-start h-7 text-[11px]"
          >
            {allVisibleSelected ? (
              <CheckSquare className="w-3.5 h-3.5 mr-1.5 text-primary" />
            ) : (
              <Square className="w-3.5 h-3.5 mr-1.5" />
            )}
            {allVisibleSelected
              ? `Clear ${visibleIds.length} visible`
              : anyVisibleSelected
                ? `Select all ${visibleIds.length} visible`
                : `Select all ${visibleIds.length} visible`}
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground">Loading trades…</div>
        ) : grouped.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">No trades found.</div>
        ) : (
          <div className="p-2 space-y-3">
            {grouped.map((group) => {
              const today = isSameDay(group.date, new Date());
              const yesterday = isSameDay(group.date, subDays(new Date(), 1));
              const label = today
                ? "Today"
                : yesterday
                  ? "Yesterday"
                  : format(group.date, "EEE, MMM d");
              return (
                <div key={format(group.date, "yyyy-MM-dd")} className="space-y-1">
                  <div className="sticky top-0 z-10 bg-card/95 backdrop-blur px-1 py-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border/50">
                    <span>{label}</span>
                    <span className="tabular-nums">{group.items.length}</span>
                  </div>
                  {group.items.map((t) => {
                    const selected = selectedTradeIds.has(t.id);
                    const dt = t.entry_time ? parseISO(t.entry_time) : null;
                    return (
                      <button
                        key={t.id}
                        onClick={() => (selected ? onRemoveTrade(t.id) : onAddTrade(t.id))}
                        className={cn(
                          "w-full flex items-center gap-2 p-2 rounded-md text-left transition-colors text-xs",
                          selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent"
                        )}
                      >
                        <div
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                            selected ? "bg-primary border-primary" : "border-border"
                          )}
                        >
                          {selected ? (
                            <Check className="w-3 h-3 text-primary-foreground" />
                          ) : (
                            <Plus className="w-2.5 h-2.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate">{t.symbol}</span>
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1 py-0 h-4 font-mono"
                            >
                              {t.direction?.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground tabular-nums mt-0.5">
                            {dt ? format(dt, "HH:mm") : "—"}
                            {t.session && ` · ${t.session}`}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
