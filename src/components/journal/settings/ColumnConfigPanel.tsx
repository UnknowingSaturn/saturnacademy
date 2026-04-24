import { useMemo, useState } from "react";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import {
  useCustomFieldDefinitions,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
  useEraseCustomFieldData,
  useReorderCustomFields,
  useCountTradesWithCustomField,
} from "@/hooks/useCustomFields";
import { DEFAULT_COLUMNS, DEFAULT_VISIBLE_COLUMNS, ColumnDefinition, CustomFieldDefinition, customFieldToColumn } from "@/types/settings";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GripVertical, Eye, EyeOff, Plus, MoreHorizontal, Pencil, Trash2, RotateCcw, EraserIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CustomFieldDialog } from "./CustomFieldDialog";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface RowProps {
  column: ColumnDefinition;
  isVisible: boolean;
  isCustom: boolean;
  customDef?: CustomFieldDefinition;
  overrideLabel?: string;
  onToggleVisible: () => void;
  onRename: (next: string) => void;
  onResetLabel: () => void;
  onEditCustom?: () => void;
  onSoftDeleteCustom?: () => void;
  onEraseCustomData?: () => void;
  onHardDeleteCustom?: () => void;
}

function SortableColumnRow(props: RowProps) {
  const {
    column,
    isVisible,
    isCustom,
    customDef,
    overrideLabel,
    onToggleVisible,
    onRename,
    onResetLabel,
    onEditCustom,
    onSoftDeleteCustom,
    onEraseCustomData,
    onHardDeleteCustom,
  } = props;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(column.label);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const startEdit = () => {
    setDraft(column.label);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== column.label) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 transition-colors",
        !isVisible && "opacity-50",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing">
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-7 text-sm"
            autoFocus
          />
        ) : (
          <button
            onClick={startEdit}
            className="font-medium text-left hover:underline decoration-dotted underline-offset-4"
          >
            {column.label}
          </button>
        )}
        <div className="text-xs text-muted-foreground">
          {isCustom ? "Custom · " : ""}
          {column.type}
          {overrideLabel && !isCustom && <button onClick={onResetLabel} className="ml-2 text-primary hover:underline">reset name</button>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isVisible ? (
          <Eye className="w-4 h-4 text-muted-foreground" />
        ) : (
          <EyeOff className="w-4 h-4 text-muted-foreground" />
        )}
        <Switch checked={isVisible} onCheckedChange={onToggleVisible} />

        {isCustom && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {customDef?.is_active ? (
                <>
                  <DropdownMenuItem onClick={onEditCustom}>
                    <Pencil className="w-4 h-4 mr-2" />
                    Edit options
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onSoftDeleteCustom} className="text-destructive">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Hide column (keep data)
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onClick={onSoftDeleteCustom}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Restore column
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onEraseCustomData} className="text-destructive">
                    <EraserIcon className="w-4 h-4 mr-2" />
                    Erase data from all trades
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onHardDeleteCustom} className="text-destructive">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Permanently delete column
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

