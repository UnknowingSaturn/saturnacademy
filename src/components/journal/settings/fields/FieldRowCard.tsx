import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  GripVertical, MoreHorizontal, Trash2, Eye, EyeOff,
  ChevronDown, Lock, Pencil, Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FieldRow } from "./constants";
import { SystemOptionsEditor } from "./SystemOptionsEditor";
import { CustomOptionsEditor } from "./CustomOptionsEditor";

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

export function FieldRowCard({
  row, label, hasOverride, inTable, inDetail,
  onRename, onResetLabel, onToggleTable, onToggleDetail,
  onDelete, onEditCustom, onConfigureSystem,
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
