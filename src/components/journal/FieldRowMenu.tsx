import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MoreHorizontal, EyeOff, Pencil, Trash2, RotateCcw, Lock, FolderInput, Columns3 } from "lucide-react";
import { FieldDef, isFieldRemovable } from "@/lib/journalFields/registry";
import { useFieldLayoutActions } from "@/hooks/useFieldLayoutActions";

interface Props {
  field: FieldDef;
  label: string;
  hasLabelOverride: boolean;
  groups: Array<{ id: string; label: string }>;
  currentGroupId: string;
  onRequestRemove: (field: FieldDef) => void;
}

/** Notion-style hover menu on a trade-detail property row. */
export function FieldRowMenu({
  field, label, hasLabelOverride, groups, currentGroupId, onRequestRemove,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const {
    hideDetailField, moveFieldToGroup, renameField, resetFieldLabel, showColumn, hideColumn, layout,
  } = useFieldLayoutActions();

  const inTable =
    !!layout && layout.table.order.includes(field.key) && !layout.table.hidden.includes(field.key);

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
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(label); setEditing(false); }
        }}
        className="h-6 text-xs w-32"
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="opacity-0 group-hover/row:opacity-60 hover:!opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
          aria-label={`${label} field options`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
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

        {groups.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="w-4 h-4 mr-2" />
              Move to group
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {groups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  disabled={g.id === currentGroupId}
                  onClick={() => moveFieldToGroup(field.key, g.id)}
                >
                  {g.label}
                  {g.id === currentGroupId && <span className="ml-auto text-xs text-primary">✓</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {field.surfaces.includes("table") && (
          <DropdownMenuItem
            onClick={() => (inTable ? hideColumn(field.key) : showColumn(field.key))}
          >
            <Columns3 className="w-4 h-4 mr-2" />
            {inTable ? "Remove from table" : "Show in table"}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => hideDetailField(field.key)}>
          <EyeOff className="w-4 h-4 mr-2" />
          Hide from detail
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
