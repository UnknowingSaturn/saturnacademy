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
import { ChevronRight, Lightbulb, FileText, Clock, GripVertical, Wrench, RefreshCw, ChevronDown, Layers } from "lucide-react";
import { DEFAULT_COLUMNS, ColumnDefinition } from "@/types/settings";
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
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import { CustomFieldCell } from "./CustomFieldCell";
import { getRealPartialCloses } from "@/lib/tradeMath";
import { useTradeGroup } from "@/hooks/useTradeGroup";
import { FieldCell } from "@/lib/journalFields/FieldCell";
import { buildFieldRegistry, getFieldDef, FieldDef } from "@/lib/journalFields/registry";


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



interface TradeTableProps {
  trades: Trade[];
  onTradeClick: (trade: Trade) => void;
  visibleColumns?: string[];
  columnOrder?: string[];
  deletedFields?: string[];
  onEditProperty?: (propertyName: string) => void;
  accounts?: Account[];
}

function toColumnDefinition(
  field: FieldDef | undefined,
  key: string,
  override?: { label?: string; width?: string }
): ColumnDefinition {
  if (!field) {
    return {
      key,
      label: override?.label || key,
      type: 'text',
      sortable: true,
      filterable: true,
      hideable: true,
      width: override?.width || 'minmax(80px, 1fr)',
      category: 'calculated',
    };
  }

  const type: ColumnDefinition['type'] =
    field.valueType === 'select' ? 'select' :
    field.valueType === 'multi_select' ? 'multi-select' :
    field.valueType === 'number' || field.valueType === 'money' || field.valueType === 'percent' ? 'number' :
    field.valueType === 'date' ? 'date' :
    field.valueType === 'badge' ? 'badge' : 'text';

  return {
    key,
    label: override?.label || field.label,
    type,
    sortable: true,
    filterable: true,
    hideable: field.group !== 'core',
    width: override?.width || field.width || 'minmax(80px, 1fr)',
    propertyName: field.optionsProperty,
    category: field.source.kind === 'computed' || field.valueType === 'readonly' || field.valueType === 'date' ? 'calculated' : 'editable',
  };
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
  // Multi-TP group expand state — inline reveal per group id.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

  const fieldRegistry = useMemo(
    () => buildFieldRegistry(customFields, accounts),
    [customFields, accounts]
  );
  const getField = (key: string) => fieldRegistry.find((f) => f.key === key);
  const getColumn = (key: string): ColumnDefinition => {
    const field = getField(key);
    return toColumnDefinition(field, key, settings?.column_overrides?.[key]);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));


  const handleColumnDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    // Prefer new Notion-style layout; fall back to legacy column_order props
    const layout = settings?.journal_field_layout;
    const base: string[] = layout?.table?.order?.length
      ? [...layout.table.order]
      : (columnOrder && columnOrder.length > 0)
        ? [...columnOrder]
        : fieldRegistry.map(f => f.key);
    if (!base.includes(activeKey)) base.push(activeKey);
    if (!base.includes(overKey)) base.push(overKey);
    const from = base.indexOf(activeKey);
    const to = base.indexOf(overKey);
    if (from === -1 || to === -1) return;
    const newOrder = arrayMove(base, from, to) as string[];
    if (layout) {
      await updateSettings.mutateAsync({
        journal_field_layout: {
          ...layout,
          table: { ...layout.table, order: newOrder },
        },
      });
    } else {
      await updateSettings.mutateAsync({ column_order: newOrder });
    }
  };

  const handleHideColumn = async (key: string) => {
    const layout = settings?.journal_field_layout;
    if (layout) {
      const hidden = new Set(layout.table?.hidden || []);
      hidden.add(key);
      await updateSettings.mutateAsync({
        journal_field_layout: {
          ...layout,
          table: { ...layout.table, hidden: Array.from(hidden) },
        },
      });
      return;
    }
    const current = settings?.visible_columns || [];
    if (!current.includes(key)) return;
    await updateSettings.mutateAsync({ visible_columns: current.filter(k => k !== key) });
  };

  // Effective per-user column list: Notion-style layout wins, then legacy props
  const activeColumns = useMemo(() => {
    const layout = settings?.journal_field_layout;
    const hiddenSet = new Set(layout?.table?.hidden || deletedFields || []);
    const knownSet = new Set(fieldRegistry.map(f => f.key));
    const defaultVisible = DEFAULT_COLUMNS.filter(c =>
      ['trade_number', 'entry_time', 'day', 'symbol', 'session', 'model', 'alignment', 'entry_timeframes', 'profile', 'r_multiple_actual', 'result', 'emotional_state_before', 'place'].includes(c.key)
    ).map(c => c.key);
    const visibleSet = new Set(visibleColumns || defaultVisible);
    const order = layout?.table?.order?.length
      ? layout.table.order
      : (columnOrder && columnOrder.length > 0)
        ? columnOrder
        : fieldRegistry.map(f => f.key);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of order) {
      if (seen.has(k)) continue;
      if (hiddenSet.has(k)) continue;
      if (!knownSet.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    // Append any visible keys missing from order (newly created custom fields)
    for (const k of visibleSet) {
      if (!seen.has(k) && !hiddenSet.has(k) && knownSet.has(k)) {
        out.push(k);
        seen.add(k);
      }
    }
    return out;
  }, [visibleColumns, columnOrder, deletedFields, fieldRegistry, settings?.journal_field_layout]);


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
    const g = trade as any;

    if (trade.is_open) return { label: "Open", color: "muted" };
    if (isAwaitingRepair(trade)) return { label: "Awaiting repair", color: "muted" };
    if (isNonExecuted) {
      if (pnl > 0) return { label: "Would Win", color: "profit" };
      if (pnl < 0) return { label: "Would Lose", color: "loss" };
      return { label: "Hypothetical", color: "muted" };
    }
    // Mixed multi-TP group — show W/L split AND the net $ so the row is
    // self-contained: user sees both outcomes and the cumulative result.
    if (g.outcome_mix === "mixed") {
      const parts = [`${g.legs_win}W`, `${g.legs_loss}L`];
      if (g.legs_be > 0) parts.push(`${g.legs_be}BE`);
      const money = `${pnl >= 0 ? "+" : "\u2212"}$${Math.abs(pnl).toFixed(2)}`;
      const tone = pnl > 0 ? "profit" : pnl < 0 ? "loss" : "breakeven";
      return { label: `${parts.join(" / ")} \u00b7 ${money}`, color: tone };
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
            const g = trade as any;
            const isGroup = g.isGrouped === true;
            const legs: Trade[] = g.legs ?? [];
            const isExpanded = isGroup && expandedGroups.has(trade.id);

            return (
              <div key={trade.id}>
              <div
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
                  const field = getField(key);
                  if (!field) return <div key={key} className="text-sm text-muted-foreground truncate">—</div>;
                  return (
                    <div key={key} className="min-w-0" onClick={(e) => {
                      if (field.valueType === 'readonly' || field.valueType === 'computed') {
                        e.stopPropagation();
                      }
                    }}>
                      <FieldCell
                        field={field}
                        trade={trade}
                        surface="table"
                        legIds={legs.map(l => l.id)}
                        accounts={accounts}
                        playbooks={playbooks}
                        isGroup={isGroup}
                        legs={legs}
                        isExpanded={isExpanded}
                        toggleExpand={() => toggleExpand(trade.id)}
                      />
                    </div>
                  );
                })}


                {/* Expand arrow — toggles per-leg breakdown when grouped */}
                <div className="flex justify-center" onClick={(e) => {
                  if (isGroup) { e.stopPropagation(); toggleExpand(trade.id); }
                }}>
                  {isGroup ? (
                    isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  )}
                </div>
              </div>
              {isExpanded && (
                <div className="bg-muted/20 border-l-2 border-l-primary/40 px-8 py-2 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Legs ({legs.length}) — each row is a separate broker position from the position sizer
                  </div>
                  {legs.map((leg, i) => {
                    const p = leg.net_pnl;
                    const r = leg.r_multiple_actual;
                    return (
                      <div
                        key={leg.id}
                        className="grid grid-cols-[24px_120px_1fr_1fr_1fr_1fr_1fr] gap-2 text-xs items-center py-1 hover:bg-accent/20 rounded cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); onTradeClick(leg); }}
                      >
                        <span className="text-muted-foreground text-center">#{i + 1}</span>
                        <span className="text-muted-foreground font-mono-numbers">{formatTimeET(leg.entry_time)}</span>
                        <span className="font-mono-numbers">
                          Entry <span className="text-foreground">{leg.entry_price?.toFixed(5) ?? "—"}</span>
                        </span>
                        <span className="font-mono-numbers">
                          Exit <span className="text-foreground">{leg.exit_price?.toFixed(5) ?? (leg.is_open ? "open" : "—")}</span>
                        </span>
                        <span className="font-mono-numbers text-muted-foreground">
                          {(leg.original_lots ?? leg.total_lots ?? 0).toFixed(2)} lots
                        </span>
                        <span className={cn(
                          "font-mono-numbers text-right",
                          p != null && p > 0 && "text-profit",
                          p != null && p < 0 && "text-loss",
                          (p == null) && "text-muted-foreground"
                        )}>
                          {p != null ? `${p >= 0 ? "+" : ""}$${p.toFixed(2)}` : "—"}
                        </span>
                        <span className={cn(
                          "font-mono-numbers text-right",
                          r != null && r > 0 && "text-profit",
                          r != null && r < 0 && "text-loss",
                          (r == null) && "text-muted-foreground"
                        )}>
                          {r != null ? `${r >= 0 ? "+" : ""}${r.toFixed(2)}R` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
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