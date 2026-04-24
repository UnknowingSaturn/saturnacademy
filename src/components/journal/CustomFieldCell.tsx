import { useState } from "react";
import { Trade } from "@/types/trading";
import { CustomFieldDefinition } from "@/types/settings";
import { useUpdateTrade } from "@/hooks/useTrades";
import { BadgeSelect } from "./BadgeSelect";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface CustomFieldCellProps {
  trade: Trade;
  field: CustomFieldDefinition;
}

// Map a hex color string to one of the BadgeSelect color keys for tinting.
function hexToColorKey(hex?: string): string {
  if (!hex) return "muted";
  const map: Record<string, string> = {
    "#22C55E": "profit",
    "#EF4444": "loss",
    "#EAB308": "breakeven",
    "#F59E0B": "newyork",
    "#3B82F6": "primary",
    "#6B7280": "muted",
    "#EC4899": "tokyo",
    "#8B5CF6": "primary",
  };
  return map[hex] || "muted";
}

export function CustomFieldCell({ trade, field }: CustomFieldCellProps) {
  const updateTrade = useUpdateTrade();
  const current = (trade as any).custom_fields?.[field.key];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(current ?? "");

  const save = async (next: any) => {
    const nextFields = { ...((trade as any).custom_fields || {}) };
    if (next === null || next === undefined || next === "") {
      delete nextFields[field.key];
    } else {
      nextFields[field.key] = next;
    }
    await updateTrade.mutateAsync({ id: trade.id, custom_fields: nextFields } as any);
  };

  if (field.type === "select" || field.type === "multi_select") {
    const options = field.options.map((o) => ({
      value: o.value,
      label: o.label,
      color: hexToColorKey(o.color),
    }));
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <BadgeSelect
          value={field.type === "multi_select" ? (current || []) : (current || "")}
          onChange={(v) => save(v)}
          options={options}
          placeholder={field.label}
          multiple={field.type === "multi_select"}
        />
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={!!current}
          onCheckedChange={(v) => save(!!v)}
        />
      </div>
    );
  }

  if (field.type === "url") {
    if (editing) {
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { save(draft || null); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { save(draft || null); setEditing(false); }
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="https://..."
            className="h-7 text-xs"
            autoFocus
          />
        </div>
      );
    }
    return (
      <div
        className="text-sm text-muted-foreground truncate cursor-pointer hover:text-foreground flex items-center gap-1"
        onClick={(e) => { e.stopPropagation(); setDraft(current || ""); setEditing(true); }}
      >
        {current ? (
          <a
            href={current}
            target="_blank"
            rel="noreferrer"
            className="text-primary truncate flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{current}</span>
          </a>
        ) : (
          "—"
        )}
      </div>
    );
  }

  // text / number / date — inline editable input
  if (editing) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Input
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const v = field.type === "number" ? (draft === "" ? null : Number(draft)) : (draft || null);
            save(v);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = field.type === "number" ? (draft === "" ? null : Number(draft)) : (draft || null);
              save(v);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 text-xs"
          autoFocus
        />
      </div>
    );
  }

  const display = current === null || current === undefined || current === "" ? "—" : String(current);
  return (
    <div
      className={cn("text-sm truncate cursor-pointer hover:text-foreground", display === "—" ? "text-muted-foreground" : "")}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(current ?? "");
        setEditing(true);
      }}
    >
      {display}
    </div>
  );
}
