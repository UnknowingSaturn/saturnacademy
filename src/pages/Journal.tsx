import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTrades } from "@/hooks/useTrades";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { useGroupedTradesView, useAutoGroupTrades, TradeGroup } from "@/hooks/useTradeGroups";

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
import { SessionType, Trade } from "@/types/trading";
import { FilterCondition } from "@/types/settings";
import { Search, Settings, Table, CalendarDays, X, Archive, Layers, List, Wand2 } from "lucide-react";
import { toast } from "sonner";

export default function Journal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionType | "all">("all");
  const [resultFilter, setResultFilter] = useState<"all" | "win" | "loss" | "open">("all");
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("sessions");
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");
  const [tradeViewMode, setTradeViewMode] = useState<"ideas" | "all">("ideas");

  const { data: trades, isLoading } = useTrades();
  const { data: settings } = useUserSettings();
  const { selectedAccountId, accounts } = useAccountFilter();
  const { data: groupedData, isLoading: isLoadingGroups } = useGroupedTradesView();
  const autoGroup = useAutoGroupTrades();

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

  // Apply all filters
  const filteredTrades = useMemo(() => {
    let result = trades || [];

    // Global account filter
    if (selectedAccountId !== "all") {
      result = result.filter(trade => trade.account_id === selectedAccountId);
    }

    // Model/Strategy filter (from URL) - now matches by playbook_id
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
  }, [trades, symbolFilter, sessionFilter, resultFilter, modelFilter, activeFilters, selectedAccountId]);

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
          {/* Ideas/All Toggle - only show for active tab and table view */}
          {activeTab === "active" && viewMode === "table" && (
            <ToggleGroup 
              type="single" 
              value={tradeViewMode} 
              onValueChange={(v) => v && setTradeViewMode(v as "ideas" | "all")}
              className="bg-muted/50 p-0.5 rounded-lg"
            >
              <ToggleGroupItem value="ideas" aria-label="Ideas view" className="px-3 gap-1.5 text-xs">
                <Layers className="w-3.5 h-3.5" />
                Ideas
              </ToggleGroupItem>
              <ToggleGroupItem value="all" aria-label="All trades view" className="px-3 gap-1.5 text-xs">
                <List className="w-3.5 h-3.5" />
                All
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          
          {/* Auto-group button - only show in ideas view */}
          {activeTab === "active" && viewMode === "table" && tradeViewMode === "ideas" && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => autoGroup.mutate(60)}
              disabled={autoGroup.isPending}
              className="gap-1.5 text-xs"
            >
              <Wand2 className="w-3.5 h-3.5" />
              {autoGroup.isPending ? "Grouping..." : "Auto-group"}
            </Button>
          )}
          
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
              
              {/* Advanced Filter Bar */}
              <FilterBar filters={activeFilters} onFiltersChange={setActiveFilters} />
            </div>
          )}

          {/* Content based on view mode */}
          {isLoading || isLoadingGroups ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : viewMode === "table" ? (
            filteredTrades.length === 0 && (tradeViewMode === "all" || !groupedData?.groups.length) ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No trades found</p>
                <p className="text-sm">Import trades or add them manually to get started</p>
              </div>
            ) : (
            <TradeTable 
              trades={tradeViewMode === "all" ? filteredTrades : groupedData?.ungrouped.filter(t => {
                // Apply same filters to ungrouped trades
                if (selectedAccountId !== "all" && t.account_id !== selectedAccountId) return false;
                if (modelFilter && t.playbook_id !== modelFilter && t.playbook?.name !== modelFilter) return false;
                if (symbolFilter && !t.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) return false;
                if (sessionFilter !== "all" && t.session !== sessionFilter) return false;
                if (resultFilter === "win" && (t.net_pnl || 0) <= 0) return false;
                if (resultFilter === "loss" && (t.net_pnl || 0) >= 0) return false;
                if (resultFilter === "open" && !t.is_open) return false;
                return true;
              }) || []}
              tradeGroups={tradeViewMode === "ideas" ? groupedData?.groups.filter(g => {
                // Apply filters to groups
                if (selectedAccountId !== "all" && !g.account_ids.includes(selectedAccountId)) return false;
                if (symbolFilter && !g.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) return false;
                if (resultFilter === "win" && g.combined_net_pnl <= 0) return false;
                if (resultFilter === "loss" && g.combined_net_pnl >= 0) return false;
                if (resultFilter === "open" && !g.is_open) return false;
                return true;
              }) : undefined}
              onTradeClick={(trade) => setSelectedTradeId(trade.id)}
              visibleColumns={settings?.visible_columns}
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
