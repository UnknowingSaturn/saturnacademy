import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ChevronDown, ArrowUp, ArrowDown, EyeOff, Settings2, Pencil,
  ArrowLeft, ArrowRight, Trash2, RotateCcw, Lock,
} from "lucide-react";
import { FieldDef, isFieldRemovable } from "@/lib/journalFields/registry";
import { useFieldLayoutActions } from "@/hooks/useFieldLayoutActions";

interface Props {
  field: FieldDef;
  label: string;
  hasLabelOverride: boolean;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  onSort: (column: string, direction: "asc" | "desc") => void;
  onEditProperty?: (propertyName: string) => void;
  onConfigure?: (key: string) => void;
  onRequestRemove: (field: FieldDef) => void;
}

/** Notion-style column header: rename in place, reorder, hide, remove, edit options. */
export function FieldHeaderMenu({
  field, label, hasLabelOverride, sortColumn, sortDirection,
  onSort, onEditProperty, onConfigure, onRequestRemove,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const { hideColumn, moveColumn, renameField, resetFieldLabel } = useFieldLayoutActions();

  const isAsc = sortColumn === field.key && sortDirection === "asc";
  const isDesc = sortColumn === field.key && sortDirection === "desc";

  const commit = () => {
    const next = draft.trim();
    if (next && next !== label) renameField(field.key, next);
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(label); setEditing(false); }
        }}
        className="h-6 text-xs"
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 hover:text-foreground transition-colors group max-w-full">
          <span className="truncate">{label}</span>
          <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          {isAsc && <ArrowUp className="w-3 h-3 text-primary shrink-0" />}
          {isDesc && <ArrowDown className="w-3 h-3 text-primary shrink-0" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => onSort(field.key, "asc")}>
          <ArrowUp className="w-4 h-4 mr-2" />
          Sort ascending
          {isAsc && <span className="ml-auto text-xs text-primary">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSort(field.key, "desc")}>
          <ArrowDown className="w-4 h-4 mr-2" />
          Sort descending
          {isDesc && <span className="ml-auto text-xs text-primary">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => { setDraft(label); setEditing(true); }}>
          <Pencil className="w-4 h-4 mr-2" />
          Rename
        </DropdownMenuItem>
        {hasLabelOverride && (
          <DropdownMenuItem onClick={() => resetFieldLabel(field.key)}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset name
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={() => moveColumn(field.key, -1)}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => moveColumn(field.key, 1)}>
          <ArrowRight className="w-4 h-4 mr-2" />
          Move right
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {field.optionsProperty && onEditProperty && (
          <DropdownMenuItem onClick={() => onEditProperty(field.optionsProperty!)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Edit options
          </DropdownMenuItem>
        )}
        {onConfigure && field.group !== "custom" && (
          <DropdownMenuItem onClick={() => onConfigure(field.key)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Configure type & options…
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={() => hideColumn(field.key)}>
          <EyeOff className="w-4 h-4 mr-2" />
          Hide column
        </DropdownMenuItem>

        {isFieldRemovable(field) ? (
          <DropdownMenuItem onClick={() => onRequestRemove(field)} className="text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />
            Remove field
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <Lock className="w-4 h-4 mr-2" />
            Locked field — hide only
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
