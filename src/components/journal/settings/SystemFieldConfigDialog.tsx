import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomFieldOption, CustomFieldType } from "@/types/settings";
import { useUpsertFieldOverride, useDeleteFieldOverride, FieldOverride } from "@/hooks/useFieldOverrides";
import { Plus, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fieldKey: string;
  label: string;
  defaultType: CustomFieldType;
  override?: FieldOverride;
}

const FIELD_TYPES: { value: CustomFieldType; label: string; hint: string }[] = [
  { value: "text", label: "Text", hint: "Free-form short text" },
  { value: "number", label: "Number", hint: "Numeric values" },
  { value: "select", label: "Select", hint: "Pick one from a list" },
  { value: "multi_select", label: "Multi-select", hint: "Pick multiple" },
  { value: "date", label: "Date", hint: "Calendar date" },
  { value: "checkbox", label: "Checkbox", hint: "Yes / no" },
  { value: "url", label: "URL", hint: "Clickable link" },
];

const COLOR_PALETTE = [
  "#EF4444", "#F59E0B", "#22C55E", "#3B82F6", "#8B5CF6", "#EC4899", "#6B7280",
];

export function SystemFieldConfigDialog({ open, onOpenChange, fieldKey, label, defaultType, override }: Props) {
  const upsert = useUpsertFieldOverride();
  const reset = useDeleteFieldOverride();
  const [type, setType] = useState<CustomFieldType>(defaultType);
  const [options, setOptions] = useState<CustomFieldOption[]>([]);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    if (open) {
      setType(override?.type ?? defaultType);
      setOptions(override?.options ?? []);
      setAdding("");
    }
  }, [open, override, defaultType]);

  const isOptionType = type === "select" || type === "multi_select";

  const addOption = () => {
    const labelText = adding.trim();
    if (!labelText) return;
    const value = labelText.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${options.length + 1}`;
    setOptions([...options, { value, label: labelText, color: COLOR_PALETTE[options.length % COLOR_PALETTE.length] }]);
    setAdding("");
  };

  const handleSave = async () => {
    await upsert.mutateAsync({ field_key: fieldKey, type, options: isOptionType ? options : [] });
    onOpenChange(false);
  };

  const handleReset = async () => {
    await reset.mutateAsync(fieldKey);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Configure "{label}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CustomFieldType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex flex-col items-start">
                      <span>{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {type !== defaultType && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Overrides the default type ({defaultType}) for this field.
              </p>
            )}
          </div>

          {isOptionType && (
            <div className="space-y-2">
              <Label>Options</Label>
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {options.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-1.5 rounded border border-border/50">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: opt.color }} />
                    <Input
                      value={opt.label}
                      onChange={(e) => {
                        const next = [...options];
                        next[idx] = { ...opt, label: e.target.value, value: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${idx + 1}` };
                        setOptions(next);
                      }}
                      className="h-7 text-xs flex-1"
                    />
                    <div className="flex items-center gap-0.5">
                      {COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          className={cn("w-3 h-3 rounded-full opacity-50 hover:opacity-100", opt.color === c && "opacity-100 ring-1 ring-foreground")}
                          style={{ backgroundColor: c }}
                          onClick={() => {
                            const next = [...options];
                            next[idx] = { ...opt, color: c };
                            setOptions(next);
                          }}
                        />
                      ))}
                    </div>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOptions(options.filter((_, i) => i !== idx))}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
                {options.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">No options yet.</p>}
              </div>
              <div className="flex gap-2">
                <Input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOption()} placeholder="Add option…" className="h-7 text-xs flex-1" />
                <Button size="sm" onClick={addOption} disabled={!adding.trim()} className="h-7"><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex sm:justify-between">
          {override ? (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset to default
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
