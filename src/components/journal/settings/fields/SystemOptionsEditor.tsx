import { useState } from "react";
import {
  usePropertyOptions,
  useCreatePropertyOption,
  useUpdatePropertyOption,
  useDeletePropertyOption,
  useReorderPropertyOptions,
} from "@/hooks/useUserSettings";
import { PropertyOption } from "@/types/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GripVertical, Plus, Eye, EyeOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { COLOR_PALETTE } from "./constants";
import { ColorSwatchPicker } from "./ColorSwatchPicker";

export function SystemOptionsEditor({ propertyName }: { propertyName: string }) {
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
