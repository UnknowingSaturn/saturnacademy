import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomFieldDefinition, CustomFieldOption, CustomFieldType } from "@/types/settings";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface CustomFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CustomFieldDefinition | null;
  onSubmit: (input: { label: string; type: CustomFieldType; options: CustomFieldOption[] }) => Promise<void> | void;
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

export function CustomFieldDialog({ open, onOpenChange, initial, onSubmit }: CustomFieldDialogProps) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState<CustomFieldOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setLabel(initial?.label ?? "");
      setType(initial?.type ?? "text");
      setOptions(initial?.options ?? []);
      setSubmitting(false);
    }
  }, [open, initial]);

  const isOptionType = type === "select" || type === "multi_select";
  const canSubmit = label.trim().length > 0 && (!isOptionType || options.length > 0);

  const addOption = () => {
    setOptions([...options, { value: `opt_${options.length + 1}`, label: "New option", color: COLOR_PALETTE[options.length % COLOR_PALETTE.length] }]);
  };

  const updateOption = (idx: number, patch: Partial<CustomFieldOption>) => {
    setOptions(options.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  };

  const removeOption = (idx: number) => {
    setOptions(options.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ label: label.trim(), type, options });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit column" : "Add column"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Column name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Setup Grade"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CustomFieldType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
            {initial && type !== initial.type && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Existing values will be converted to <strong>{type}</strong>. Incompatible values may be cleared.
              </p>
            )}
          </div>

          {isOptionType && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Options</Label>
                <Button type="button" size="sm" variant="ghost" onClick={addOption}>
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {options.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={opt.label}
                      onChange={(e) =>
                        updateOption(idx, {
                          label: e.target.value,
                          value: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") || `opt_${idx + 1}`,
                        })
                      }
                      className="flex-1 h-8"
                      placeholder="Option label"
                    />
                    <div className="flex items-center gap-1">
                      {COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={cn(
                            "w-4 h-4 rounded-full transition-all opacity-50 hover:opacity-100",
                            opt.color === c && "opacity-100 ring-1 ring-offset-1 ring-offset-background ring-foreground"
                          )}
                          style={{ backgroundColor: c }}
                          onClick={() => updateOption(idx, { color: c })}
                        />
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeOption(idx)}
                      className="h-8 w-8"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {options.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    Add at least one option
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {initial ? "Save" : "Create column"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
