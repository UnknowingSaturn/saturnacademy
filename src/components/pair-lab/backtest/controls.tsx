// ============================================================================
// Small form primitives shared by the strategy and run panels, plus the
// collapsible rule section that keeps 25 knobs from shouting at once.
// ============================================================================

import { type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function Num({
  id, label, value, min, max, step = 1, onChange,
}: {
  id: string; label: string; value: number; min?: number; max?: number; step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type="number"
        className="h-8"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

export function Toggle({
  id, label, checked, onChange,
}: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <Label htmlFor={id} className="text-xs font-normal">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * A rule group that stays shut until you need it, and shows what it is
 * currently set to while closed — so collapsing never hides the truth.
 */
export function RuleSection({
  title, summary, defaultOpen = false, children,
}: {
  title: string; summary: string; defaultOpen?: boolean; children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border border-border/60">
      <CollapsibleTrigger className="group w-full flex items-start gap-2 p-3 text-left">
        <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">{title}</span>
          <span className="block text-[11px] text-muted-foreground truncate">{summary}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/40">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
