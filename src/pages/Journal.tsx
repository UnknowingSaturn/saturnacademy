import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTrades } from "@/hooks/useTrades";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAccountFilter } from "@/contexts/AccountFilterContext";

import { TradeTable } from "@/components/journal/TradeTable";
import { TradeDetailPanel } from "@/components/journal/TradeDetailPanel";
import { ManualTradeForm } from "@/components/journal/ManualTradeForm";
import { JournalSettingsDialog } from "@/components/journal/JournalSettingsDialog";
import { JournalCalendarView } from "@/components/journal/JournalCalendarView";
import { FilterBar } from "@/components/journal/FilterBar";
import { ArchivedTradesView } from "@/components/journal/ArchivedTradesView";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { SessionType, Trade } from "@/types/trading";
import { FilterCondition } from "@/types/settings";
import { Search, Settings, Table, CalendarDays, X, Archive, Lightbulb, CheckCircle, ChevronLeft, ChevronRight, CalendarIcon } from "lucide-react";
import { 
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, 
  addMonths, subMonths, addWeeks, subWeeks,
  format, isWithinInterval, parseISO
} from "date-fns";
import { cn } from "@/lib/utils";

type PeriodType = "week" | "month" | "custom";

export default function Journal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionType | "all">("all");
  const [resultFilter, setResultFilter] = useState<"all" | "win" | "loss" | "open">("all");
  const [tradeTypeFilter, setTradeTypeFilter] = useState<"all" | "executed" | "ideas">("all");
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("sessions");
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");

  // Period filter state
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();

  const { data: trades, isLoading } = useTrades();
  const { data: settings } = useUserSettings();
  const { selectedAccountId, accounts } = useAccountFilter();

  // Read model filter from URL params on mount
  useEffect(() => {
    const modelParam = searchParams.get('model');
    if (modelParam) {
      setModelFilter(modelParam);
    }
  }, [searchParams]);

  const clearModelFilter = () => {
    setModelFilter(null);
    searchParams.delete('model');
    setSearchParams(searchParams);
  };

  // Period calculations
  const periodRange = useMemo(() => {
    if (periodType === "week") {
      return { start: startOfWeek(currentDate, { weekStartsOn: 1 }), end: endOfWeek(currentDate, { weekStartsOn: 1 }) };
    } else if (periodType === "month") {
      return { start: startOfMonth(currentDate), end: endOfMonth(currentDate) };
    } else if (customFrom && customTo) {
      return { start: customFrom, end: customTo };
    }
    return { start: startOfMonth(currentDate), end: endOfMonth(currentDate) };
  }, [periodType, currentDate, customFrom, customTo]);

  const periodLabel = useMemo(() => {
    if (periodType === "week") {
      return `${format(periodRange.start, "MMM d")} – ${format(periodRange.end, "MMM d, yyyy")}`;
    } else if (periodType === "month") {
      return format(currentDate, "MMMM yyyy");
    } else if (customFrom && customTo) {
      return `${format(customFrom, "MMM d")} – ${format(customTo, "MMM d, yyyy")}`;
    }
    return format(currentDate, "MMMM yyyy");
  }, [periodType, currentDate, periodRange, customFrom, customTo]);

  const navigatePeriod = (direction: -1 | 1) => {
    if (periodType === "week") {
      setCurrentDate(prev => direction === 1 ? addWeeks(prev, 1) : subWeeks(prev, 1));
    } else if (periodType === "month") {
      setCurrentDate(prev => direction === 1 ? addMonths(prev, 1) : subMonths(prev, 1));
    }
  };

  // Apply all filters
  const filteredTrades = useMemo(() => {
    let result = trades || [];

    // Period filter — filter by entry_time
    result = result.filter(trade => {
      try {
        const entryDate = parseISO(trade.entry_time);
        return isWithinInterval(entryDate, { start: periodRange.start, end: periodRange.end });
      } catch {
        return false;
      }
    });

    // Global account filter
    if (selectedAccountId !== "all") {
      result = result.filter(trade => 
        trade.account_id === selectedAccountId || trade.account_id === null
      );
    }

    // Model/Strategy filter (from URL)
    if (modelFilter) {
      result = result.filter(trade => trade.playbook_id === modelFilter || trade.playbook?.name === modelFilter);
    }

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
      result = result.filter(trade => (trade.net_pnl || 0) > 0 && trade.trade_type === 'executed');
    } else if (resultFilter === "loss") {
      result = result.filter(trade => (trade.net_pnl || 0) < 0 && trade.trade_type === 'executed');
    } else if (resultFilter === "open") {
      result = result.filter(trade => trade.is_open);
    }

    // Trade type filter
    if (tradeTypeFilter === "executed") {
      result = result.filter(trade => !trade.trade_type || trade.trade_type === 'executed');
    } else if (tradeTypeFilter === "ideas") {
      result = result.filter(trade => trade.trade_type && trade.trade_type !== 'executed');
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
  }, [trades, symbolFilter, sessionFilter, resultFilter, tradeTypeFilter, modelFilter, activeFilters, selectedAccountId, periodRange]);

  const getTradeValue = (trade: Trade, column: string): any => {
    switch (column) {
      case 'trade_number': return trade.trade_number;
      case 'symbol': return trade.symbol;
      case 'session': return trade.session;
      case 'account': 
        const account = accounts?.find(a => a.id === trade.account_id);
        return account?.name || trade.account_id;
      case 'model': return trade.playbook?.name || trade.playbook_id;
      case 'profile': return trade.profile;
      case 'r_multiple_actual': return trade.r_multiple_actual;
      case 'net_pnl': return trade.net_pnl;
      case 'place': return trade.place;
      case 'emotional_state_before': return trade.review?.emotional_state_before;
      case 'trade_type': return trade.trade_type || 'executed';
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
          {/* View Toggle - only show for active tab */}
          {activeTab === "active" && (
            <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as "table" | "calendar")}>
              <ToggleGroupItem value="table" aria-label="Table view" className="px-3">
                <Table className="w-4 h-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="calendar" aria-label="Calendar view" className="px-3">
                <CalendarDays className="w-4 h-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)}>
            <Settings className="w-4 h-4" />
          </Button>
          <ManualTradeForm />
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <ToggleGroup type="single" value={periodType} onValueChange={(v) => v && setPeriodType(v as PeriodType)}>
          <ToggleGroupItem value="week" className="px-3 text-xs">Week</ToggleGroupItem>
          <ToggleGroupItem value="month" className="px-3 text-xs">Month</ToggleGroupItem>
          <ToggleGroupItem value="custom" className="px-3 text-xs">Custom</ToggleGroupItem>
        </ToggleGroup>

        {periodType !== "custom" ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigatePeriod(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[160px] text-center">{periodLabel}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigatePeriod(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-1.5 text-xs", !customFrom && "text-muted-foreground")}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {customFrom ? format(customFrom, "MMM d, yyyy") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">–</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-1.5 text-xs", !customTo && "text-muted-foreground")}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {customTo ? format(customTo, "MMM d, yyyy") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <Badge variant="secondary" className="text-xs">
          {filteredTrades.length} trade{filteredTrades.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {/* Active/Archived Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "active" | "archived")}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived" className="gap-2">
            <Archive className="w-4 h-4" />
            Archived
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 space-y-4">
          {/* Active Strategy Filter Badge */}
          {modelFilter && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
              <span className="text-sm text-muted-foreground">Showing trades for:</span>
              <Badge variant="default" className="gap-1">
                {modelFilter}
                <button onClick={clearModelFilter} className="ml-1 hover:bg-primary-foreground/20 rounded">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            </div>
          )}

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
              
              {/* Trade Type Filter */}
              <Select value={tradeTypeFilter} onValueChange={(v) => setTradeTypeFilter(v as typeof tradeTypeFilter)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Trade Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="executed">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Executed
                    </span>
                  </SelectItem>
                  <SelectItem value="ideas">
                    <span className="flex items-center gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5" />
                      Ideas & Setups
                    </span>
                  </SelectItem>
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
                <p>No trades found for {periodLabel}</p>
                <p className="text-sm">Try a different period or adjust your filters</p>
              </div>
            ) : (
            <TradeTable 
              trades={filteredTrades}
              onTradeClick={(trade) => setSelectedTradeId(trade.id)}
              visibleColumns={settings?.visible_columns}
              columnOrder={settings?.column_order}
              deletedFields={settings?.deleted_system_fields}
              onEditProperty={handleEditProperty}
              accounts={accounts}
            />
            )
          ) : (
            <JournalCalendarView 
              trades={trades || []} 
              onTradeClick={(trade) => setSelectedTradeId(trade.id)}
            />
          )}
        </TabsContent>

        <TabsContent value="archived" className="mt-4">
          <ArchivedTradesView />
        </TabsContent>
      </Tabs>

      {/* Trade Detail Panel */}
      <TradeDetailPanel
        tradeId={selectedTradeId}
        isOpen={!!selectedTradeId}
        onClose={() => setSelectedTradeId(null)}
      />

      {/* Settings Dialog */}
      <JournalSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
