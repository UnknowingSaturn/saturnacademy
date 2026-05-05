import { useMemo, useState } from "react";
import {
  useUserSettings,
  useUpdateUserSettings,
  usePropertyOptions,
  useCreatePropertyOption,
  useUpdatePropertyOption,
  useDeletePropertyOption,
  useReorderPropertyOptions,
} from "@/hooks/useUserSettings";
import {
  useCustomFieldDefinitions,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
  useEraseCustomFieldData,
  useReorderCustomFields,
  useCountTradesWithCustomField,
  useEraseSystemFieldData,
  useCountTradesWithSystemField,
} from "@/hooks/useCustomFields";
import {
  DETAIL_FIELD_CATALOG,
  DEFAULT_DETAIL_FIELD_ORDER,
  DEFAULT_DETAIL_VISIBLE_FIELDS,
  DEFAULT_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  CustomFieldDefinition,
  PropertyOption,
  isCoreField,
  resolveFieldLabel,
  customFieldToColumn,
  canEraseSystemField,
} from "@/types/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  GripVertical,
  Plus,
  MoreHorizontal,
  Trash2,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronDown,
  Lock,
  Pencil,
  Settings2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CustomFieldDialog } from "./CustomFieldDialog";
import { SystemFieldConfigDialog } from "./SystemFieldConfigDialog";
import { useFieldOverrides } from "@/hooks/useFieldOverrides";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ──────────────────────────────────────────────────────────────────────────────
// Field model: a unified row across system + custom fields
// ──────────────────────────────────────────────────────────────────────────────

type FieldRow = {
  key: string;
  defaultLabel: string;
  category: "core" | "system" | "custom";
  description?: string;
  // For select/multi-select fields, the property_options group name (system) or
  // the custom-field id (custom). undefined for fields without a dropdown.
  optionsPropertyName?: string;
  customDef?: CustomFieldDefinition;
  isInTable: boolean;       // appears in DEFAULT_COLUMNS / table registry
  isInDetail: boolean;      // appears in DETAIL_FIELD_CATALOG
};

const SYSTEM_OPTION_PROPERTY: Record<string, string> = {
  emotion: "emotion",
  emotional_state_before: "emotion",
  session: "session",
  profile: "profile",
  actual_profile: "profile",
  regime: "regime",
  actual_regime: "regime",
  alignment: "timeframe",
  entry_timeframes: "timeframe",
};

const COLOR_PALETTE = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16",
  "#22C55E", "#10B981", "#14B8A6", "#06B6D4", "#0EA5E9",
  "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7", "#D946EF",
  "#EC4899", "#F43F5E", "#6B7280",
];

// ──────────────────────────────────────────────────────────────────────────────

