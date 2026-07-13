import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTrades } from "@/hooks/useTrades";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAccountFilter } from "@/contexts/AccountFilterContext";
import { useSymbolAliases } from "@/hooks/useSymbolAliases";
import { buildSymbolResolver } from "@/lib/symbolAliasing";
import { ensureUtcMs } from "../../shared/quant/stats";
import { useGroupedTrades } from "@/hooks/useGroupedTrades";

import { TradeTable } from "@/components/journal/TradeTable";
import { DriftTray } from "@/components/journal/DriftTray";

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
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { PageIntroBanner } from "@/components/tutorial/PageIntroBanner";

type PeriodType = "week" | "month" | "custom";
type ResultFilter = "all" | "win" | "loss" | "open";
type TradeTypeFilter = "all" | "executed" | "ideas";

// J4: URL keys. Keeping them terse so shared links stay short.
const URL_KEYS = {
  symbol: "sym",
  session: "sess",
  result: "res",
  type: "type",
  period: "period",
  date: "date",
  from: "from",
  to: "to",
  view: "view",
  tab: "atab",
  model: "model",
} as const;

const isPeriodType = (v: string | null): v is PeriodType =>
  v === "week" || v === "month" || v === "custom";
const isResult = (v: string | null): v is ResultFilter =>
  v === "win" || v === "loss" || v === "open" || v === "all";
const isType = (v: string | null): v is TradeTypeFilter =>
  v === "executed" || v === "ideas" || v === "all";

