import { useMemo } from "react";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import { useCustomFieldDefinitions } from "@/hooks/useCustomFields";
import {
  DETAIL_FIELD_CATALOG,
  DETAIL_SECTION_CATALOG,
  DEFAULT_DETAIL_FIELD_ORDER,
  DEFAULT_DETAIL_VISIBLE_FIELDS,
  DEFAULT_DETAIL_SECTION_ORDER,
  DEFAULT_DETAIL_VISIBLE_SECTIONS,
} from "@/types/settings";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, GripVertical, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface RowProps {
  id: string;
  label: string;
  sublabel?: string;
  isVisible: boolean;
  onToggle: () => void;
}

function SortableRow({ id, label, sublabel, isVisible, onToggle }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 transition-colors",
        !isVisible && "opacity-60",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing">
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
      </div>
      {isVisible ? <Eye className="w-4 h-4 text-muted-foreground" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
      <Switch checked={isVisible} onCheckedChange={onToggle} />
    </div>
  );
}

export function DetailLayoutPanel() {
  const { data: settings, isLoading } = useUserSettings();
  const { data: customFields = [] } = useCustomFieldDefinitions();
  const updateSettings = useUpdateUserSettings();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Properties (sidebar fields) — system catalog + active custom fields
  const fieldOrder = useMemo(() => {
    const userOrder = settings?.detail_field_order?.length ? settings.detail_field_order : DEFAULT_DETAIL_FIELD_ORDER;
    const customKeys = customFields.filter(f => f.is_active).map(f => f.key);
    const known = new Set([...DEFAULT_DETAIL_FIELD_ORDER, ...customKeys]);
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const key of userOrder) {
      if (known.has(key) && !seen.has(key)) { ordered.push(key); seen.add(key); }
    }
    // Append anything missing (e.g. newly-created custom fields)
    for (const key of [...DEFAULT_DETAIL_FIELD_ORDER, ...customKeys]) {
      if (!seen.has(key)) ordered.push(key);
    }
    return ordered;
  }, [settings?.detail_field_order, customFields]);

  const visibleFields = useMemo(() => {
    if (!settings) return new Set(DEFAULT_DETAIL_VISIBLE_FIELDS);
    if (settings.detail_visible_fields.length === 0) {
      // First-time user: show defaults + all active custom fields
      return new Set([...DEFAULT_DETAIL_VISIBLE_FIELDS, ...customFields.filter(f => f.is_active).map(f => f.key)]);
    }
    return new Set(settings.detail_visible_fields);
  }, [settings, customFields]);

  const fieldLabel = (key: string): { label: string; sub?: string } => {
    const cat = DETAIL_FIELD_CATALOG.find(f => f.key === key);
    if (cat) return { label: cat.label, sub: kindHint(cat.kind) };
    const custom = customFields.find(f => f.key === key);
    if (custom) return { label: custom.label, sub: `Custom · ${custom.type}` };
    return { label: key };
  };

  const handleFieldToggle = async (key: string) => {
    const current = Array.from(visibleFields);
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    await updateSettings.mutateAsync({ detail_visible_fields: next });
  };

  const handleFieldDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = fieldOrder.indexOf(String(active.id));
    const newIdx = fieldOrder.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(fieldOrder, oldIdx, newIdx);
    await updateSettings.mutateAsync({ detail_field_order: next });
  };

  // Sections (review blocks)
  const sectionOrder = useMemo(() => {
    const userOrder = settings?.detail_section_order?.length ? settings.detail_section_order : DEFAULT_DETAIL_SECTION_ORDER;
    const known = new Set<string>(DEFAULT_DETAIL_SECTION_ORDER as string[]);
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const k of userOrder) if (known.has(k) && !seen.has(k)) { ordered.push(k); seen.add(k); }
    for (const k of DEFAULT_DETAIL_SECTION_ORDER) if (!seen.has(k)) ordered.push(k);
    return ordered;
  }, [settings?.detail_section_order]);

  const visibleSections = useMemo(() => {
    if (!settings) return new Set(DEFAULT_DETAIL_VISIBLE_SECTIONS);
    if (settings.detail_visible_sections.length === 0) return new Set(DEFAULT_DETAIL_VISIBLE_SECTIONS);
    return new Set(settings.detail_visible_sections);
  }, [settings]);

  const handleSectionToggle = async (key: string) => {
    const current = Array.from(visibleSections);
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    await updateSettings.mutateAsync({ detail_visible_sections: next });
  };

  const handleSectionDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = sectionOrder.indexOf(String(active.id));
    const newIdx = sectionOrder.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(sectionOrder, oldIdx, newIdx);
    await updateSettings.mutateAsync({ detail_section_order: next });
  };

  const handleResetAll = async () => {
    await updateSettings.mutateAsync({
      detail_visible_fields: [],
      detail_field_order: [],
      detail_visible_sections: [],
      detail_section_order: [],
    });
  };

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Loading layout…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">Trade Detail Layout</h3>
          <p className="text-sm text-muted-foreground">
            Show, hide, and reorder what appears inside each trade journal entry — both the right-hand
            properties sidebar and the main review sections.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleResetAll}>
          <RotateCcw className="w-3.5 h-3.5 mr-1" />
          Reset to defaults
        </Button>
      </div>

      {/* Properties sidebar */}
      <section className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Properties sidebar
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFieldDragEnd}>
          <SortableContext items={fieldOrder} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {fieldOrder.map((key) => {
                const { label, sub } = fieldLabel(key);
                return (
                  <SortableRow
                    key={key}
                    id={key}
                    label={label}
                    sublabel={sub}
                    isVisible={visibleFields.has(key)}
                    onToggle={() => handleFieldToggle(key)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      {/* Review sections */}
      <section className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Review sections
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
          <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {sectionOrder.map((key) => {
                const cat = DETAIL_SECTION_CATALOG.find(s => s.key === (key as any));
                if (!cat) return null;
                return (
                  <SortableRow
                    key={key}
                    id={key}
                    label={cat.label}
                    isVisible={visibleSections.has(key)}
                    onToggle={() => handleSectionToggle(key)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    </div>
  );
}

function kindHint(kind: string): string {
  switch (kind) {
    case 'readonly':         return 'Auto-filled';
    case 'select':           return 'Single select';
    case 'multi-select':     return 'Multi-select';
    case 'playbook-select':  return 'Playbook';
    case 'dual-playbook':    return 'Planned + Actual playbook';
    case 'dual-select':      return 'Planned + Actual select';
    case 'dual-multi':       return 'Planned + Actual multi-select';
    case 'text':             return 'Text';
    case 'account-select':   return 'Account picker';
    default:                  return '';
  }
}
