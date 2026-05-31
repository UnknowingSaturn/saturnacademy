import { useState } from "react";
import { useUpdateCustomField } from "@/hooks/useCustomFields";
import { CustomFieldDefinition } from "@/types/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import { COLOR_PALETTE } from "./constants";
import { ColorSwatchPicker } from "./ColorSwatchPicker";

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
            <ColorSwatchPicker
              size="sm"
              value={o.color}
              onChange={(c) => {
                const next = [...options];
                next[idx] = { ...next[idx], color: c };
                setOptions(next);
              }}
            />
            <Input
              value={o.label}
              onChange={(e) => {
                const next = [...options];
                next[idx] = { ...next[idx], label: e.target.value, value: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${idx + 1}` };
                setOptions(next);
              }}
              className="h-6 text-xs flex-1"
            />
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
