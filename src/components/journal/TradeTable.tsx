import { useState, useMemo } from "react";
import { Trade, Account } from "@/types/trading";
import { useBulkArchiveTrades } from "@/hooks/useTrades";
import { usePlaybooks } from "@/hooks/usePlaybooks";
import { cn } from "@/lib/utils";
import { formatTimeET } from "@/lib/time";

import { BadgeSelect } from "./BadgeSelect";
import { FieldHeaderMenu } from "./FieldHeaderMenu";
import { AddFieldPopover } from "./AddFieldPopover";
import { RemoveFieldDialog } from "./RemoveFieldDialog";
import { BulkActionBar } from "./BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronRight, GripVertical, ChevronDown } from "lucide-react";
import { ColumnDefinition } from "@/types/settings";

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
import { FieldCell } from "@/lib/journalFields/FieldCell";
import { buildFieldRegistry, FieldDef } from "@/lib/journalFields/registry";



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
  const bulkArchive = useBulkArchiveTrades();
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
    const base: string[] = layout?.table?.order?.length
      ? [...layout.table.order]
      : [...effectiveOrder];
    if (!base.includes(activeKey)) base.push(activeKey);
    if (!base.includes(overKey)) base.push(overKey);
    const from = base.indexOf(activeKey);
    const to = base.indexOf(overKey);
    if (from === -1 || to === -1) return;
    await reorderColumns(arrayMove(base, from, to));
  };

  // Effective per-user column list — `journal_field_layout` is the single source
  // of truth; registry defaults only fill in before the layout is backfilled.
  const effectiveOrder = useMemo(
    () => (layout?.table?.order?.length ? layout.table.order : DEFAULT_TABLE_ORDER),
    [layout?.table?.order]
  );

  const activeColumns = useMemo(() => {
    const hiddenSet = new Set<string>(
      layout?.table ? layout.table.hidden : DEFAULT_TABLE_HIDDEN
    );
    for (const k of layout?.removed || []) hiddenSet.add(k);
    const knownSet = new Set(fieldRegistry.map(f => f.key));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of effectiveOrder) {
      if (seen.has(k) || hiddenSet.has(k) || !knownSet.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  }, [effectiveOrder, fieldRegistry, layout?.table, layout?.removed]);



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
            const isSelected = selectedIds.has(trade.id);
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
                      if (field.valueType === 'readonly' || field.source.kind === 'computed') {
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