export function FieldsPanel() {
  const { data: settings, isLoading: loadingSettings } = useUserSettings();
  const { data: customFields = [], isLoading: loadingFields } = useCustomFieldDefinitions();
  const updateSettings = useUpdateUserSettings();

  const createField = useCreateCustomField();
  const updateField = useUpdateCustomField();
  const deleteField = useDeleteCustomField();
  const eraseFieldData = useEraseCustomFieldData();
  const eraseSystemData = useEraseSystemFieldData();
  const reorderFields = useReorderCustomFields();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [systemConfigKey, setSystemConfigKey] = useState<string | null>(null);
  const { data: fieldOverrides = [] } = useFieldOverrides();
  const overrideByKey = useMemo(() => {
    const map = new Map(fieldOverrides.map((o) => [o.field_key, o]));
    return map;
  }, [fieldOverrides]);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "system-soft"; field: FieldRow }
    | { kind: "system-erasable"; field: FieldRow }
    | { kind: "custom-soft"; field: CustomFieldDefinition }
    | { kind: "custom-hard"; field: CustomFieldDefinition }
    | { kind: "custom-erase"; field: CustomFieldDefinition }
    | null
  >(null);
  const [eraseAlongDelete, setEraseAlongDelete] = useState(false);

  // Counters for the destructive dialogs
  const customCountKey =
    deleteTarget?.kind === "custom-hard" || deleteTarget?.kind === "custom-erase"
      ? deleteTarget.field.key
      : null;
  const { data: customEraseCount = 0 } = useCountTradesWithCustomField(customCountKey);

  const systemCountKey =
    deleteTarget?.kind === "system-erasable" ? deleteTarget.field.key : null;
  const { data: systemEraseCount = 0 } = useCountTradesWithSystemField(systemCountKey);

  const overrides = settings?.field_label_overrides || {};
  const visibleColumns = settings?.visible_columns || DEFAULT_VISIBLE_COLUMNS;
  const columnOrder: string[] = (settings?.column_order as string[]) || DEFAULT_VISIBLE_COLUMNS;
  const deletedSet = useMemo(() => new Set(settings?.deleted_system_fields || []), [settings?.deleted_system_fields]);

  // Detail visibility
  const detailVisible = useMemo(() => {
    if (!settings) return new Set(DEFAULT_DETAIL_VISIBLE_FIELDS);
    if (settings.detail_visible_fields.length === 0) {
      return new Set([
        ...DEFAULT_DETAIL_VISIBLE_FIELDS,
        ...customFields.filter((f) => f.is_active).map((f) => f.key),
      ]);
    }
    return new Set(settings.detail_visible_fields);
  }, [settings, customFields]);

  const detailOrder = useMemo(() => {
    const userOrder = settings?.detail_field_order?.length
      ? settings.detail_field_order
      : DEFAULT_DETAIL_FIELD_ORDER;
    const customKeys = customFields.filter((f) => f.is_active).map((f) => f.key);
    const known = new Set([...DEFAULT_DETAIL_FIELD_ORDER, ...customKeys]);
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const k of userOrder) if (known.has(k) && !seen.has(k)) { ordered.push(k); seen.add(k); }
    for (const k of [...DEFAULT_DETAIL_FIELD_ORDER, ...customKeys]) if (!seen.has(k)) ordered.push(k);
    return ordered;
  }, [settings?.detail_field_order, customFields]);

  // Build the unified field list. Order: detail-order first (covers system + active custom),
  // then table-only system columns not in the detail catalog. Skips per-user deleted fields.
  const rows = useMemo<FieldRow[]>(() => {
    const out: FieldRow[] = [];
    const seen = new Set<string>();

    const tableKeys = new Set(DEFAULT_COLUMNS.map((c) => c.key));

    const activeCustomMap = new Map(customFields.filter((f) => f.is_active).map((f) => [f.key, f]));

    // Walk detail order (covers system + active custom in user order)
    for (const key of detailOrder) {
      if (seen.has(key)) continue;
      if (deletedSet.has(key)) { seen.add(key); continue; }
      seen.add(key);
      const sys = DETAIL_FIELD_CATALOG.find((d) => d.key === key);
      const custom = activeCustomMap.get(key);
      if (custom) {
        out.push({
          key,
          defaultLabel: custom.label,
          category: "custom",
          description: `Custom · ${custom.type}`,
          customDef: custom,
          isInTable: true,
          isInDetail: true,
          optionsPropertyName: undefined,
        });
      } else if (sys) {
        out.push({
          key,
          defaultLabel: sys.label,
          category: isCoreField(key) ? "core" : "system",
          description: kindHint(sys.kind),
          isInTable: tableKeys.has(key) || tableKeys.has(sys.field || ""),
          isInDetail: true,
          optionsPropertyName: SYSTEM_OPTION_PROPERTY[key] ?? sys.propertyName,
        });
      }
    }

    // Table-only system columns (e.g. trade_number, entry_time) not in the detail catalog
    for (const col of DEFAULT_COLUMNS) {
      if (seen.has(col.key)) continue;
      if (col.key.startsWith("cf_")) continue;
      if (deletedSet.has(col.key)) { seen.add(col.key); continue; }
      seen.add(col.key);
      out.push({
        key: col.key,
        defaultLabel: col.label,
        category: isCoreField(col.key) ? "core" : "system",
        description: `Table · ${col.type}`,
        isInTable: true,
        isInDetail: false,
        optionsPropertyName: SYSTEM_OPTION_PROPERTY[col.key] ?? col.propertyName,
      });
    }

    return out;
  }, [detailOrder, customFields, deletedSet]);

  const inactiveCustom = customFields.filter((f) => !f.is_active);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // ──── handlers ──────────────────────────────────────────────────────────────

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = rows.map((r) => r.key);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const newOrder = arrayMove(ids, oldIdx, newIdx);

    // Apply ordering to BOTH the detail panel order and the table column order.
    // Table order: keep only keys it knows about (system table columns + custom).
    const tableKnownSet = new Set([
      ...DEFAULT_COLUMNS.map((c) => c.key),
      ...customFields.map((f) => f.key),
    ]);
    const nextTableOrder = newOrder.filter((k) => tableKnownSet.has(k));
    // Append any table-known keys not in newOrder (shouldn't happen, but safety)
    for (const k of columnOrder) if (!nextTableOrder.includes(k) && tableKnownSet.has(k)) nextTableOrder.push(k);

    // Detail order: keep only detail-known + active custom
    const detailKnownSet = new Set([
      ...DEFAULT_DETAIL_FIELD_ORDER,
      ...customFields.filter((f) => f.is_active).map((f) => f.key),
    ]);
    const nextDetailOrder = newOrder.filter((k) => detailKnownSet.has(k));

    await updateSettings.mutateAsync({
      column_order: nextTableOrder,
      detail_field_order: nextDetailOrder,
    });

    // Persist sort_order on custom field defs to keep them stable
    const customOrder = newOrder
      .map((k) => customFields.find((f) => f.key === k))
      .filter((f): f is CustomFieldDefinition => !!f)
      .map((f, i) => ({ id: f.id, sort_order: i }));
    if (customOrder.length > 0) await reorderFields.mutateAsync(customOrder);
  };

  const handleRename = async (row: FieldRow, nextLabel: string) => {
    const trimmed = nextLabel.trim();
    if (!trimmed || trimmed === resolveLabel(row)) return;
    if (row.category === "custom" && row.customDef) {
      await updateField.mutateAsync({ id: row.customDef.id, label: trimmed });
    } else {
      // System / core: store override in user_settings.field_label_overrides.
      // Also keep column_overrides in sync for the table header that reads from it.
      const nextOverrides = { ...overrides, [row.key]: trimmed };
      const nextColOverrides = {
        ...(settings?.column_overrides || {}),
        [row.key]: { ...((settings?.column_overrides || {})[row.key] || {}), label: trimmed },
      };
      await updateSettings.mutateAsync({
        field_label_overrides: nextOverrides,
        column_overrides: nextColOverrides,
      });
    }
  };

  const handleResetLabel = async (row: FieldRow) => {
    if (row.category === "custom") return;
    const nextOverrides = { ...overrides };
    delete nextOverrides[row.key];
    const nextCol = { ...(settings?.column_overrides || {}) };
    if (nextCol[row.key]) {
      const { label, ...rest } = nextCol[row.key];
      if (Object.keys(rest).length === 0) delete nextCol[row.key];
      else nextCol[row.key] = rest;
    }
    await updateSettings.mutateAsync({
      field_label_overrides: nextOverrides,
      column_overrides: nextCol,
    });
  };

  const toggleTable = async (row: FieldRow) => {
    const isVisible = visibleColumns.includes(row.key);
    const nextVisible = isVisible ? visibleColumns.filter((k) => k !== row.key) : [...visibleColumns, row.key];
    const nextOrder = columnOrder.includes(row.key) ? columnOrder : [...columnOrder, row.key];
    await updateSettings.mutateAsync({
      visible_columns: nextVisible,
      column_order: nextOrder,
    });
  };

  const toggleDetail = async (row: FieldRow) => {
    const current = Array.from(detailVisible);
    const next = current.includes(row.key) ? current.filter((k) => k !== row.key) : [...current, row.key];
    await updateSettings.mutateAsync({ detail_visible_fields: next });
  };

  const requestDelete = (row: FieldRow) => {
    setEraseAlongDelete(false);
    if (row.category === "custom" && row.customDef) {
      setDeleteTarget({ kind: "custom-soft", field: row.customDef });
      return;
    }
    if (row.category === "core") return;
    // System (non-core): if it has erasable underlying data, offer the erase choice
    if (canEraseSystemField(row.key)) {
      setDeleteTarget({ kind: "system-erasable", field: row });
    } else {
      setDeleteTarget({ kind: "system-soft", field: row });
    }
  };

  const closeDelete = () => {
    setDeleteTarget(null);
    setEraseAlongDelete(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    switch (deleteTarget.kind) {
      case "system-soft": {
        // Soft-delete (Notion-style): remove from table + detail AND tombstone the field
        // so it disappears from the active list and the regular hidden-fields restore list.
        const k = deleteTarget.field.key;
        const nextDeleted = Array.from(new Set([...(settings?.deleted_system_fields || []), k]));
        await updateSettings.mutateAsync({
          column_order: columnOrder.filter((c) => c !== k),
          visible_columns: visibleColumns.filter((c) => c !== k),
          detail_visible_fields: Array.from(detailVisible).filter((c) => c !== k),
          deleted_system_fields: nextDeleted,
        });
        break;
      }
      case "system-erasable": {
        const k = deleteTarget.field.key;
        const nextDeleted = Array.from(new Set([...(settings?.deleted_system_fields || []), k]));
        await updateSettings.mutateAsync({
          column_order: columnOrder.filter((c) => c !== k),
          visible_columns: visibleColumns.filter((c) => c !== k),
          detail_visible_fields: Array.from(detailVisible).filter((c) => c !== k),
          deleted_system_fields: nextDeleted,
        });
        if (eraseAlongDelete) {
          await eraseSystemData.mutateAsync(k);
        }
        break;
      }
      case "custom-soft":
        await updateField.mutateAsync({ id: deleteTarget.field.id, is_active: false });
        break;
      case "custom-erase":
        await eraseFieldData.mutateAsync(deleteTarget.field.key);
        break;
      case "custom-hard":
        if (eraseAlongDelete) {
          await eraseFieldData.mutateAsync(deleteTarget.field.key);
        }
        await deleteField.mutateAsync(deleteTarget.field.id);
        break;
    }
    closeDelete();
  };

  const restoreCustom = async (f: CustomFieldDefinition) => {
    await updateField.mutateAsync({ id: f.id, is_active: true });
  };

  const restoreSystem = async (key: string) => {
    const nextOrder = columnOrder.includes(key) ? columnOrder : [...columnOrder, key];
    const nextVisible = visibleColumns.includes(key) ? visibleColumns : [...visibleColumns, key];
    const nextDetail = Array.from(detailVisible);
    if (DETAIL_FIELD_CATALOG.some((d) => d.key === key) && !nextDetail.includes(key)) {
      nextDetail.push(key);
    }
    const nextDeleted = (settings?.deleted_system_fields || []).filter((k) => k !== key);
    await updateSettings.mutateAsync({
      column_order: nextOrder,
      visible_columns: nextVisible,
      detail_visible_fields: nextDetail,
      deleted_system_fields: nextDeleted,
    });
  };

  // Compute the currently-rendered label for a row
  const resolveLabel = (row: FieldRow) => resolveFieldLabel(row.key, row.defaultLabel, overrides);

  // Hidden system fields = present in defaults but absent from columnOrder AND not user-deleted
  const hiddenSystem = useMemo(() => {
    const orderSet = new Set(columnOrder);
    return DEFAULT_COLUMNS.filter((c) => !orderSet.has(c.key) && !c.key.startsWith("cf_") && !deletedSet.has(c.key));
  }, [columnOrder, deletedSet]);

  // Deleted (tombstoned) system fields — only shown in the Deleted area for restore.
  const deletedSystem = useMemo(() => {
    const list: { key: string; label: string; type: string }[] = [];
    for (const k of settings?.deleted_system_fields || []) {
      const col = DEFAULT_COLUMNS.find((c) => c.key === k);
      const detail = DETAIL_FIELD_CATALOG.find((d) => d.key === k);
      if (col) list.push({ key: k, label: col.label, type: col.type });
      else if (detail) list.push({ key: k, label: detail.label, type: detail.kind });
    }
    return list;
  }, [settings?.deleted_system_fields]);

  if (loadingSettings || loadingFields) {
    return <div className="p-4 text-center text-muted-foreground">Loading fields…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Fields</h3>
          <p className="text-sm text-muted-foreground">
            Add, rename, hide, reorder, and delete fields. Edit dropdown options inline.
            Core fields can be hidden but never deleted.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditingField(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />
          Add custom field
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {rows.map((row) => (
              <FieldRowCard
                key={row.key}
                row={row}
                label={resolveLabel(row)}
                hasOverride={!!overrides[row.key]}
                inTable={visibleColumns.includes(row.key)}
                inDetail={detailVisible.has(row.key)}
                onRename={(next) => handleRename(row, next)}
                onResetLabel={() => handleResetLabel(row)}
                onToggleTable={() => toggleTable(row)}
                onToggleDetail={() => toggleDetail(row)}
                onDelete={() => requestDelete(row)}
                onEditCustom={() => { if (row.customDef) { setEditingField(row.customDef); setDialogOpen(true); } }}
                onConfigureSystem={
                  row.category === "system" || row.category === "core"
                    ? () => setSystemConfigKey(row.key)
                    : undefined
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Hidden system fields */}
      {hiddenSystem.length > 0 && (
        <div className="pt-4 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Hidden system fields ({hiddenSystem.length})
          </div>
          <div className="space-y-2">
            {hiddenSystem.map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between p-2.5 rounded-lg border border-dashed border-border bg-muted/30"
              >
                <div>
                  <div className="text-sm font-medium">
                    {resolveFieldLabel(c.key, c.label, overrides)}
                  </div>
                  <div className="text-xs text-muted-foreground">{c.type}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => restoreSystem(c.key)}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deleted fields (per-user tombstones) */}
      {deletedSystem.length > 0 && (
        <div className="pt-4 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Deleted fields ({deletedSystem.length})
          </div>
          <div className="space-y-2">
            {deletedSystem.map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between p-2.5 rounded-lg border border-dashed border-destructive/40 bg-destructive/5"
              >
                <div>
                  <div className="text-sm font-medium">
                    {resolveFieldLabel(c.key, c.label, overrides)}
                  </div>
                  <div className="text-xs text-muted-foreground">Deleted · {c.type}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => restoreSystem(c.key)}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {inactiveCustom.length > 0 && (
        <div className="pt-4 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Hidden custom fields ({inactiveCustom.length})
          </div>
          <div className="space-y-2">
            {inactiveCustom.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between p-2.5 rounded-lg border border-dashed border-border bg-muted/30"
              >
                <div>
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="text-xs text-muted-foreground">Custom · {f.type}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => restoreCustom(f)}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Restore
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => { setEraseAlongDelete(false); setDeleteTarget({ kind: "custom-erase", field: f }); }}
                      >
                        Erase data from all trades
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => { setEraseAlongDelete(false); setDeleteTarget({ kind: "custom-hard", field: f }); }}
                      >
                        Permanently delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <CustomFieldDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingField(null); }}
        initial={editingField}
        onSubmit={async (input) => {
          if (editingField) {
            await updateField.mutateAsync({
              id: editingField.id,
              label: input.label,
              type: input.type,
              previousType: editingField.type,
              options: input.options,
            });
          } else {
            await createField.mutateAsync(input);
          }
        }}
      />

      {/* Unified delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && closeDelete()}>
        <AlertDialogContent>
          {deleteTarget?.kind === "system-soft" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete "{resolveFieldLabel(deleteTarget.field.key, deleteTarget.field.defaultLabel, overrides)}"?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This is a system field. Removing it hides it from the table and trade detail.
                  Underlying data on existing trades is preserved and can be restored from the Hidden
                  fields section below.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Hide field
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}

          {deleteTarget?.kind === "system-erasable" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete "{resolveFieldLabel(deleteTarget.field.key, deleteTarget.field.defaultLabel, overrides)}"?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Hides this system field from the table and trade detail. <strong>{systemEraseCount}</strong>{" "}
                  trade{systemEraseCount === 1 ? " has" : "s have"} a value for it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <label className="flex items-start gap-2 p-3 rounded-md bg-muted/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={eraseAlongDelete}
                  onChange={(e) => setEraseAlongDelete(e.target.checked)}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium">Also permanently erase data</div>
                  <div className="text-xs text-muted-foreground">
                    Wipes the value from {systemEraseCount} trade{systemEraseCount === 1 ? "" : "s"}.
                    Cannot be undone.
                  </div>
                </div>
              </label>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {eraseAlongDelete
                    ? `Hide & erase ${systemEraseCount} value${systemEraseCount === 1 ? "" : "s"}`
                    : "Hide field"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}

          {deleteTarget?.kind === "custom-soft" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{deleteTarget.field.label}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  Hides this custom field. Data is preserved on every trade and the field can be
                  restored from the Hidden custom fields section below. To remove permanently, use the
                  options menu there.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Hide field
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}

          {deleteTarget?.kind === "custom-erase" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Erase data for "{deleteTarget.field.label}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  Permanently removes the value for this field from <strong>{customEraseCount}</strong>{" "}
                  trade{customEraseCount === 1 ? "" : "s"}. The field definition stays. Cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Erase {customEraseCount} value{customEraseCount === 1 ? "" : "s"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}

          {deleteTarget?.kind === "custom-hard" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete "{deleteTarget.field.label}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  Removes the field definition entirely. <strong>{customEraseCount}</strong> trade
                  {customEraseCount === 1 ? " still has" : "s still have"} a value for it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <label className="flex items-start gap-2 p-3 rounded-md bg-muted/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={eraseAlongDelete}
                  onChange={(e) => setEraseAlongDelete(e.target.checked)}
                  className="mt-0.5"
                />
                <div className="text-sm">
                  <div className="font-medium">Also wipe the data from those trades</div>
                  <div className="text-xs text-muted-foreground">
                    Recommended — otherwise stored values become orphaned.
                  </div>
                </div>
              </label>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Permanently delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// One row in the unified field list
// ──────────────────────────────────────────────────────────────────────────────

interface FieldRowCardProps {
  row: FieldRow;
  label: string;
  hasOverride: boolean;
  inTable: boolean;
  inDetail: boolean;
  onRename: (next: string) => void;
  onResetLabel: () => void;
  onToggleTable: () => void;
  onToggleDetail: () => void;
  onDelete: () => void;
  onEditCustom?: () => void;
  onConfigureSystem?: () => void;
}

function FieldRowCard({
  row,
  label,
  hasOverride,
  inTable,
  inDetail,
  onRename,
  onResetLabel,
  onToggleTable,
  onToggleDetail,
  onDelete,
  onEditCustom,
  onConfigureSystem,
}: FieldRowCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.key });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const commit = () => {
    if (draft.trim() && draft !== label) onRename(draft.trim());
    setEditing(false);
  };

  const hasOptions =
    !!row.optionsPropertyName ||
    (row.customDef && (row.customDef.type === "select" || row.customDef.type === "multi_select"));

  const isCore = row.category === "core";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border border-border bg-card/50 transition-colors",
        isDragging && "opacity-50 shadow-lg",
      )}
    >
      <div className="flex items-center gap-3 p-3">
        <button {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing">
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") { setDraft(label); setEditing(false); }
              }}
              className="h-7 text-sm"
            />
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setDraft(label); setEditing(true); }}
                className="font-medium text-left text-sm hover:underline decoration-dotted underline-offset-4"
              >
                {label}
              </button>
              {row.category === "core" && (
                <Badge variant="outline" className="text-[10px] py-0 h-4 gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  Core
                </Badge>
              )}
              {row.category === "custom" && (
                <Badge variant="outline" className="text-[10px] py-0 h-4">Custom</Badge>
              )}
              {hasOverride && row.category !== "custom" && (
                <button
                  onClick={onResetLabel}
                  className="text-[10px] text-primary hover:underline"
                  title="Reset to default name"
                >
                  reset
                </button>
              )}
            </div>
          )}
          {row.description && (
            <div className="text-[11px] text-muted-foreground mt-0.5">{row.description}</div>
          )}
        </div>

        {/* Visibility toggles */}
        <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
          {row.isInTable && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span>Table</span>
              <Switch checked={inTable} onCheckedChange={onToggleTable} />
            </label>
          )}
          {row.isInDetail && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span>Detail</span>
              <Switch checked={inDetail} onCheckedChange={onToggleDetail} />
            </label>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs">Visibility</DropdownMenuLabel>
            {row.isInTable && (
              <DropdownMenuItem onClick={onToggleTable}>
                {inTable ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                {inTable ? "Hide from table" : "Show in table"}
              </DropdownMenuItem>
            )}
            {row.isInDetail && (
              <DropdownMenuItem onClick={onToggleDetail}>
                {inDetail ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                {inDetail ? "Hide from trade detail" : "Show in trade detail"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setDraft(label); setEditing(true); }}>
              <Pencil className="w-4 h-4 mr-2" />
              Rename
            </DropdownMenuItem>
            {hasOptions && (
              <DropdownMenuItem onClick={() => setOptionsOpen((v) => !v)}>
                <ChevronDown className={cn("w-4 h-4 mr-2 transition-transform", optionsOpen && "rotate-180")} />
                {optionsOpen ? "Close options" : "Edit dropdown options"}
              </DropdownMenuItem>
            )}
            {row.category === "custom" && onEditCustom && (
              <DropdownMenuItem onClick={onEditCustom}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit field & change type…
              </DropdownMenuItem>
            )}
            {onConfigureSystem && row.category !== "custom" && (
              <DropdownMenuItem onClick={onConfigureSystem}>
                <Settings2 className="w-4 h-4 mr-2" />
                Configure type & options…
              </DropdownMenuItem>
            )}
            {!isCore && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete field
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {hasOptions && (
        <Collapsible open={optionsOpen} onOpenChange={setOptionsOpen}>
          <CollapsibleContent>
            <div className="border-t border-border p-3 bg-muted/20">
              {row.optionsPropertyName ? (
                <SystemOptionsEditor propertyName={row.optionsPropertyName} />
              ) : row.customDef ? (
                <CustomOptionsEditor field={row.customDef} />
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// System dropdown options editor (property_options table)
// ──────────────────────────────────────────────────────────────────────────────

function SystemOptionsEditor({ propertyName }: { propertyName: string }) {
  const { data: options = [] } = usePropertyOptions(propertyName);
  const create = useCreatePropertyOption();
  const update = useUpdatePropertyOption();
  const del = useDeletePropertyOption();
  const reorder = useReorderPropertyOptions();
  const [adding, setAdding] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleAdd = async () => {
    const label = adding.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${options.length + 1}`;
    const color = COLOR_PALETTE[options.length % COLOR_PALETTE.length];
    await create.mutateAsync({
      property_name: propertyName,
      value,
      label,
      color,
      sort_order: options.length,
      is_active: true,
    });
    setAdding("");
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = options.findIndex((o) => o.id === active.id);
    const newIdx = options.findIndex((o) => o.id === over.id);
    const next = arrayMove(options, oldIdx, newIdx).map((o, i) => ({ id: o.id, sort_order: i }));
    await reorder.mutateAsync(next);
  };

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={options.map((o) => o.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {options.map((opt) => (
              <OptionRow
                key={opt.id}
                option={opt}
                onUpdate={(u) => update.mutateAsync({ id: opt.id, ...u })}
                onSoftDelete={() => update.mutateAsync({ id: opt.id, is_active: !opt.is_active })}
                onHardDelete={() => del.mutateAsync(opt.id)}
              />
            ))}
            {options.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">No options yet.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex items-center gap-2 pt-1">
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="Add option…"
          className="h-7 text-xs flex-1"
        />
        <Button size="sm" onClick={handleAdd} disabled={!adding.trim()} className="h-7">
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}

interface OptionRowProps {
  option: PropertyOption;
  onUpdate: (updates: Partial<PropertyOption>) => Promise<unknown>;
  onSoftDelete: () => Promise<unknown>;
  onHardDelete: () => Promise<unknown>;
}

function OptionRow({ option, onUpdate, onSoftDelete, onHardDelete }: OptionRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(option.label);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const commit = () => {
    if (draft.trim() && draft !== option.label) onUpdate({ label: draft.trim() });
    else setDraft(option.label);
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-1.5 rounded border border-border/50 bg-background",
        !option.is_active && "opacity-60",
        isDragging && "opacity-50 shadow",
      )}
    >
      <button {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: option.color }} />

      <div className="flex-1 min-w-0">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setDraft(option.label); setEditing(false); }
            }}
            className="h-6 text-xs"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium border"
            style={{
              backgroundColor: `${option.color}20`,
              color: option.color,
              borderColor: `${option.color}40`,
            }}
          >
            {option.label}
            {!option.is_active && <span className="ml-1 opacity-60">(hidden)</span>}
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        {COLOR_PALETTE.slice(0, 8).map((c) => (
          <button
            key={c}
            className={cn(
              "w-3 h-3 rounded-full opacity-50 hover:opacity-100 transition-all",
              option.color === c && "opacity-100 ring-1 ring-offset-1 ring-offset-background ring-foreground",
            )}
            style={{ backgroundColor: c }}
            onClick={() => onUpdate({ color: c })}
          />
        ))}
      </div>

      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={onSoftDelete}
        title={option.is_active ? "Hide option" : "Restore option"}
      >
        {option.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        onClick={onHardDelete}
        title="Permanently delete option"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Custom select/multi-select inline options editor
// ──────────────────────────────────────────────────────────────────────────────

function CustomOptionsEditor({ field }: { field: CustomFieldDefinition }) {
  const update = useUpdateCustomField();
  const [adding, setAdding] = useState("");
  const options = field.options || [];

  const setOptions = async (next: typeof options) => {
    await update.mutateAsync({ id: field.id, options: next });
  };

  const handleAdd = async () => {
    const label = adding.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${options.length + 1}`;
    const color = COLOR_PALETTE[options.length % COLOR_PALETTE.length];
    await setOptions([...options, { value, label, color }]);
    setAdding("");
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {options.map((o, idx) => (
          <div key={`${o.value}_${idx}`} className="flex items-center gap-2 p-1.5 rounded border border-border/50 bg-background">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: o.color || "#6B7280" }} />
            <Input
              value={o.label}
              onChange={(e) => {
                const next = [...options];
                next[idx] = { ...next[idx], label: e.target.value, value: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${idx + 1}` };
                setOptions(next);
              }}
              className="h-6 text-xs flex-1"
            />
            <div className="flex items-center gap-0.5">
              {COLOR_PALETTE.slice(0, 8).map((c) => (
                <button
                  key={c}
                  className={cn(
                    "w-3 h-3 rounded-full opacity-50 hover:opacity-100 transition-all",
                    o.color === c && "opacity-100 ring-1 ring-offset-1 ring-offset-background ring-foreground",
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    const next = [...options];
                    next[idx] = { ...next[idx], color: c };
                    setOptions(next);
                  }}
                />
              ))}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => setOptions(options.filter((_, i) => i !== idx))}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
        {options.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">No options yet.</p>
        )}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="Add option…"
          className="h-7 text-xs flex-1"
        />
        <Button size="sm" onClick={handleAdd} disabled={!adding.trim()} className="h-7">
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────────

function kindHint(kind: string): string {
  switch (kind) {
    case "readonly":         return "Auto-filled";
    case "select":           return "Single select";
    case "multi-select":     return "Multi-select";
    case "playbook-select":  return "Playbook";
    case "dual-playbook":    return "Planned + Actual playbook";
    case "dual-select":      return "Planned + Actual select";
    case "dual-multi":       return "Planned + Actual multi-select";
    case "text":             return "Text";
    case "account-select":   return "Account picker";
    default:                  return "";
  }
}

// canEraseSystem is now provided by `canEraseSystemField` from @/types/settings,
// which derives directly from SYSTEM_FIELD_SOURCES (single source of truth).
