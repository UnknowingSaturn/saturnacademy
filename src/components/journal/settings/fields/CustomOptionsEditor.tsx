import { useState } from "react";
import { useUpdateCustomField } from "@/hooks/useCustomFields";
import { CustomFieldDefinition } from "@/types/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLOR_PALETTE } from "./constants";

export function CustomOptionsEditor({ field }: { field: CustomFieldDefinition }) {
  const update = useUpdateCustomField();
  const [adding, setAdding] = useState("");
  const options = field.options || [];

  const setOptions = async (next: typeof options) => {
    await update.mutateAsync({ id: field.id, options: next });
  };

  const handleAdd = async () => {
    const label = adding.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${options.length + 1}`;
    const color = COLOR_PALETTE[options.length % COLOR_PALETTE.length];
    await setOptions([...options, { value, label, color }]);
    setAdding("");
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {options.map((o, idx) => (
          <div key={`${o.value}_${idx}`} className="flex items-center gap-2 p-1.5 rounded border border-border/50 bg-background">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: o.color || "#6B7280" }} />
            <Input
              value={o.label}
              onChange={(e) => {
                const next = [...options];
                next[idx] = { ...next[idx], label: e.target.value, value: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${idx + 1}` };
                setOptions(next);
              }}
              className="h-6 text-xs flex-1"
            />
            <div className="flex items-center gap-0.5">
              {COLOR_PALETTE.slice(0, 8).map((c) => (
                <button
                  key={c}
                  className={cn(
                    "w-3 h-3 rounded-full opacity-50 hover:opacity-100 transition-all",
                    o.color === c && "opacity-100 ring-1 ring-offset-1 ring-offset-background ring-foreground",
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    const next = [...options];
                    next[idx] = { ...next[idx], color: c };
                    setOptions(next);
                  }}
                />
              ))}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => setOptions(options.filter((_, i) => i !== idx))}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
        {options.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">No options yet.</p>
        )}
      </div>
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
