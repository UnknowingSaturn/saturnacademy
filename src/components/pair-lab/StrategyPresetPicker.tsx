import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STRATEGY_PRESETS, getPreset } from "@/lib/pairLabPresets";
import type { Strategy } from "@/lib/pairLabSimulator";

interface Props {
  value: Strategy;
  onChange: (s: Strategy) => void;
  /** Label for the picker (e.g. "Strategy A"). */
  label: string;
}

export function StrategyPresetPicker({ value, onChange, label }: Props) {
  const handlePreset = (id: string) => {
    const preset = getPreset(id);
    if (preset) onChange({ ...preset, riskPct: value.riskPct }); // keep risk%
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-1">
          <Label className="text-xs text-muted-foreground">Risk</Label>
          <Input
            type="number"
            min={0.1}
            max={5}
            step={0.1}
            value={value.riskPct}
            onChange={(e) => onChange({ ...value, riskPct: Number(e.target.value) || 0 })}
            className="w-20 h-7 text-xs font-mono-numbers"
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </div>
      <Select value={value.id} onValueChange={handlePreset}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STRATEGY_PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.description && (
        <p className="text-xs text-muted-foreground leading-relaxed">{value.description}</p>
      )}
    </div>
  );
}
