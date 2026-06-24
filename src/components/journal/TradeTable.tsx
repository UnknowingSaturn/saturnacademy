import { useState, useMemo } from "react";
import { Trade, SessionType, EmotionalState, TimeframeAlignment, TradeProfile, Account } from "@/types/trading";
import { useUpdateTrade, useUpsertTradeReview, useBulkArchiveTrades } from "@/hooks/useTrades";
import { usePropertyOptions, useSessionLookup } from "@/hooks/useUserSettings";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { cn } from "@/lib/utils";
import { formatDateET, formatTimeET, getDayNameET } from "@/lib/time";
import { BadgeSelect } from "./BadgeSelect";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu";
import { BulkActionBar } from "./BulkActionBar";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronRight, Lightbulb, FileText, Clock, GripVertical, Wrench, RefreshCw } from "lucide-react";
import { DEFAULT_COLUMNS, ColumnDefinition, buildColumnRegistry } from "@/types/settings";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SortableHeaderProps {
  columnKey: string;
  className?: string;
  children: React.ReactNode;
}

function SortableHeader({ columnKey, className, children }: SortableHeaderProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: columnKey });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={cn("group/header flex items-center gap-1", className)}>
      <button
        type="button"
        className="opacity-0 group-hover/header:opacity-60 hover:!opacity-100 cursor-grab active:cursor-grabbing touch-none transition-opacity -ml-1"
        aria-label="Drag to reorder column"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { CustomFieldCell } from "./CustomFieldCell";
import { getRealPartialCloses } from "@/lib/tradeMath";
import { WORKED_WINDOW_BADGE_OPTIONS, FAILED_WINDOW_BADGE_OPTIONS, type HourLandscape } from "@/lib/hourSetup";

interface TradeTableProps {
  trades: Trade[];
  onTradeClick: (trade: Trade) => void;
  visibleColumns?: string[];
  columnOrder?: string[];
  deletedFields?: string[];
  onEditProperty?: (propertyName: string) => void;
  accounts?: Account[];
}