export function ColumnConfigPanel() {
  const { data: settings, isLoading: loadingSettings } = useUserSettings();
  const { data: customFields = [], isLoading: loadingFields } = useCustomFieldDefinitions();
  const updateSettings = useUpdateUserSettings();
  const createField = useCreateCustomField();
  const updateField = useUpdateCustomField();
  const deleteField = useDeleteCustomField();
  const eraseFieldData = useEraseCustomFieldData();
  const reorderFields = useReorderCustomFields();

  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [eraseTarget, setEraseTarget] = useState<CustomFieldDefinition | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<CustomFieldDefinition | null>(null);

  const { data: eraseCount = 0 } = useCountTradesWithCustomField(eraseTarget?.key || hardDeleteTarget?.key || null);

  const visibleColumns = settings?.visible_columns || DEFAULT_VISIBLE_COLUMNS;
  const columnOrder: string[] = (settings?.column_order as string[]) || DEFAULT_VISIBLE_COLUMNS;
  const overrides = settings?.column_overrides || {};

  // Build the merged ordered list of system + active custom columns, then any unordered ones at the end.
  const orderedColumns = useMemo(() => {
    const activeCustomCols = customFields
      .filter((f) => f.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(customFieldToColumn);
    const all = [...DEFAULT_COLUMNS, ...activeCustomCols];
    const byKey = new Map(all.map((c) => [c.key, c]));
    const seen = new Set<string>();
    const ordered: ColumnDefinition[] = [];
    for (const key of columnOrder) {
      const c = byKey.get(key);
      if (c && !seen.has(key)) {
        ordered.push(c);
        seen.add(key);
      }
    }
    for (const c of all) {
      if (!seen.has(c.key)) ordered.push(c);
    }
    return ordered.map((c) => {
      const ov = overrides[c.key];
      return ov?.label ? { ...c, label: ov.label } : c;
    });
  }, [customFields, columnOrder, overrides]);

  const inactiveFields = customFields.filter((f) => !f.is_active);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedColumns.findIndex((c) => c.key === active.id);
    const newIndex = orderedColumns.findIndex((c) => c.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrder = arrayMove(orderedColumns, oldIndex, newIndex).map((c) => c.key);
    await updateSettings.mutateAsync({ column_order: newOrder });

    // Also persist sort_order for custom fields based on their relative order
    const customOrder = newOrder
      .map((k) => customFields.find((f) => f.key === k))
      .filter((f): f is CustomFieldDefinition => !!f)
      .map((f, i) => ({ id: f.id, sort_order: i }));
    if (customOrder.length > 0) {
      await reorderFields.mutateAsync(customOrder);
    }
  };

  const handleToggleVisible = async (key: string) => {
    const next = visibleColumns.includes(key)
      ? visibleColumns.filter((c) => c !== key)
      : [...visibleColumns, key];
    await updateSettings.mutateAsync({ visible_columns: next });
  };

  const handleRename = async (key: string, label: string) => {
    const isCustom = key.startsWith("cf_");
    if (isCustom) {
      const f = customFields.find((cf) => cf.key === key);
      if (f) await updateField.mutateAsync({ id: f.id, label });
    } else {
      const next = { ...overrides, [key]: { ...(overrides[key] || {}), label } };
      await updateSettings.mutateAsync({ column_overrides: next });
    }
  };

  const handleResetLabel = async (key: string) => {
    const next = { ...overrides };
    if (next[key]) {
      const { label, ...rest } = next[key];
      if (Object.keys(rest).length === 0) delete next[key];
      else next[key] = rest;
    }
    await updateSettings.mutateAsync({ column_overrides: next });
  };

  const handleCreate = async (input: { label: string; type: any; options: any[] }) => {
    await createField.mutateAsync(input);
  };

  const handleEditSubmit = async (input: { label: string; type: any; options: any[] }) => {
    if (!editingField) return;
    await updateField.mutateAsync({ id: editingField.id, label: input.label, options: input.options });
    setEditingField(null);
  };

  const handleSoftDelete = async (f: CustomFieldDefinition) => {
    await updateField.mutateAsync({ id: f.id, is_active: !f.is_active });
    if (f.is_active) {
      // Also remove from visible_columns to clean up
      const next = visibleColumns.filter((k) => k !== f.key);
      if (next.length !== visibleColumns.length) {
        await updateSettings.mutateAsync({ visible_columns: next });
      }
    }
  };

  if (loadingSettings || loadingFields) {
    return <div className="p-4 text-center text-muted-foreground">Loading columns...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Columns</h3>
          <p className="text-sm text-muted-foreground">
            Drag to reorder. Click a name to rename. Toggle to hide.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditingField(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />
          Add column
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedColumns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {orderedColumns.map((col) => {
              const isCustom = col.key.startsWith("cf_");
              const customDef = isCustom ? customFields.find((f) => f.key === col.key) : undefined;
              return (
                <SortableColumnRow
                  key={col.key}
                  column={col}
                  isVisible={visibleColumns.includes(col.key)}
                  isCustom={isCustom}
                  customDef={customDef}
                  overrideLabel={overrides[col.key]?.label}
                  onToggleVisible={() => handleToggleVisible(col.key)}
                  onRename={(next) => handleRename(col.key, next)}
                  onResetLabel={() => handleResetLabel(col.key)}
                  onEditCustom={() => { if (customDef) { setEditingField(customDef); setDialogOpen(true); } }}
                  onSoftDeleteCustom={() => customDef && handleSoftDelete(customDef)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Inactive (soft-deleted) custom columns */}
      {inactiveFields.length > 0 && (
        <div className="pt-4 border-t border-border">
          <button
            onClick={() => setShowInactive((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {showInactive ? "Hide" : "Show"} {inactiveFields.length} hidden column
            {inactiveFields.length === 1 ? "" : "s"}
          </button>

          {showInactive && (
            <div className="mt-3 space-y-2">
              {inactiveFields.map((f) => (
                <SortableColumnRow
                  key={f.id}
                  column={customFieldToColumn(f)}
                  isVisible={false}
                  isCustom={true}
                  customDef={f}
                  onToggleVisible={() => handleSoftDelete(f)}
                  onRename={(next) => updateField.mutateAsync({ id: f.id, label: next })}
                  onResetLabel={() => {}}
                  onSoftDeleteCustom={() => handleSoftDelete(f)}
                  onEraseCustomData={() => setEraseTarget(f)}
                  onHardDeleteCustom={() => setHardDeleteTarget(f)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <CustomFieldDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingField(null); }}
        initial={editingField}
        onSubmit={editingField ? handleEditSubmit : handleCreate}
      />

      {/* Erase data confirmation */}
      <AlertDialog open={!!eraseTarget} onOpenChange={(o) => !o && setEraseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase data for "{eraseTarget?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the value for this column from{" "}
              <strong>{eraseCount}</strong> trade{eraseCount === 1 ? "" : "s"}. The column definition stays in
              place — restore it any time. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (eraseTarget) await eraseFieldData.mutateAsync(eraseTarget.key);
                setEraseTarget(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Erase {eraseCount} value{eraseCount === 1 ? "" : "s"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hard delete confirmation */}
      <AlertDialog open={!!hardDeleteTarget} onOpenChange={(o) => !o && setHardDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete "{hardDeleteTarget?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The column definition will be removed. <strong>{eraseCount}</strong> trade
              {eraseCount === 1 ? " still has" : "s still have"} a value for it — those values will become
              orphaned (hidden but not erased). Use "Erase data" first if you want a clean wipe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (hardDeleteTarget) await deleteField.mutateAsync(hardDeleteTarget.id);
                setHardDeleteTarget(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete column
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