export default function Journal() {
  const [searchParams, setSearchParams] = useSearchParams();

  // J4 fix: promote filter state into the URL so Journal deep-links,
  // shareable views, and back-button behaviour match Pair Lab.
  const patchParams = useCallback(
    (mut: (next: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mut(next);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setParam = useCallback(
    (key: string, value: string | null | undefined) => {
      patchParams((p) => {
        if (value == null || value === "") p.delete(key);
        else p.set(key, value);
      });
    },
    [patchParams],
  );

  // URL-derived filter values. Defaults chosen so an unadorned /journal URL
  // still behaves the way returning users expect.
  const symbolFilter = searchParams.get(URL_KEYS.symbol) ?? "";
  const setSymbolFilter = useCallback((v: string) => setParam(URL_KEYS.symbol, v || null), [setParam]);

  const sessionParam = searchParams.get(URL_KEYS.session);
  const sessionFilter: SessionType | "all" = (sessionParam as SessionType | null) ?? "all";
  const setSessionFilter = useCallback(
    (v: SessionType | "all") => setParam(URL_KEYS.session, v === "all" ? null : v),
    [setParam],
  );

  const resultParam = searchParams.get(URL_KEYS.result);
  const resultFilter: ResultFilter = isResult(resultParam) ? resultParam : "all";
  const setResultFilter = useCallback(
    (v: ResultFilter) => setParam(URL_KEYS.result, v === "all" ? null : v),
    [setParam],
  );

  const typeParam = searchParams.get(URL_KEYS.type);
  const tradeTypeFilter: TradeTypeFilter = isType(typeParam) ? typeParam : "all";
  const setTradeTypeFilter = useCallback(
    (v: TradeTypeFilter) => setParam(URL_KEYS.type, v === "all" ? null : v),
    [setParam],
  );

  // J2: default period is now "all" to match Pair Lab. Users can still narrow
  // via the ToggleGroup; the choice persists in the URL as ?period=…
  const periodParam = searchParams.get(URL_KEYS.period);
  const periodType: PeriodType | "all" = periodParam === "week" || periodParam === "month" || periodParam === "custom" ? periodParam : "all";
  const setPeriodType = useCallback(
    (v: PeriodType | "all") => setParam(URL_KEYS.period, v === "all" ? null : v),
    [setParam],
  );

  const dateParam = searchParams.get(URL_KEYS.date);
  const currentDate = useMemo(() => {
    if (!dateParam) return new Date();
    const ms = ensureUtcMs(dateParam);
    return Number.isFinite(ms) ? new Date(ms) : new Date();
  }, [dateParam]);
  const setCurrentDate = useCallback(
    (d: Date | ((prev: Date) => Date)) => {
      const next = typeof d === "function" ? d(currentDate) : d;
      // Format via UTC parts so the URL string round-trips through ensureUtcMs
      // without a local-tz off-by-one for users west of UTC.
      const yyyy = next.getUTCFullYear();
      const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(next.getUTCDate()).padStart(2, "0");
      setParam(URL_KEYS.date, `${yyyy}-${mm}-${dd}`);
    },
    [setParam, currentDate],
  );

  const fromParam = searchParams.get(URL_KEYS.from);
  const toParam = searchParams.get(URL_KEYS.to);
  const customFrom = useMemo(() => {
    if (!fromParam) return undefined;
    const ms = ensureUtcMs(fromParam);
    return Number.isFinite(ms) ? new Date(ms) : undefined;
  }, [fromParam]);
  const customTo = useMemo(() => {
    if (!toParam) return undefined;
    const ms = ensureUtcMs(toParam);
    return Number.isFinite(ms) ? new Date(ms) : undefined;
  }, [toParam]);
  const setCustomFrom = useCallback(
    (d: Date | undefined) => setParam(URL_KEYS.from, d ? format(d, "yyyy-MM-dd") : null),
    [setParam],
  );
  const setCustomTo = useCallback(
    (d: Date | undefined) => setParam(URL_KEYS.to, d ? format(d, "yyyy-MM-dd") : null),
    [setParam],
  );

  const viewParam = searchParams.get(URL_KEYS.view);
  const viewMode: "table" | "calendar" = viewParam === "calendar" ? "calendar" : "table";
  const setViewMode = useCallback(
    (v: "table" | "calendar") => setParam(URL_KEYS.view, v === "table" ? null : v),
    [setParam],
  );

  const tabParam = searchParams.get(URL_KEYS.tab);
  const activeTab: "active" | "archived" = tabParam === "archived" ? "archived" : "active";
  const setActiveTab = useCallback(
    (v: "active" | "archived") => setParam(URL_KEYS.tab, v === "active" ? null : v),
    [setParam],
  );

  // Non-persisted (transient) state. `selectedTradeId` intentionally stays
  // local so opening a trade detail doesn't rewrite history.
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("sessions");
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>([]);

  const { selectedAccountId, accounts } = useAccountFilter();
  // L1 fix: push the account filter into Supabase instead of fetching every
  // trade and trimming client-side. Mirrors Pair Lab; orphan rows
  // (account_id IS NULL) stay included by default to preserve historical
  // Journal behaviour.
  const { data: rawTrades, isLoading } = useTrades(
    selectedAccountId && selectedAccountId !== "all"
      ? { accountId: selectedAccountId, includeUnassigned: true }
      : undefined,
  );
  // Multi-TP grouping — collapses sibling broker positions opened by a
  // position sizer into one logical trade row (see useGroupedTrades). Legs
  // remain on `.legs` for the detail panel. Toggle via localStorage; default
  // ON because grouping matches how users think about the trade.
  const groupingEnabled = typeof window === "undefined"
    ? true
    : window.localStorage.getItem("journal:group_multi_tp") !== "false";
  const groupedTrades = useGroupedTrades(rawTrades);
  const trades = groupingEnabled ? groupedTrades : rawTrades;
  const { data: settings } = useUserSettings();
  const { data: aliases } = useSymbolAliases();

  // Phase H/11: canonicalize broker symbol variants before filtering/grouping
  // so "EURUSD" matches "EURUSD+", "EURUSD.r", and any saved alias. Match
  // both the raw and resolved spellings so users can still type the broker
  // name verbatim.
  const symbolResolver = useMemo(
    () => buildSymbolResolver(aliases ?? []),
    [aliases],
  );

  // U6 fix: sync modelFilter with URL param in BOTH directions. Previously
  // only set — never cleared — so manually deleting `?model=` from the URL
  // left the badge visible.
  useEffect(() => {
    const modelParam = searchParams.get('model');
    setModelFilter(modelParam || null);
  }, [searchParams]);

  // U5 fix: functional setSearchParams form so a concurrent tick can't lose
  // params written between our read and our write. Also constructs a fresh
  // URLSearchParams instead of mutating the closure snapshot.
  const clearModelFilter = () => {
    setModelFilter(null);
    setParam('model', null);
  };

  // Period calculations. `all` skips the date gate entirely.
  // B2 fix: compute boundaries in UTC so filtering matches the trade frame
  // (ensureUtcMs on entry_time). date-fns startOfWeek/Month anchor to the
  // host local tz — a 00:05 UTC trade would fall outside a local-tz week
  // for anyone west of UTC.
  const periodRange = useMemo(() => {
    const y = currentDate.getUTCFullYear();
    const m = currentDate.getUTCMonth();
    const d = currentDate.getUTCDate();
    if (periodType === "week") {
      const dow = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0=Sun..6=Sat
      const daysFromMon = (dow + 6) % 7;
      const startMs = Date.UTC(y, m, d - daysFromMon);
      const endMs = startMs + 7 * 86_400_000 - 1;
      return { start: new Date(startMs), end: new Date(endMs) };
    } else if (periodType === "month") {
      const startMs = Date.UTC(y, m, 1);
      const endMs = Date.UTC(y, m + 1, 1) - 1;
      return { start: new Date(startMs), end: new Date(endMs) };
    } else if (periodType === "custom" && customFrom && customTo) {
      const s = Date.UTC(customFrom.getUTCFullYear(), customFrom.getUTCMonth(), customFrom.getUTCDate());
      const e = Date.UTC(customTo.getUTCFullYear(), customTo.getUTCMonth(), customTo.getUTCDate()) + 86_400_000 - 1;
      return { start: new Date(s), end: new Date(e) };
    }
    return null;
  }, [periodType, currentDate, customFrom, customTo]);

  const periodLabel = useMemo(() => {
    if (periodType === "all") return "All time";
    if (periodType === "week" && periodRange) {
      return `${format(periodRange.start, "MMM d")} – ${format(periodRange.end, "MMM d, yyyy")}`;
    } else if (periodType === "month") {
      return format(currentDate, "MMMM yyyy");
    } else if (customFrom && customTo) {
      return `${format(customFrom, "MMM d")} – ${format(customTo, "MMM d, yyyy")}`;
    }
    return format(currentDate, "MMMM yyyy");
  }, [periodType, currentDate, periodRange, customFrom, customTo]);

  const navigatePeriod = (direction: -1 | 1) => {
    // B8 fix: `addWeeks` / `addMonths` walk in *local* tz, so on DST boundaries
    // the display label drifts a day from the UTC filter window (which was
    // moved to `Date.UTC` in B2). Derive the next anchor from UTC parts too.
    setCurrentDate(prev => {
      const y = prev.getUTCFullYear();
      const m = prev.getUTCMonth();
      const d = prev.getUTCDate();
      if (periodType === "week") {
        return new Date(Date.UTC(y, m, d + 7 * direction));
      }
      if (periodType === "month") {
        return new Date(Date.UTC(y, m + direction, d));
      }
      return prev;
    });
  };

  // Apply all filters
  const filteredTrades = useMemo(() => {
    let result = trades || [];

    // J1 fix: use ensureUtcMs (matches Pair Lab). parseISO from date-fns
    // treats naive timestamps as *local* time, while Pair Lab treats them
    // as UTC — same trade could land in different calendar days across the
    // two views for a non-UTC trader with CSV-imported rows.
    // Period filter — filter by entry_time. `periodRange == null` (period
    // = "all") skips the gate entirely.
    if (periodRange) {
      const startMs = periodRange.start.getTime();
      const endMs = periodRange.end.getTime();
      result = result.filter(trade => {
        const ms = ensureUtcMs(trade.entry_time);
        return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
      });
    }

    // L1 fix: account scoping is now pushed into the SQL query above; no
    // client-side re-filter needed. Earlier this branch also forced orphans
    // (account_id IS NULL) to be visible whenever an account was selected,
    // which `includeUnassigned: true` in useTrades preserves at the source.

    // Model/Strategy filter (from URL)
    if (modelFilter) {
      result = result.filter(trade => trade.playbook_id === modelFilter || trade.playbook?.name === modelFilter);
    }

    // Symbol filter (canonicalized: matches raw broker symbol OR the
    // alias-resolved canonical, so "EURUSD" finds EURUSD+/EURUSD.r too).
    if (symbolFilter) {
      const needle = symbolFilter.toLowerCase();
      const needleCanonical = symbolResolver(symbolFilter).toLowerCase();
      result = result.filter(trade => {
        const raw = (trade.symbol || "").toLowerCase();
        const canonical = symbolResolver(trade.symbol || "").toLowerCase();
        return raw.includes(needle) || canonical.includes(needleCanonical);
      });
    }

    // Session filter
    if (sessionFilter !== "all") {
      result = result.filter(trade => trade.session === sessionFilter);
    }

    // Result filter — interpreted at leg granularity for grouped rows so a
    // mixed group (e.g. TP1 win + SL loss) shows up under both "Wins" and
    // "Losses" instead of vanishing. Singleton rows still work because their
    // legs_* counters are populated by `passthrough()`.
    if (resultFilter === "win") {
      result = result.filter(trade => ((trade as any).legs_win ?? 0) > 0 && trade.trade_type === 'executed');
    } else if (resultFilter === "loss") {
      result = result.filter(trade => ((trade as any).legs_loss ?? 0) > 0 && trade.trade_type === 'executed');
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
    // U7 fix: removed `selectedAccountId` — account filtering happens in SQL
    // (see useTrades above). Keeping it here forced a full re-filter on any
    // account switch even though `trades` already changes.
  }, [trades, symbolFilter, sessionFilter, resultFilter, tradeTypeFilter, modelFilter, activeFilters, periodRange, symbolResolver]);

  // J3: open/closed breakdown for the header chip so the divergence from
  // Pair Lab's "closed trades in scope" count is explicit rather than
  // confusing.
  const openCount = useMemo(
    () => filteredTrades.filter(t => t.is_open).length,
    [filteredTrades],
  );
  const closedCount = filteredTrades.length - openCount;


  const getTradeValue = (trade: Trade, column: string): any => {
    switch (column) {
      case 'trade_number': return trade.trade_number;
      case 'symbol': return symbolResolver(trade.symbol || "");
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
        return (trade as unknown as Record<string, unknown>)[column];
    }
  };

  const handleEditProperty = (propertyName: string) => {
    setSettingsTab("properties");
    setSettingsOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <DriftTray />
      <PageIntroBanner
        routeKey="journal"
        title="Trade journal — shows all trades by default"
        body="Mix executed trades with hypothetical ideas, attach up to 5 labelled screenshots per trade, and use the Settings cog to tweak sessions and custom properties. Stuck on an open trade that's actually closed? Open it and use Dismiss as closed."
      />
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
        <ToggleGroup type="single" value={periodType} onValueChange={(v) => v && setPeriodType(v as PeriodType | "all")}>
          <ToggleGroupItem value="all" className="px-3 text-xs">All</ToggleGroupItem>
          <ToggleGroupItem value="week" className="px-3 text-xs">Week</ToggleGroupItem>
          <ToggleGroupItem value="month" className="px-3 text-xs">Month</ToggleGroupItem>
          <ToggleGroupItem value="custom" className="px-3 text-xs">Custom</ToggleGroupItem>
        </ToggleGroup>

        {periodType === "week" || periodType === "month" ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigatePeriod(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[160px] text-center">{periodLabel}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigatePeriod(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : periodType === "custom" ? (
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
        ) : (
          <span className="text-sm font-medium text-muted-foreground">{periodLabel}</span>
        )}

        {/* J3: Open · Closed breakdown so this matches Pair Lab's "closed
             trades in scope" chip semantics rather than appearing to disagree. */}
        <Badge variant="secondary" className="text-xs font-mono-numbers">
          {closedCount} closed{openCount > 0 ? ` · ${openCount} open` : ""}
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
            <>
              <TradeTable 
                trades={filteredTrades}
                onTradeClick={(trade) => setSelectedTradeId(trade.id)}
                visibleColumns={settings?.visible_columns}
                columnOrder={settings?.column_order}
                deletedFields={settings?.deleted_system_fields}
                onEditProperty={handleEditProperty}
                accounts={accounts}
              />
            </>
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
