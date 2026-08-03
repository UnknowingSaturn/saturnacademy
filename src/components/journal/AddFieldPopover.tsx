import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Lock } from "lucide-react";
import { buildFieldRegistry, FieldDef, resolveFieldLabel } from "@/lib/journalFields/registry";
import { useFieldLayoutActions } from "@/hooks/useFieldLayoutActions";
import { useCustomFieldDefinitions, useCreateCustomField } from "@/hooks/useCustomFields";
import { CustomFieldDialog } from "@/components/journal/settings/CustomFieldDialog";

interface Props {
  surface: "table" | "detail";
  /** Detail only — which group the field is added to. */
  groupId?: string;
  /** Table only — insert directly after this column. */
  afterKey?: string;
  trigger?: React.ReactNode;
  align?: "start" | "end" | "center";
}

/** Notion-style "+" picker: add an existing hidden/removed field, or create one. */
export function AddFieldPopover({ surface, groupId, afterKey, trigger, align = "start" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { layout, labels, showColumn, addDetailField } = useFieldLayoutActions();
  const { data: customFields = [] } = useCustomFieldDefinitions();
  const createField = useCreateCustomField();

  const registry = useMemo(() => buildFieldRegistry(customFields), [customFields]);

  const candidates = useMemo(() => {
    if (!layout) return [] as Array<FieldDef & { state: "hidden" | "removed" }>;
    const onSurface = new Set<string>(
      surface === "table"
        ? layout.table.order.filter((k) => !layout.table.hidden.includes(k))
        : layout.detail.groups.flatMap((g) => g.fields),
    );
    const removed = new Set(layout.removed);
    return registry
      .filter((f) => f.surfaces.includes(surface) && !onSurface.has(f.key))
      .map((f) => ({ ...f, state: removed.has(f.key) ? ("removed" as const) : ("hidden" as const) }))
      .filter((f) => {
        if (!query.trim()) return true;
        return resolveFieldLabel(f.key, labels).toLowerCase().includes(query.trim().toLowerCase());
      });
  }, [layout, registry, surface, query, labels]);

  const add = async (key: string) => {
    if (surface === "table") await showColumn(key, afterKey);
    else await addDetailField(key, groupId);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {trigger ?? (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add field
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent align={align} className="w-64 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields…"
            className="h-8 text-sm mb-2"
          />
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {candidates.length === 0 && (
              <div className="text-xs text-muted-foreground px-2 py-3 text-center">
                Every field is already here.
              </div>
            )}
            {candidates.map((f) => (
              <button
                key={f.key}
                onClick={() => add(f.key)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent text-left"
              >
                <span className="truncate">{resolveFieldLabel(f.key, labels)}</span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                  {f.tier === "locked" && <Lock className="w-2.5 h-2.5" />}
                  {f.state === "removed" ? "removed" : "hidden"}
                </span>
              </button>
            ))}
          </div>
          <div className="pt-2 mt-1 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start h-8 text-sm"
              onClick={() => { setOpen(false); setDialogOpen(true); }}
            >
              <Plus className="w-3.5 h-3.5 mr-2" />
              New field…
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <CustomFieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={null}
        onSubmit={async (input) => {
          await createField.mutateAsync(input);
        }}
      />
    </>
  );
}
