import { useState, useMemo } from "react";
import { useTrades } from "@/hooks/useTrades";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Check } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

interface Props {
  selectedTradeIds: Set<string>;
  onAddTrade: (tradeId: string) => void;
  onRemoveTrade: (tradeId: string) => void;
}

export function TradePickerPanel({ selectedTradeIds, onAddTrade, onRemoveTrade }: Props) {
  const { data: trades = [], isLoading } = useTrades();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trades.slice(0, 100);
    return trades.filter(t =>
      t.symbol?.toLowerCase().includes(q) ||
      t.session?.toLowerCase().includes(q) ||
      (t.entry_time && t.entry_time.toLowerCase().includes(q))
    ).slice(0, 100);
  }, [trades, search]);

  return (
    <div className="flex flex-col h-full border-l border-r border-border bg-card">
      <div className="p-3 border-b border-border">
        <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-2">
          Pick trades
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol / session…"
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-4 text-xs text-muted-foreground">Loading trades…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">No trades found.</div>
        ) : (
          <div className="p-2 space-y-1">
            {filtered.map(t => {
              const selected = selectedTradeIds.has(t.id);
              const dt = t.entry_time ? parseISO(t.entry_time) : null;
              return (
                <button
                  key={t.id}
                  onClick={() => selected ? onRemoveTrade(t.id) : onAddTrade(t.id)}
                  className={cn(
                    "w-full flex items-center gap-2 p-2 rounded-md text-left transition-colors text-xs",
                    selected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                    selected ? "bg-primary border-primary" : "border-border"
                  )}>
                    {selected ? <Check className="w-3 h-3 text-primary-foreground" /> : <Plus className="w-2.5 h-2.5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{t.symbol}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-mono">
                        {t.direction?.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground tabular-nums mt-0.5">
                      {dt ? format(dt, "MMM d, HH:mm") : "—"}
                      {t.session && ` · ${t.session}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
