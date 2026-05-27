import { useMemo, useState } from "react";
import {
  useUserSettings,
  useUpdateUserSettings,
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
  isCoreField,
  resolveFieldLabel,
  canEraseSystemField,
} from "@/types/settings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, RotateCcw } from "lucide-react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { FieldRow, SYSTEM_OPTION_PROPERTY, kindHint } from "./fields/constants";
import { FieldRowCard } from "./fields/FieldRowCard";
import { DeleteFieldDialog, DeleteTarget } from "./fields/DeleteFieldDialog";

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
  const overrideByKey = useMemo(
    () => new Map(fieldOverrides.map((o) => [o.field_key, o])),
    [fieldOverrides],
  );
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [eraseAlongDelete, setEraseAlongDelete] = useState(false);

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
  const deletedSet = useMemo(
    () => new Set(settings?.deleted_system_fields || []),
    [settings?.deleted_system_fields],
  );

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

  const rows = useMemo<FieldRow[]>(() => {
    const out: FieldRow[] = [];
    const seen = new Set<string>();
    const tableKeys = new Set(DEFAULT_COLUMNS.map((c) => c.key));
    const activeCustomMap = new Map(customFields.filter((f) => f.is_active).map((f) => [f.key, f]));

    const pushSystemKey = (key: string) => {
      if (seen.has(key)) return;
      if (deletedSet.has(key)) { seen.add(key); return; }
      const sys = DETAIL_FIELD_CATALOG.find((d) => d.key === key);
      const col = DEFAULT_COLUMNS.find((c) => c.key === key);
      const custom = activeCustomMap.get(key);
      if (custom) {
        seen.add(key);
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
        seen.add(key);
        out.push({
          key,
          defaultLabel: sys.label,
          category: isCoreField(key) ? "core" : "system",
          description: kindHint(sys.kind),
          isInTable: tableKeys.has(key) || tableKeys.has(sys.field || ""),
          isInDetail: true,
          optionsPropertyName: SYSTEM_OPTION_PROPERTY[key] ?? sys.propertyName,
        });
      } else if (col) {
        seen.add(key);
        out.push({
          key,
          defaultLabel: col.label,
          category: isCoreField(key) ? "core" : "system",
          description: `Table · ${col.type}`,
          isInTable: true,
          isInDetail: false,
          optionsPropertyName: SYSTEM_OPTION_PROPERTY[key] ?? col.propertyName,
        });
      }
    };

    for (const key of columnOrder) pushSystemKey(key);
    for (const key of detailOrder) pushSystemKey(key);
    for (const col of DEFAULT_COLUMNS) {
      if (col.key.startsWith("cf_")) continue;
      pushSystemKey(col.key);
    }

    return out;
  }, [columnOrder, detailOrder, customFields, deletedSet]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = rows.map((r) => r.key);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const newOrder = arrayMove(ids, oldIdx, newIdx);

    const tableKnownSet = new Set([
      ...DEFAULT_COLUMNS.map((c) => c.key),
      ...customFields.map((f) => f.key),
    ]);
    const nextTableOrder = newOrder.filter((k) => tableKnownSet.has(k));
    for (const k of columnOrder) if (!nextTableOrder.includes(k) && tableKnownSet.has(k)) nextTableOrder.push(k);

    const detailKnownSet = new Set([
      ...DEFAULT_DETAIL_FIELD_ORDER,
      ...customFields.filter((f) => f.is_active).map((f) => f.key),
    ]);
    const nextDetailOrder = newOrder.filter((k) => detailKnownSet.has(k));

    await updateSettings.mutateAsync({
      column_order: nextTableOrder,
      detail_field_order: nextDetailOrder,
    });

    const customOrder = newOrder
      .map((k) => customFields.find((f) => f.key === k))
      .filter((f): f is CustomFieldDefinition => !!f)
      .map((f, i) => ({ id: f.id, sort_order: i }));
    if (customOrder.length > 0) await reorderFields.mutateAsync(customOrder);
  };

  const resolveLabel = (row: FieldRow) => resolveFieldLabel(row.key, row.defaultLabel, overrides);

  const handleRename = async (row: FieldRow, nextLabel: string) => {
    const trimmed = nextLabel.trim();
    if (!trimmed || trimmed === resolveLabel(row)) return;
    if (row.category === "custom" && row.customDef) {
      await updateField.mutateAsync({ id: row.customDef.id, label: trimmed });
    } else {
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

  type HiddenEntry =
    | { kind: "system"; key: string; label: string; type: string; deleted: boolean }
    | { kind: "custom"; def: CustomFieldDefinition };

  const hiddenEntries = useMemo<HiddenEntry[]>(() => {
    const list: HiddenEntry[] = [];
    const orderSet = new Set(columnOrder);
    const seen = new Set<string>();
    for (const k of settings?.deleted_system_fields || []) {
      if (seen.has(k)) continue;
      const col = DEFAULT_COLUMNS.find((c) => c.key === k);
      const detail = DETAIL_FIELD_CATALOG.find((d) => d.key === k);
      if (col) { list.push({ kind: "system", key: k, label: col.label, type: col.type, deleted: true }); seen.add(k); }
      else if (detail) { list.push({ kind: "system", key: k, label: detail.label, type: detail.kind, deleted: true }); seen.add(k); }
    }
    for (const c of DEFAULT_COLUMNS) {
      if (seen.has(c.key)) continue;
      if (orderSet.has(c.key)) continue;
      if (c.key.startsWith("cf_")) continue;
      list.push({ kind: "system", key: c.key, label: c.label, type: c.type, deleted: false });
      seen.add(c.key);
    }
    for (const f of customFields.filter((f) => !f.is_active)) {
      list.push({ kind: "custom", def: f });
    }
    return list;
  }, [columnOrder, settings?.deleted_system_fields, customFields]);

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

      {hiddenEntries.length > 0 && (
        <div className="pt-4 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Hidden fields ({hiddenEntries.length})
          </div>
          <div className="space-y-2">
            {hiddenEntries.map((entry) => {
              if (entry.kind === "custom") {
                const f = entry.def;
                return (
                  <div
                    key={`custom-${f.id}`}
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
                );
              }
              return (
                <div
                  key={`sys-${entry.key}`}
                  className={cn(
                    "flex items-center justify-between p-2.5 rounded-lg border border-dashed",
                    entry.deleted ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30"
                  )}
                >
                  <div>
                    <div className="text-sm font-medium">
                      {resolveFieldLabel(entry.key, entry.label, overrides)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.deleted ? `Deleted · ${entry.type}` : entry.type}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => restoreSystem(entry.key)}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Restore
                  </Button>
                </div>
              );
            })}
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

      {systemConfigKey && (() => {
        const row = rows.find((r) => r.key === systemConfigKey);
        if (!row) return null;
        const sys = DETAIL_FIELD_CATALOG.find((d) => d.key === systemConfigKey);
        const col = DEFAULT_COLUMNS.find((c) => c.key === systemConfigKey);
        const kindToType: Record<string, "text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url"> = {
          text: "text",
          select: "select",
          "multi-select": "multi_select",
          "playbook-select": "select",
          "dual-select": "select",
          "dual-multi": "multi_select",
          "dual-playbook": "select",
          readonly: "text",
          "account-select": "select",
        };
        const colTypeMap: Record<string, "text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url"> = {
          text: "text",
          number: "number",
          date: "date",
          select: "select",
          "multi-select": "multi_select",
          badge: "text",
        };
        const defaultType = sys
          ? kindToType[sys.kind] || "text"
          : col
          ? colTypeMap[col.type] || "text"
          : "text";
        return (
          <SystemFieldConfigDialog
            open={!!systemConfigKey}
            onOpenChange={(o) => !o && setSystemConfigKey(null)}
            fieldKey={systemConfigKey}
            label={resolveLabel(row)}
            defaultType={defaultType}
            override={overrideByKey.get(systemConfigKey)}
          />
        );
      })()}

      <DeleteFieldDialog
        target={deleteTarget}
        overrides={overrides}
        customEraseCount={customEraseCount}
        systemEraseCount={systemEraseCount}
        eraseAlongDelete={eraseAlongDelete}
        onEraseAlongDeleteChange={setEraseAlongDelete}
        onClose={closeDelete}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
