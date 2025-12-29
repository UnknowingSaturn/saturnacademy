import { useState, useMemo } from "react";
import { useTrades } from "@/hooks/useTrades";
import { useUserSettings } from "@/hooks/useUserSettings";
import { TradeTable } from "@/components/journal/TradeTable";
import { TradeDetailPanel } from "@/components/journal/TradeDetailPanel";
import { ManualTradeForm } from "@/components/journal/ManualTradeForm";
import { JournalSettingsDialog } from "@/components/journal/JournalSettingsDialog";
import { JournalCalendarView } from "@/components/journal/JournalCalendarView";
import { FilterBar } from "@/components/journal/FilterBar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SessionType, Trade } from "@/types/trading";
import { FilterCondition } from "@/types/settings";
import { Search, Settings, Table, CalendarDays } from "lucide-react";

export default function Journal() {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionType | "all">("all");
  const [resultFilter, setResultFilter] = useState<"all" | "win" | "loss" | "open">("all");
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("sessions");
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");

  const { data: trades, isLoading } = useTrades();
  const { data: settings } = useUserSettings();

  // Apply all filters
  const filteredTrades = useMemo(() => {
    let result = trades || [];

    // Symbol filter
    if (symbolFilter) {
      result = result.filter(trade => 
        trade.symbol.toLowerCase().includes(symbolFilter.toLowerCase())
      );
    }

    // Session filter
    if (sessionFilter !== "all") {
      result = result.filter(trade => trade.session === sessionFilter);
    }

    // Result filter
    if (resultFilter === "win") {
      result = result.filter(trade => (trade.net_pnl || 0) > 0);
    } else if (resultFilter === "loss") {
      result = result.filter(trade => (trade.net_pnl || 0) < 0);
    } else if (resultFilter === "open") {
      result = result.filter(trade => trade.is_open);
    }

    // Apply advanced filters from FilterBar
    for (const filter of activeFilters) {
      result = result.filter(trade => {
        const value = getTradeValue(trade, filter.column);
        
        switch (filter.operator) {
          case 'equals':
            return String(value).toLowerCase() === String(filter.value).toLowerCase();
          case 'not_equals':
            return String(value).toLowerCase() !== String(filter.value).toLowerCase();
          case 'contains':
            return String(value).toLowerCase().includes(String(filter.value).toLowerCase());
          case 'not_contains':
            return !String(value).toLowerCase().includes(String(filter.value).toLowerCase());
          case 'greater_than':
            return Number(value) > Number(filter.value);
          case 'less_than':
            return Number(value) < Number(filter.value);
          case 'is_empty':
            return value === null || value === undefined || value === '';
          case 'is_not_empty':
            return value !== null && value !== undefined && value !== '';
          default:
            return true;
        }
      });
    }

    return result;
  }, [trades, symbolFilter, sessionFilter, resultFilter, activeFilters]);

  const getTradeValue = (trade: Trade, column: string): any => {
    switch (column) {
      case 'trade_number': return trade.trade_number;
      case 'symbol': return trade.symbol;
      case 'session': return trade.session;
      case 'model': return trade.model;
      case 'profile': return trade.profile;
      case 'r_multiple_actual': return trade.r_multiple_actual;
      case 'net_pnl': return trade.net_pnl;
      case 'place': return trade.place;
      case 'emotional_state_before': return trade.review?.emotional_state_before;
      case 'result':
        if (trade.is_open) return 'open';
        if ((trade.net_pnl || 0) > 0) return 'win';
        if ((trade.net_pnl || 0) < 0) return 'loss';
        return 'be';
      default:
        return (trade as any)[column];
    }
  };

  const handleEditProperty = (propertyName: string) => {
    setSettingsTab("properties");
    setSettingsOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Trade Journal</h1>
          <p className="text-muted-foreground">Review and analyze your trades</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as "table" | "calendar")}>
            <ToggleGroupItem value="table" aria-label="Table view" className="px-3">
              <Table className="w-4 h-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="calendar" aria-label="Calendar view" className="px-3">
              <CalendarDays className="w-4 h-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)}>
            <Settings className="w-4 h-4" />
          </Button>
          <ManualTradeForm />
        </div>
      </div>

      {/* Filters - only show for table view */}
      {viewMode === "table" && (
        <div className="flex flex-wrap gap-3 items-center">
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
              <SelectItem value="new_york_am">New York AM</SelectItem>
              <SelectItem value="london">London</SelectItem>
              <SelectItem value="tokyo">Tokyo</SelectItem>
              <SelectItem value="new_york_pm">New York PM</SelectItem>
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
          
          {/* Advanced Filter Bar */}
          <FilterBar filters={activeFilters} onFiltersChange={setActiveFilters} />
        </div>
      )}

      {/* Content based on view mode */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : viewMode === "table" ? (
        filteredTrades.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No trades found</p>
            <p className="text-sm">Import trades or add them manually to get started</p>
          </div>
        ) : (
          <TradeTable 
            trades={filteredTrades} 
            onTradeClick={setSelectedTrade}
            visibleColumns={settings?.visible_columns}
            onEditProperty={handleEditProperty}
          />
        )
      ) : (
        <JournalCalendarView 
          trades={trades || []} 
          onTradeClick={setSelectedTrade}
        />
      )}

      {/* Trade Detail Panel */}
      <TradeDetailPanel
        trade={selectedTrade}
        isOpen={!!selectedTrade}
        onClose={() => setSelectedTrade(null)}
      />

      {/* Settings Dialog */}
      <JournalSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
