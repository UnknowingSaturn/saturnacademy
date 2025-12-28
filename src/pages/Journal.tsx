import { useState } from "react";
import { useTrades } from "@/hooks/useTrades";
import { TradeTable } from "@/components/journal/TradeTable";
import { TradeDetailPanel } from "@/components/journal/TradeDetailPanel";
import { ManualTradeForm } from "@/components/journal/ManualTradeForm";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionType, Trade } from "@/types/trading";
import { Search } from "lucide-react";

export default function Journal() {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionType | "all">("all");
  const [resultFilter, setResultFilter] = useState<"all" | "win" | "loss" | "open">("all");
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  const { data: trades, isLoading } = useTrades();

  const filteredTrades = trades?.filter(trade => {
    if (symbolFilter && !trade.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) {
      return false;
    }
    if (sessionFilter !== "all" && trade.session !== sessionFilter) {
      return false;
    }
    if (resultFilter === "win" && (trade.net_pnl || 0) <= 0) return false;
    if (resultFilter === "loss" && (trade.net_pnl || 0) >= 0) return false;
    if (resultFilter === "open" && !trade.is_open) return false;
    return true;
  }) || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trade Journal</h1>
          <p className="text-muted-foreground">Review and analyze your trades</p>
        </div>
        <ManualTradeForm />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            placeholder="Search symbol..."
            className="pl-9"
          />
        </div>
        <Select value={sessionFilter} onValueChange={(v) => setSessionFilter(v as SessionType | "all")}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Session" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sessions</SelectItem>
            <SelectItem value="tokyo">Tokyo</SelectItem>
            <SelectItem value="london">London</SelectItem>
            <SelectItem value="new_york">New York</SelectItem>
            <SelectItem value="overlap_london_ny">Overlap</SelectItem>
            <SelectItem value="off_hours">Off Hours</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resultFilter} onValueChange={(v) => setResultFilter(v as typeof resultFilter)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Result" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="win">Wins</SelectItem>
            <SelectItem value="loss">Losses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Trade Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : filteredTrades.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No trades found</p>
          <p className="text-sm">Import trades or add them manually to get started</p>
        </div>
      ) : (
        <TradeTable trades={filteredTrades} onTradeClick={setSelectedTrade} />
      )}

      {/* Trade Detail Panel */}
      <TradeDetailPanel
        trade={selectedTrade}
        isOpen={!!selectedTrade}
        onClose={() => setSelectedTrade(null)}
      />
    </div>
  );
}
