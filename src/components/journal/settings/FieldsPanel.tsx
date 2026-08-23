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
  useEraseSystemFieldData,
  useCountTradesWithCustomField,
  useCountTradesWithSystemField,
  useFieldOverrides,
} from "@/hooks/useCustomFields";
import {
  JournalFieldLayout,
  CustomFieldDefinition,
  resolveFieldLabel,
} from "@/types/settings";
import { buildFieldRegistry, getFieldDef, JOURNAL_FIELD_REGISTRY, resolveLabelMap } from "@/lib/journalFields/registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, MoreHorizontal, RotateCcw, Trash2, GripVertical,
  Pencil, ChevronUp, ChevronDown, Eye, EyeOff, Settings2,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CustomFieldDialog } from "./CustomFieldDialog";
import { SystemFieldConfigDialog } from "./SystemFieldConfigDialog";
import { DeleteFieldDialog, DeleteTarget } from "./fields/DeleteFieldDialog";
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
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type FieldRow = {
  key: string;
  label: string;
  category: "core" | "system" | "custom";
  description?: string;
  optionsPropertyName?: string;
  customDef?: CustomFieldDefinition;
};

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
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [eraseAlongDelete, setEraseAlongDelete] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");

  const { data: fieldOverrides = [] } = useFieldOverrides();
  const overrideByKey = useMemo(
    () => new Map(fieldOverrides.map((o) => [o.field_key, o])),
    [fieldOverrides],
  );

  const layout = settings?.journal_field_layout;
  const overrides = resolveLabelMap(settings);

  const allFields = useMemo(() => buildFieldRegistry(customFields), [customFields]);
  const allFieldMap = useMemo(() => new Map(allFields.map((f) => [f.key, f])), [allFields]);

  const customCountKey =
    deleteTarget?.kind === "custom-hard" || deleteTarget?.kind === "custom-erase"
      ? deleteTarget.field.key
      : null;
  const { data: customEraseCount = 0 } = useCountTradesWithCustomField(customCountKey);

  const systemCountKey =
    deleteTarget?.kind === "system-erasable" ? deleteTarget.field.key : null;
  const { data: systemEraseCount = 0 } = useCountTradesWithSystemField(systemCountKey);

  // Build the canonical list of all rows (table + detail candidates).
  const rows = useMemo<FieldRow[]>(() => {
    const activeCustom = customFields.filter((f) => f.is_active);
    const out: FieldRow[] = [];
    const seen = new Set<string>();
    const push = (key: string) => {
      if (seen.has(key)) return;
      const f = allFieldMap.get(key);
      if (!f) return;
      seen.add(key);
      const customDef = f.group === "custom" ? activeCustom.find((c) => c.key === key) : undefined;
      out.push({
        key,
        label: f.label,
        category: f.group,
        description: kindHint(f),
        customDef,
      });
    };
    // Preserve order from current layouts.
    for (const k of layout?.table?.order ?? []) push(k);
    for (const g of layout?.detail?.groups ?? []) for (const k of g.fields) push(k);
    for (const k of layout?.table?.hidden ?? []) push(k);
    for (const k of layout?.detail?.hidden ?? []) push(k);
    for (const f of allFields) push(f.key);
    return out;
  }, [allFields, allFieldMap, customFields, layout]);

  const saveLayout = async (raw: JournalFieldLayout) => {
    // Group membership is the source of truth for detail order; keep the
    // flattened order in sync so nothing reads a stale list.
    const detailOrder = raw.detail.groups.flatMap((g) => g.fields);
    const next: JournalFieldLayout = {
      ...raw,
      detail: { ...raw.detail, order: detailOrder },
    };
    // Derive legacy fields for backward compatibility.
    const visibleColumns = next.table.order.filter((k) => !next.table.hidden.includes(k));
    const columnOrder = next.table.order;
    const detailVisible = detailOrder.filter((k) => !next.detail.hidden.includes(k));

    await updateSettings.mutateAsync({
      journal_field_layout: next,
      visible_columns: visibleColumns,
      column_order: columnOrder,
      detail_field_order: detailOrder,
      detail_visible_fields: detailVisible,
      deleted_system_fields: next.removed,
    });
  };


  const handleTableReorder = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = tableRows.map((r) => r.key);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const nextOrder = arrayMove(ids, oldIdx, newIdx);
    const next: JournalFieldLayout = {
      ...layout!,
      table: { ...layout!.table, order: nextOrder },
    };
    await saveLayout(next);
  };

  const handleToggleTable = async (key: string) => {
    if (!layout) return;
    const isHidden = layout.table.hidden.includes(key);
    const isVisible = layout.table.order.includes(key) && !isHidden;
    let order = [...layout.table.order];
    let hidden = [...layout.table.hidden];
    if (isVisible) {
      hidden = [...hidden, key];
    } else {
      hidden = hidden.filter((k) => k !== key);
      if (!order.includes(key)) order = [...order, key];
    }
    await saveLayout({ ...layout, table: { ...layout.table, order, hidden } });
  };

  const handleToggleDetail = async (key: string) => {
    if (!layout) return;
    const groups = layout.detail.groups.map((g) => ({ ...g, fields: [...g.fields] }));
    let hidden = [...layout.detail.hidden];
    const isHidden = hidden.includes(key);
    const inGroup = groups.some((g) => g.fields.includes(key));
    if (inGroup) {
      // Remove from groups and hide.
      groups.forEach((g) => { g.fields = g.fields.filter((k) => k !== key); });
      hidden = [...hidden, key];
    } else if (isHidden) {
      hidden = hidden.filter((k) => k !== key);
      // Add to first group (or create a default one).
      if (groups.length === 0) groups.push({ id: "properties", label: "Properties", fields: [key] });
      else groups[0].fields.push(key);
    } else {
      // Not in layout yet — add to first group.
      if (groups.length === 0) groups.push({ id: "properties", label: "Properties", fields: [key] });
      else groups[0].fields.push(key);
    }
    await saveLayout({ ...layout, detail: { ...layout.detail, groups, hidden } });
  };

  const handleMoveToGroup = async (key: string, targetGroupId: string) => {
    if (!layout) return;
    const groups = layout.detail.groups.map((g) => ({ ...g, fields: [...g.fields] }));
    // Remove from current group.
    groups.forEach((g) => { g.fields = g.fields.filter((k) => k !== key); });
    const target = groups.find((g) => g.id === targetGroupId);
    if (target) target.fields.push(key);
    await saveLayout({ ...layout, detail: { ...layout.detail, groups } });
  };

  // Adds a field that lives in no detail group yet (new custom fields, or
  // fields only present in the table layout) to the chosen group.
  const handleAddFieldToGroup = async (key: string, targetGroupId: string) => {
    if (!layout) return;
    const groups = layout.detail.groups.map((g) => ({
      ...g,
      fields: g.fields.filter((k) => k !== key),
    }));
    const target = groups.find((g) => g.id === targetGroupId);
    if (!target) return;
    target.fields.push(key);
    const hidden = layout.detail.hidden.filter((k) => k !== key);
    const removed = layout.removed.filter((k) => k !== key);
    await saveLayout({ ...layout, detail: { ...layout.detail, groups, hidden }, removed });
  };



  const handleReorderWithinGroup = async (groupId: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !layout) return;
    const group = layout.detail.groups.find((g) => g.id === groupId);
    if (!group) return;
    const ids = [...group.fields];
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const groups = layout.detail.groups.map((g) =>
      g.id === groupId ? { ...g, fields: arrayMove(ids, oldIdx, newIdx) } : { ...g, fields: [...g.fields] }
    );
    await saveLayout({ ...layout, detail: { ...layout.detail, groups } });
  };

  const handleAddGroup = async () => {
    if (!layout) return;
    const id = `group_${Date.now()}`;
    const groups = [...layout.detail.groups, { id, label: "New group", fields: [] }];
    await saveLayout({ ...layout, detail: { ...layout.detail, groups } });
  };

  const handleRenameGroup = async (groupId: string, nextLabel: string) => {
    if (!layout || !nextLabel.trim()) return;
    const groups = layout.detail.groups.map((g) =>
      g.id === groupId ? { ...g, label: nextLabel.trim() } : { ...g }
    );
    await saveLayout({ ...layout, detail: { ...layout.detail, groups } });
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!layout) return;
    const group = layout.detail.groups.find((g) => g.id === groupId);
    if (!group) return;
    const groups = layout.detail.groups.filter((g) => g.id !== groupId);
    const hidden = [...layout.detail.hidden, ...group.fields];
    await saveLayout({ ...layout, detail: { ...layout.detail, groups, hidden } });
  };

  const handleRename = async (row: FieldRow, nextLabel: string) => {
    const trimmed = nextLabel.trim();
    if (!trimmed || trimmed === row.label) return;
    if (row.category === "custom" && row.customDef) {
      await updateField.mutateAsync({ id: row.customDef.id, label: trimmed });
    } else {
      // journal_field_layout.labels is the single source of truth for labels.
      if (layout) {
        await saveLayout({ ...layout, labels: { ...(layout.labels || {}), [row.key]: trimmed } });
      } else {
        await updateSettings.mutateAsync({
          field_label_overrides: { ...overrides, [row.key]: trimmed },
        });
      }
    }
  };

  const handleResetLabel = async (row: FieldRow) => {
    if (row.category === "custom") return;
    // Clear every store so a reset can't be resurrected by a legacy fallback.
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
    if (layout?.labels?.[row.key] !== undefined) {
      const nextLabels = { ...layout.labels };
      delete nextLabels[row.key];
      await saveLayout({ ...layout, labels: nextLabels });
    }
  };

  const requestDelete = (row: FieldRow) => {
    setEraseAlongDelete(false);
    if (row.category === "custom" && row.customDef) {
      setDeleteTarget({ kind: "custom-soft", field: row.customDef });
      return;
    }
    if (row.category === "core") return;
    // For system fields, treat as "soft delete" (move to removed).
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
    if (!deleteTarget || !layout) return;
    const k = deleteTarget.field.key;
    if (deleteTarget.kind === "custom-soft") {
      await updateField.mutateAsync({ id: deleteTarget.field.id, is_active: false });
    } else if (deleteTarget.kind === "custom-erase") {
      await eraseFieldData.mutateAsync(deleteTarget.field.key);
    } else if (deleteTarget.kind === "custom-hard") {
      if (eraseAlongDelete) await eraseFieldData.mutateAsync(deleteTarget.field.key);
      await deleteField.mutateAsync(deleteTarget.field.id);
    } else {
      // system-soft or system-erasable: move to removed and hide everywhere.
      const tableOrder = layout.table.order.filter((c) => c !== k);
      const tableHidden = layout.table.hidden.filter((c) => c !== k);
      const groups = layout.detail.groups.map((g) => ({ ...g, fields: g.fields.filter((f) => f !== k) }));
      const detailHidden = layout.detail.hidden.filter((c) => c !== k);
      const removed = [...new Set([...layout.removed, k])];
      await saveLayout({
        ...layout,
        table: { order: tableOrder, hidden: tableHidden },
        detail: { ...layout.detail, groups, hidden: detailHidden },
        removed,
      });
      if (eraseAlongDelete && deleteTarget.kind === "system-erasable") {
        await eraseSystemData.mutateAsync(k);
      }
    }
    closeDelete();
  };

  const restoreSystem = async (key: string) => {
    if (!layout) return;
    const removed = layout.removed.filter((k) => k !== key);
    const tableOrder = layout.table.order.includes(key) ? layout.table.order : [...layout.table.order, key];
    const tableHidden = layout.table.hidden.filter((k) => k !== key);
    const groups = layout.detail.groups.map((g) => ({ ...g, fields: [...g.fields] }));
    const inDetail = groups.some((g) => g.fields.includes(key)) || layout.detail.hidden.includes(key);
    if (!inDetail) {
      if (groups.length === 0) groups.push({ id: "properties", label: "Properties", fields: [key] });
      else groups[0].fields.push(key);
    }
    await saveLayout({
      ...layout,
      table: { order: tableOrder, hidden: tableHidden },
      detail: { ...layout.detail, groups },
      removed,
    });
  };

  const restoreCustom = async (f: CustomFieldDefinition) => {
    await updateField.mutateAsync({ id: f.id, is_active: true });
  };

  const tableRows = useMemo(
    () => rows.filter((r) => {
      const f = allFieldMap.get(r.key);
      return f && f.surfaces.includes("table");
    }),
    [rows, allFieldMap],
  );

  const detailRows = useMemo(
    () => rows.filter((r) => {
      const f = allFieldMap.get(r.key);
      return f && f.surfaces.includes("detail");
    }),
    [rows, allFieldMap],
  );

  // Detail-capable fields that sit in no group yet — offered by each group's
  // "Add field" picker so nothing can be stranded in the table layout.
  const addableDetailRows = useMemo(() => {
    if (!layout) return [] as FieldRow[];
    const inGroup = new Set(layout.detail.groups.flatMap((g) => g.fields));
    const removed = new Set(layout.removed);
    return detailRows.filter((r) => !inGroup.has(r.key) && !removed.has(r.key));
  }, [detailRows, layout]);



  // Only *truly* removed things belong in the trash section. Fields that are
  // merely hidden on one surface stay in the main list with their toggles off,
  // which is what made the old panel confusing (rows offering "Restore" for
  // fields that were already present elsewhere).
  const deletedEntries = useMemo(() => {
    if (!layout) return [];
    const out: Array<{ kind: "system" | "custom"; key: string; label: string; category: "core" | "system" | "custom" }> = [];
    const seen = new Set<string>();
    for (const k of layout.removed) {
      if (seen.has(k)) continue;
      const f = allFieldMap.get(k);
      if (!f) continue;
      seen.add(k);
      out.push({ kind: "system", key: k, label: resolveFieldLabel(k, f.label, overrides), category: f.group });
    }
    for (const f of customFields.filter((c) => !c.is_active)) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      out.push({ kind: "custom", key: f.key, label: f.label, category: "custom" });
    }
    return out;
  }, [layout, allFieldMap, overrides, customFields]);

  // The unified list: every live field, in table order first, then the rest.
  const unifiedRows = useMemo(() => {
    if (!layout) return rows;
    const removed = new Set(layout.removed);
    const live = rows.filter((r) => !removed.has(r.key));
    const orderIdx = new Map(layout.table.order.map((k, i) => [k, i]));
    return [...live].sort((a, b) => {
      const ai = orderIdx.has(a.key) ? orderIdx.get(a.key)! : Number.MAX_SAFE_INTEGER;
      const bi = orderIdx.has(b.key) ? orderIdx.get(b.key)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [rows, layout]);

  const handleUnifiedReorder = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !layout) return;
    const ids = unifiedRows.map((r) => r.key);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const nextAll = arrayMove(ids, oldIdx, newIdx);
    // Persist only keys that can live in the table, preserving the new order.
    const tableSet = new Set(layout.table.order);
    const nextOrder = nextAll.filter((k) => tableSet.has(k));
    await saveLayout({ ...layout, table: { ...layout.table, order: nextOrder } });
  };


  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (loadingSettings || loadingFields) {
    return <div className="p-4 text-center text-muted-foreground">Loading fields…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Fields</h3>
          <p className="text-sm text-muted-foreground">
            Reorder, rename, hide, and group fields. Table columns and detail groups are independent.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditingField(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />
          Add custom field
        </Button>
      </div>

      {/* Detail groups (sections) — compact manager above the field list. */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">Detail sections</div>
          <Button variant="ghost" size="sm" onClick={handleAddGroup}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add section
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(layout?.detail?.groups ?? []).map((group) => (
            <div key={group.id} className="flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1">
              {editingGroupId === group.id ? (
                <Input
                  autoFocus
                  value={groupDraft}
                  onChange={(e) => setGroupDraft(e.target.value)}
                  onBlur={() => { handleRenameGroup(group.id, groupDraft); setEditingGroupId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { handleRenameGroup(group.id, groupDraft); setEditingGroupId(null); }
                    if (e.key === "Escape") setEditingGroupId(null);
                  }}
                  className="h-6 w-32 text-xs"
                />
              ) : (
                <button
                  className="text-xs hover:underline decoration-dotted underline-offset-4"
                  onClick={() => { setEditingGroupId(group.id); setGroupDraft(group.label); }}
                >
                  {group.label}
                </button>
              )}
              <span className="text-[10px] text-muted-foreground">{group.fields.length}</span>
              <button
                className="text-muted-foreground hover:text-destructive"
                title="Delete section (fields move to hidden)"
                onClick={() => handleDeleteGroup(group.id)}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Unified field list: one row per field, toggles per surface. */}
      <div className="rounded-lg border border-border">
        <div className="flex items-center gap-3 px-3 py-2 border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
          <span className="flex-1">Field</span>
          <span className="w-16 text-center">Table</span>
          <span className="w-16 text-center">Detail</span>
          <span className="w-36">Section</span>
          <span className="w-8" />
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleUnifiedReorder}>
          <SortableContext items={unifiedRows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
            <div>
              {unifiedRows.map((row) => {
                const def = allFieldMap.get(row.key);
                const supportsTable = !!def?.surfaces.includes("table");
                const supportsDetail = !!def?.surfaces.includes("detail");
                const groupId = layout?.detail.groups.find((g) => g.fields.includes(row.key))?.id ?? null;
                return (
                  <UnifiedFieldRow
                    key={row.key}
                    row={row}
                    label={resolveFieldLabel(row.key, row.label, overrides)}
                    hasOverride={!!overrides[row.key] || !!layout?.labels?.[row.key]}
                    supportsTable={supportsTable}
                    supportsDetail={supportsDetail}
                    inTable={!!layout && layout.table.order.includes(row.key) && !layout.table.hidden.includes(row.key)}
                    inDetail={!!groupId}
                    groupId={groupId}
                    groups={layout?.detail.groups ?? []}
                    onRename={(next) => handleRename(row, next)}
                    onResetLabel={() => handleResetLabel(row)}
                    onToggleTable={() => handleToggleTable(row.key)}
                    onToggleDetail={() => handleToggleDetail(row.key)}
                    onMoveToGroup={(gid) => handleAddFieldToGroup(row.key, gid)}
                    onDelete={() => requestDelete(row)}
                    onEditCustom={() => { if (row.customDef) { setEditingField(row.customDef); setDialogOpen(true); } }}
                    onConfigureSystem={() => setSystemConfigKey(row.key)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {deletedEntries.length > 0 && (
        <div className="pt-4 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Deleted fields ({deletedEntries.length})
          </div>
          <div className="space-y-2">
            {deletedEntries.map((entry) => (
              <div
                key={entry.key}
                className="flex items-center justify-between p-2.5 rounded-lg border border-dashed border-destructive/40 bg-destructive/5"
              >
                <div>
                  <div className="text-sm font-medium">{entry.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {entry.category === "core" ? "Core" : entry.category === "custom" ? "Custom" : "System"} · deleted
                  </div>
                </div>
                {entry.kind === "custom" ? (
                  <Button variant="ghost" size="sm" onClick={() => restoreCustom(customFields.find((f) => f.key === entry.key)!)}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Restore
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => restoreSystem(entry.key)}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Restore
                  </Button>
                )}
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

      {systemConfigKey && (() => {
        const row = rows.find((r) => r.key === systemConfigKey);
        if (!row) return null;
        const f = allFieldMap.get(systemConfigKey);
        const kindToType: Record<string, "text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url"> = {
          text: "text",
          select: "select",
          multi_select: "multi_select",
          playbook: "select",
          account: "select",
          money: "number",
          percent: "number",
          number: "number",
          duration: "number",
          date: "date",
          badge: "text",
          readonly: "text",
        };
        return (
          <SystemFieldConfigDialog
            open={!!systemConfigKey}
            onOpenChange={(o) => !o && setSystemConfigKey(null)}
            fieldKey={systemConfigKey}
            label={resolveFieldLabel(systemConfigKey, row.label, overrides)}
            defaultType={kindToType[f?.valueType || "text"] || "text"}
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

function UnifiedFieldRow({
  row, label, hasOverride, supportsTable, supportsDetail, inTable, inDetail,
  groupId, groups, onRename, onResetLabel, onToggleTable, onToggleDetail,
  onMoveToGroup, onDelete, onEditCustom, onConfigureSystem,
}: {
  row: FieldRow;
  label: string;
  hasOverride: boolean;
  supportsTable: boolean;
  supportsDetail: boolean;
  inTable: boolean;
  inDetail: boolean;
  groupId: string | null;
  groups: JournalFieldLayout["detail"]["groups"];
  onRename: (next: string) => void;
  onResetLabel: () => void;
  onToggleTable: () => void;
  onToggleDetail: () => void;
  onMoveToGroup: (groupId: string) => void;
  onDelete: () => void;
  onEditCustom?: () => void;
  onConfigureSystem?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.key });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const commit = () => {
    if (draft.trim() && draft !== label) onRename(draft.trim());
    setEditing(false);
  };

  const isCore = row.category === "core";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors",
        isDragging && "opacity-50 bg-muted",
      )}
    >
      <button {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing shrink-0">
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
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => { setDraft(label); setEditing(true); }}
              className="font-medium text-left text-sm truncate hover:underline decoration-dotted underline-offset-4"
              title={label}
            >
              {label}
            </button>
            {isCore && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0 rounded text-[10px] border border-border bg-muted/50 shrink-0">
                <Lock className="w-2.5 h-2.5" /> Core
              </span>
            )}
            {row.category === "custom" && (
              <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] border border-border bg-muted/50 shrink-0">Custom</span>
            )}
            {hasOverride && (
              <button onClick={onResetLabel} className="text-[10px] text-primary hover:underline shrink-0" title="Reset to default name">
                reset
              </button>
            )}
          </div>
        )}
        {row.description && <div className="text-[11px] text-muted-foreground">{row.description}</div>}
      </div>

      <div className="w-16 flex justify-center">
        {supportsTable ? (
          <Switch checked={inTable} onCheckedChange={onToggleTable} />
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>

      <div className="w-16 flex justify-center">
        {supportsDetail ? (
          <Switch checked={inDetail} onCheckedChange={onToggleDetail} />
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>

      <div className="w-36">
        {supportsDetail && inDetail ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-full justify-start text-xs truncate">
                {groups.find((g) => g.id === groupId)?.label ?? "Unassigned"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {groups.map((g) => (
                <DropdownMenuItem key={g.id} onClick={() => onMoveToGroup(g.id)}>
                  {g.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="text-[10px] text-muted-foreground pl-2">—</span>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => { setDraft(label); setEditing(true); }}>
            <Pencil className="w-4 h-4 mr-2" /> Rename
          </DropdownMenuItem>
          {row.category === "custom" && onEditCustom && (
            <DropdownMenuItem onClick={onEditCustom}>
              <Pencil className="w-4 h-4 mr-2" /> Edit field & change type…
            </DropdownMenuItem>
          )}
          {onConfigureSystem && row.category !== "custom" && (
            <DropdownMenuItem onClick={onConfigureSystem}>
              <Settings2 className="w-4 h-4 mr-2" /> Configure type & options…
            </DropdownMenuItem>
          )}
          {!isCore && (
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="w-4 h-4 mr-2" /> Delete field
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}


function kindHint(f: import("@/lib/journalFields/registry").FieldDef): string {
  switch (f.valueType) {
    case "readonly": return "Auto-filled";
    case "select": return "Single select";
    case "multi_select": return "Multi-select";
    case "playbook": return "Playbook";
    case "account": return "Account";
    case "text": return "Text";
    case "number": return "Number";
    case "money": return "Money";
    case "percent": return "Percent";
    case "duration": return "Duration";
    case "date": return "Date";
    case "badge": return "Badge";
    default: return "";
  }
}

function canEraseSystemField(key: string): boolean {
  // Only erasable system fields have actual trade data that can be wiped.
  const f = getFieldDef(key);
  return !!f && f.group === "system" && f.erasable;
}