export function TradeTable({ trades, onTradeClick, visibleColumns, columnOrder, deletedFields, onEditProperty, accounts }: TradeTableProps) {
  const updateTrade = useUpdateTrade();
  const upsertReview = useUpsertTradeReview();
  const bulkArchive = useBulkArchiveTrades();
  const [editingPlace, setEditingPlace] = useState<string | null>(null);
  const [placeValue, setPlaceValue] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch property options (active only — soft-deleted ones don't appear in dropdowns)
  const { options: sessionOptions } = useSessionLookup();
  const { data: timeframeOptions = [] } = usePropertyOptions('timeframe', true);
  const { data: entryTimeframeOptions = [] } = usePropertyOptions('entry_timeframe', true);
  const { data: profileOptions = [] } = usePropertyOptions('profile', true);
  const { data: emotionOptions = [] } = usePropertyOptions('emotion', true);
  
  // Fetch playbooks for model options
  const { data: playbooks } = usePlaybooks();
  const { data: settings } = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  const { data: customFields = [] } = useCustomFieldDefinitions();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleColumnDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    // Build base order from persisted settings (fallback to current registry order)
    const base = (settings?.column_order && settings.column_order.length > 0)
      ? [...settings.column_order]
      : columnRegistry.map(c => c.key);
    // Ensure both keys exist in base (newly added custom fields may be missing)
    if (!base.includes(activeKey)) base.push(activeKey);
    if (!base.includes(overKey)) base.push(overKey);
    const from = base.indexOf(activeKey);
    const to = base.indexOf(overKey);
    if (from === -1 || to === -1) return;
    const newOrder = arrayMove(base, from, to);
    await updateSettings.mutateAsync({ column_order: newOrder });
  };

  const handleHideColumn = async (key: string) => {
    const current = settings?.visible_columns || [];
    if (!current.includes(key)) return;
    await updateSettings.mutateAsync({ visible_columns: current.filter(k => k !== key) });
  };

  // Merged registry: system columns + active custom field columns + user label/width overrides
  const columnRegistry = useMemo(
    () => buildColumnRegistry(customFields, settings?.column_overrides || {}),
    [customFields, settings?.column_overrides]
  );
  const getColumn = (key: string): ColumnDefinition | undefined =>
    columnRegistry.find((c) => c.key === key);
  
  // Generate dynamic model options from playbooks - use playbook ID as value
  const playbookModelOptions = useMemo(() => {
    if (!playbooks || playbooks.length === 0) return [];
    return playbooks.map((pb) => ({
      value: pb.id,
      label: pb.name,
      customColor: pb.color || undefined,
    }));
  }, [playbooks]);

  // Convert property options to BadgeSelect format — pass the user's hex through as
  // customColor so the table matches the color picker exactly (same as the detail panel).
  const formatOptions = (options: any[]) => options.map(o => ({
    value: o.value,
    label: o.label,
    customColor: o.color || undefined,
    color: 'primary',
  }));

  // Effective per-user column list:
  // 1. Start from the user's column_order (or default visible)
  // 2. Filter to currently visible
  // 3. Exclude per-user deleted system fields
  // 4. Only keep keys we actually know how to render (system + active custom)
  const activeColumns = useMemo(() => {
    const visibleSet = new Set(visibleColumns || DEFAULT_COLUMNS.filter(c =>
      ['trade_number', 'entry_time', 'day', 'symbol', 'session', 'model', 'alignment', 'entry_timeframes', 'profile', 'r_multiple_actual', 'result', 'emotional_state_before', 'place'].includes(c.key)
    ).map(c => c.key));
    const deletedSet = new Set(deletedFields || []);
    const knownSet = new Set(columnRegistry.map(c => c.key));
    const order = (columnOrder && columnOrder.length > 0)
      ? columnOrder
      : columnRegistry.map(c => c.key);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of order) {
      if (seen.has(k)) continue;
      if (!visibleSet.has(k)) continue;
      if (deletedSet.has(k)) continue;
      if (!knownSet.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    // Append any visible keys missing from order (newly created custom fields)
    for (const k of visibleSet) {
      if (!seen.has(k) && !deletedSet.has(k) && knownSet.has(k)) {
        out.push(k);
        seen.add(k);
      }
    }
    return out;
  }, [visibleColumns, columnOrder, deletedFields, columnRegistry]);

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
      setSortColumn(null);
    } else {
      setSortColumn(column);
      setSortDirection(direction);
    }
  };

  // Selection handlers
  const allSelected = trades.length > 0 && selectedIds.size === trades.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < trades.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(trades.map(t => t.id)));
    }
  };

  const toggleSelect = (tradeId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(tradeId)) {
      newSelected.delete(tradeId);
    } else {
      newSelected.add(tradeId);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkArchive = async () => {
    await bulkArchive.mutateAsync(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const handleSessionChange = async (trade: Trade, session: string) => {
    await updateTrade.mutateAsync({ id: trade.id, session: session as SessionType });
  };

  const handleModelChange = async (trade: Trade, playbookId: string) => {
    await updateTrade.mutateAsync({ id: trade.id, playbook_id: playbookId || null });
  };

  const handleActualModelChange = async (trade: Trade, playbookId: string) => {
    await updateTrade.mutateAsync({ id: trade.id, actual_playbook_id: playbookId || null });
  };

  const computeReadQuality = (trade: Trade): { label: string; tone: string } | null => {
    const fields: Array<[unknown, unknown]> = [
      [trade.playbook_id, trade.actual_playbook_id],
      [trade.profile, trade.actual_profile],
      [trade.review?.regime, trade.actual_regime],
    ];
    const graded = fields.filter(([p, a]) => p && a);
    if (graded.length === 0) return null;
    const matches = graded.filter(([p, a]) => p === a).length;
    if (matches === graded.length) return { label: "Match", tone: "profit" };
    if (matches === 0) return { label: "Mismatch", tone: "loss" };
    return { label: "Partial", tone: "breakeven" };
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

  const handleHourLandscapeChange = async (
    trade: Trade,
    field: 'ideal_entry_window' | 'failed_setup_half',
    value: string,
  ) => {
    await updateTrade.mutateAsync({ id: trade.id, [field]: (value || null) as HourLandscape | null });
  };

  const handlePlaceChange = async (trade: Trade) => {
    await updateTrade.mutateAsync({ id: trade.id, place: placeValue || null });
    setEditingPlace(null);
  };

  const handleEmotionChange = async (trade: Trade, emotion: string) => {
    await upsertReview.mutateAsync({
      review: {
        trade_id: trade.id,
        emotional_state_before: emotion as EmotionalState,
        // Preserve existing values
        ...(trade.review && {
          checklist_answers: trade.review.checklist_answers,
          regime: trade.review.regime,
          psychology_notes: trade.review.psychology_notes,
          screenshots: trade.review.screenshots,
        }),
      },
      silent: true,
    });
  };

  const isAwaitingRepair = (trade: Trade) => {
    // Fast path: new one-writer model sets this column directly. PnL stays null
    // until ingest-events or repair-snapshot-closed fills in the real values.
    if ((trade as any).awaiting_exit === true) return true;

    // Fallback: typed repair_events, then legacy partial_closes markers.
    const events = (trade as any).repair_events as Array<{ action: string }> | undefined;
    if (events && events.length > 0) {
      const hasSnapshotClosed = events.some((e) => e.action === "snapshot_closed");
      const wasRepaired = events.some((e) =>
        e.action === "repaired_from_snapshot" ||
        e.action === "repaired_reopened" ||
        e.action === "phase_a_one_shot"
      );
      if (!hasSnapshotClosed || wasRepaired) return false;
      return trade.net_pnl == null || trade.net_pnl === 0;
    }
    const pc = (trade as any).partial_closes;
    if (!Array.isArray(pc)) return false;
    const hasSnapshotClosed = pc.some((e: any) => e?.type === "snapshot_closed");
    const wasRepaired = pc.some((e: any) =>
      e?.type === "repaired_from_snapshot" ||
      e?.type === "repaired_reopened" ||
      e?.type === "phase_a_one_shot"
    );
    if (!hasSnapshotClosed || wasRepaired) return false;
    return trade.net_pnl == null || trade.net_pnl === 0;
  };

  const getSnapshotInfo = (trade: Trade) => {
    const events = (trade as any).repair_events as Array<{ action: string; metadata: any; applied_at: string }> | undefined;
    if (events && events.length > 0) {
      const marker = events.find((e) => e.action === "snapshot_closed");
      if (marker) return { type: "snapshot_closed", ...(marker.metadata || {}), at: marker.applied_at };
    }
    const pc = (trade as any).partial_closes;
    if (!Array.isArray(pc)) return null;
    const marker = pc.find((e: any) => e?.type === "snapshot_closed");
    return marker || null;
  };

  const [repairingId, setRepairingId] = useState<string | null>(null);
  const handleRepair = async (trade: Trade) => {
    try {
      setRepairingId(trade.id);
      const { data, error } = await supabase.functions.invoke("trade-repair", {
        body: { action: "repair", account_id: trade.account_id },
      });
      if (error) throw error;
      const result = data as any;
      if (result?.repaired > 0) {
        toast.success(result.message || "Trade repaired");
      } else if (result?.pending_mt5_reconnect > 0) {
        toast.info(result.message || "Awaiting MT5 reconnect to repair");
      } else {
        toast.info("Nothing to repair right now");
      }
    } catch (err) {
      console.error(err);
      toast.error("Repair failed — check edge function logs");
    } finally {
      setRepairingId(null);
    }
  };


  const getResultBadge = (trade: Trade) => {
    const pnl = trade.net_pnl || 0;
    const isNonExecuted = trade.trade_type && trade.trade_type !== 'executed';

    if (trade.is_open) return { label: "Open", color: "muted" };
    if (isAwaitingRepair(trade)) return { label: "Awaiting repair", color: "muted" };
    if (isNonExecuted) {
      // For non-executed trades, show hypothetical result
      if (pnl > 0) return { label: "Would Win", color: "profit" };
      if (pnl < 0) return { label: "Would Lose", color: "loss" };
      return { label: "Hypothetical", color: "muted" };
    }
    if (pnl > 0) return { label: "Win", color: "profit" };
    if (pnl < 0) return { label: "Loss", color: "loss" };
    return { label: "BE", color: "breakeven" };
  };


  const getTradeTypeIcon = (tradeType: string | undefined) => {
    switch (tradeType) {
      case 'idea':
        return { icon: <Lightbulb className="w-3.5 h-3.5" />, label: "Trade Idea", color: "text-amber-500" };
      case 'paper':
        return { icon: <FileText className="w-3.5 h-3.5" />, label: "Paper Trade", color: "text-blue-500" };
      case 'missed':
        return { icon: <Clock className="w-3.5 h-3.5" />, label: "Missed Setup", color: "text-orange-500" };
      default:
        return null;
    }
  };

  // Build grid template columns: checkbox + visible columns + expand arrow
  const gridCols = '40px ' + activeColumns.map(key => {
    const col = getColumn(key);
    return col?.width || 'minmax(80px, 1fr)';
  }).join(' ') + ' 40px';

  return (
    <div className="border border-border rounded-lg overflow-x-auto overflow-y-visible">
      <div className="w-full">
        {/* Header */}
        <div 
          className="grid gap-2 px-4 py-3 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider"
          style={{ gridTemplateColumns: gridCols }}
        >
          {/* Checkbox column header */}
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleSelectAll}
              className={cn(someSelected && "data-[state=checked]:bg-primary/50")}
              aria-label="Select all trades"
            />
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleColumnDragEnd}
          >
            <SortableContext items={activeColumns} strategy={horizontalListSortingStrategy}>
              {activeColumns.map(key => {
                const column = getColumn(key);
                if (!column) return null;

                return (
                  <SortableHeader
                    key={key}
                    columnKey={key}
                    className={cn(key === 'r_multiple_actual' && 'justify-end text-right', key === 'result' && 'justify-center text-center')}
                  >
                    <ColumnHeaderMenu
                      column={column}
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      onFilter={() => {}}
                      onHide={() => handleHideColumn(key)}
                      onEditProperty={onEditProperty}
                    >
                      {column.label}
                    </ColumnHeaderMenu>
                  </SortableHeader>
                );
              })}
            </SortableContext>
          </DndContext>
          <div></div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border">
          {/* Render individual trades */}
          {sortedTrades.map((trade) => {
            const result = getResultBadge(trade);
            const day = getDayNameET(trade.entry_time);
            const isSelected = selectedIds.has(trade.id);
            const tradeTypeInfo = getTradeTypeIcon(trade.trade_type);
            const isNonExecuted = trade.trade_type && trade.trade_type !== 'executed';

            return (
              <div
                key={trade.id}
                className={cn(
                  "grid gap-2 px-4 py-2 items-center",
                  "hover:bg-accent/30 transition-colors group cursor-pointer",
                  !isNonExecuted && trade.net_pnl && trade.net_pnl > 0 && "border-l-2 border-l-profit",
                  !isNonExecuted && trade.net_pnl && trade.net_pnl < 0 && "border-l-2 border-l-loss",
                  isNonExecuted && "border-l-2 border-l-amber-500/50 bg-amber-500/5",
                  isSelected && "bg-accent/50"
                )}
                style={{ gridTemplateColumns: gridCols }}
                onClick={() => onTradeClick(trade)}
              >
                {/* Checkbox cell */}
                <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelect(trade.id)}
                    aria-label={`Select trade ${trade.trade_number || trade.id}`}
                  />
                </div>

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

                  if (key === 'account') {
                    const account = accounts?.find(a => a.id === trade.account_id);
                    const pending = trade.is_open && account?.live_state === 'dormant';
                    return (
                      <div key={key} className="text-sm text-muted-foreground truncate flex items-center gap-1.5">
                        <span className="truncate">{account?.name || "—"}</span>
                        {pending && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap">
                                  ⏸ Pending verification
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="text-xs">
                                  No EA heartbeat for this account. Log into{' '}
                                  <strong>{account?.name}</strong> in MT5 to confirm or close this position.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    );
                  }

                  if (key === 'symbol') {
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className={cn("font-semibold text-sm", isNonExecuted && "italic text-muted-foreground")}>{trade.symbol}</span>
                        {tradeTypeInfo && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={tradeTypeInfo.color}>{tradeTypeInfo.icon}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{tradeTypeInfo.label}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    );
                  }

                  if (key === 'session') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.session || ""}
                          onChange={(v) => handleSessionChange(trade, v as string)}
                          options={sessionOptions}
                          placeholder={sessionOptions.length === 0 ? "Add sessions in Settings" : "Session"}
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
                          placeholder="Planned"
                        />
                      </div>
                    );
                  }

                  if (key === 'actual_model') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.actual_playbook_id || ""}
                          onChange={(v) => handleActualModelChange(trade, v as string)}
                          options={playbookModelOptions.length > 0 ? playbookModelOptions : [
                            { value: "", label: "No playbooks", color: "muted" },
                          ]}
                          placeholder="Hindsight"
                        />
                      </div>
                    );
                  }

                  if (key === 'read_quality') {
                    const rq = computeReadQuality(trade);
                    if (!rq) {
                      return <div key={key} className="text-xs text-muted-foreground text-center">—</div>;
                    }
                    return (
                      <div key={key} className="flex justify-center">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-xs font-medium",
                          rq.tone === 'profit' && "bg-profit/20 text-profit",
                          rq.tone === 'loss' && "bg-loss/20 text-loss",
                          rq.tone === 'breakeven' && "bg-breakeven/20 text-breakeven",
                        )}>
                          {rq.label}
                        </span>
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
                          placeholder="Entry TF"
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
                          options={formatOptions(entryTimeframeOptions).length > 0 ? formatOptions(entryTimeframeOptions) : [
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

                  if (key === 'profile') {
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={trade.profile || ""}
                          onChange={(v) => handleProfileChange(trade, v as string)}
                          options={formatOptions(profileOptions).length > 0 ? formatOptions(profileOptions) : [
                            { value: "consolidation", label: "Consolidation", color: "muted" },
                            { value: "expansion", label: "Expansion", color: "profit" },
                            { value: "reversal", label: "Reversal", color: "loss" },
                            { value: "continuation", label: "Continuation", color: "primary" },
                          ]}
                          placeholder="Profile"
                        />
                      </div>
                    );
                  }

                  if (key === 'ideal_entry_window' || key === 'failed_setup_half') {
                    const current = (trade as any)[key] as string | null | undefined;
                    const options = key === 'ideal_entry_window' ? WORKED_WINDOW_BADGE_OPTIONS : FAILED_WINDOW_BADGE_OPTIONS;
                    return (
                      <div key={key} onClick={(e) => e.stopPropagation()}>
                        <BadgeSelect
                          value={current || ""}
                          onChange={(v) => handleHourLandscapeChange(trade, key, v as string)}
                          options={options}
                          placeholder={key === 'ideal_entry_window' ? 'Ideal' : 'Failed'}
                        />
                      </div>
                    );
                  }


                  if (key === 'r_multiple_actual') {
                    const r = trade.r_multiple_actual;
                    return (
                      <div key={key} className={cn(
                        "text-sm font-mono-numbers text-right",
                        r && r > 0 && "text-profit",
                        r && r < 0 && "text-loss"
                      )}>
                        {r !== null ? `${r >= 0 ? '+' : ''}${r.toFixed(2)}R` : '—'}
                      </div>
                    );
                  }

                  if (key === 'net_pnl') {
                    const pnl = trade.net_pnl;
                    return (
                      <div key={key} className={cn(
                        "text-sm font-mono-numbers text-right",
                        pnl && pnl > 0 && "text-profit",
                        pnl && pnl < 0 && "text-loss"
                      )}>
                        {pnl !== null ? `$${pnl.toFixed(2)}` : '—'}
                      </div>
                    );
                  }

                  if (key === 'result') {
                    const partialCount = getRealPartialCloses(trade).length;
                    const awaiting = isAwaitingRepair(trade);
                    const snapInfo = awaiting ? getSnapshotInfo(trade) : null;
                    const badge = (
                      <span className={cn(
                        "px-2 py-0.5 rounded text-xs font-medium",
                        result.color === 'profit' && "bg-profit/20 text-profit",
                        result.color === 'loss' && "bg-loss/20 text-loss",
                        result.color === 'breakeven' && "bg-breakeven/20 text-breakeven",
                        result.color === 'muted' && "bg-muted text-muted-foreground",
                        awaiting && "cursor-pointer hover:bg-amber-500/20 hover:text-amber-700 dark:hover:text-amber-400"
                      )}>
                        {result.label}
                      </span>
                    );
                    return (
                      <div key={key} className="flex justify-center items-center gap-1" onClick={(e) => awaiting && e.stopPropagation()}>
                        {awaiting ? (
                          <Popover>
                            <PopoverTrigger asChild>{badge}</PopoverTrigger>
                            <PopoverContent align="center" className="w-80 text-sm space-y-3">
                              <div>
                                <div className="font-medium mb-1">Awaiting repair</div>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  This trade was zeroed out by a position snapshot from another MT5 login on the same install
                                  {snapInfo?.account_login ? <> (login <span className="font-mono">{snapInfo.account_login}</span>)</> : null}
                                  . The real close hasn't been streamed yet.
                                </p>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Clicking <strong>Try repair now</strong> searches MT5 deal history across sibling logins on the same install. If the close still isn't there, log MT5 back into the original broker account — the EA will heal it automatically on reconnect.
                              </div>
                              <Button
                                size="sm"
                                className="w-full"
                                onClick={() => handleRepair(trade)}
                                disabled={repairingId === trade.id}
                              >
                                {repairingId === trade.id ? (
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                                ) : (
                                  <Wrench className="h-3.5 w-3.5 mr-1.5" />
                                )}
                                Try repair now
                              </Button>
                            </PopoverContent>
                          </Popover>
                        ) : badge}
                        {partialCount > 0 && (
                          <span
                            className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground border border-border/50"
                            title={`${partialCount + 1} partial closes`}
                          >
                            {partialCount + 1}×
                          </span>
                        )}
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
                            { value: "calm", label: "Calm", color: "primary" },
                            { value: "focused", label: "Focused", color: "primary" },
                            { value: "okay", label: "Okay", color: "muted" },
                            { value: "anxious", label: "Anxious", color: "loss" },
                            { value: "fomo", label: "FOMO", color: "loss" },
                            { value: "revenge", label: "Revenge", color: "loss" },
                          ]}
                          placeholder="Emotion"
                        />
                      </div>
                    );
                  }

                  if (key === 'place') {
                    if (editingPlace === trade.id) {
                      return (
                        <div key={key} onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={placeValue}
                            onChange={(e) => setPlaceValue(e.target.value)}
                            onBlur={() => handlePlaceChange(trade)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handlePlaceChange(trade);
                              if (e.key === 'Escape') setEditingPlace(null);
                            }}
                            className="h-7 text-xs"
                            autoFocus
                          />
                        </div>
                      );
                    }
                    return (
                      <div 
                        key={key} 
                        className="text-sm text-muted-foreground truncate cursor-pointer hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPlace(trade.id);
                          setPlaceValue(trade.place || "");
                        }}
                      >
                        {trade.place || "—"}
                      </div>
                    );
                  }

                  if (key === 'direction') {
                    return (
                      <div key={key} className={cn(
                        "text-xs font-medium uppercase",
                        trade.direction === 'buy' && "text-profit",
                        trade.direction === 'sell' && "text-loss"
                      )}>
                        {trade.direction}
                      </div>
                    );
                  }

                  if (key === 'status') {
                    const isOpen = trade.is_open;
                    const pnl = trade.net_pnl ?? 0;
                    const win = !isOpen && pnl > 0;
                    const loss = !isOpen && pnl < 0;
                    const label = isOpen ? 'OPEN' : win ? 'WIN' : loss ? 'LOSS' : 'BE';
                    const advisory = trade.repair_state === 'advisory_closed';
                    return (
                      <div key={key} className="flex justify-center items-center gap-1">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-xs font-medium",
                          isOpen && "bg-muted text-muted-foreground border border-border",
                          win && "bg-profit/20 text-profit",
                          loss && "bg-loss/20 text-loss",
                          !isOpen && !win && !loss && "bg-breakeven/20 text-breakeven",
                        )}>
                          {label}
                        </span>
                        {advisory && (
                          <span
                            title="Advisory close — inferred from snapshot, not from a real close event"
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 border border-amber-500/30"
                          >
                            ADV
                          </span>
                        )}
                      </div>
                    );
                  }

                  if (key === 'closes') {
                    const partials = getRealPartialCloses(trade).length;
                    const total = trade.is_open ? partials : partials + 1;
                    return (
                      <div key={key} className="text-sm text-muted-foreground text-center font-mono-numbers">
                        {total > 0 ? `${total}×` : '—'}
                      </div>
                    );
                  }

                  if (key === 'duration_seconds') {
                    const duration = trade.duration_seconds;
                    if (!duration) return <div key={key} className="text-sm text-muted-foreground">—</div>;
                    const hours = Math.floor(duration / 3600);
                    const minutes = Math.floor((duration % 3600) / 60);
                    return (
                      <div key={key} className="text-sm text-muted-foreground">
                        {hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`}
                      </div>
                    );
                  }

                  // User-defined custom field columns
                  if (key.startsWith('cf_')) {
                    const def = customFields.find((f) => f.key === key);
                    if (!def) return <div key={key} className="text-sm text-muted-foreground">—</div>;
                    return (
                      <div key={key}>
                        <CustomFieldCell trade={trade} field={def} />
                      </div>
                    );
                  }

                  // Default: show raw value
                  const value = (trade as any)[key];
                  return (
                    <div key={key} className="text-sm text-muted-foreground truncate">
                      {value !== null && value !== undefined ? String(value) : "—"}
                    </div>
                  );
                })}

                {/* Expand arrow */}
                <div className="flex justify-center">
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        onAction={handleBulkArchive}
        onClear={() => setSelectedIds(new Set())}
      />
    </div>
  );
}