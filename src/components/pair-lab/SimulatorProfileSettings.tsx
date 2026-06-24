import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2 } from "lucide-react";
import {
  useSimulatorProfile,
  useUpdateSimulatorProfile,
  usePropFirms,
  DEFAULT_SIM_PROFILE,
  type SimulatorProfile,
} from "@/hooks/useSimulatorProfile";

const NONE = "__none__";

export function SimulatorProfileSettings() {
  const { data: profile } = useSimulatorProfile();
  const { data: firms = [] } = usePropFirms();
  const update = useUpdateSimulatorProfile();
  const [open, setOpen] = useState(false);

  // M8 — initialize from null so we never seed the draft with
  // DEFAULT_SIM_PROFILE before the real profile lands. Once `profile` resolves
  // (and we're not in the middle of editing), keep the draft in sync.
  const [draft, setDraft] = useState<SimulatorProfile | null>(null);

  useEffect(() => {
    if (open) return; // don't clobber an in-progress edit
    if (profile) setDraft(profile);
  }, [profile, open]);

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(profile ?? DEFAULT_SIM_PROFILE);
    setOpen(next);
  };

  const save = () => {
    if (!draft) return;
    update.mutate(draft, { onSuccess: () => setOpen(false) });
  };

  const d = draft ?? profile ?? DEFAULT_SIM_PROFILE;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          aria-label="Open simulator profile settings"
        >
          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="text-xs">Simulator profile</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(20rem,calc(100vw-2rem))] space-y-3"
        align="end"
        role="dialog"
        aria-label="Simulator profile settings"
      >
        <div className="space-y-1">
          <div className="text-sm font-medium">Simulator profile</div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Drives R-to-$ conversion and prop-firm verdicts. Independent of your
            account list — deleting a failed challenge won't change it.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sim-source" className="text-xs">Source</Label>
          <Select
            value={d.sim_source}
            onValueChange={(v) =>
              setDraft({ ...d, sim_source: v as SimulatorProfile["sim_source"] })
            }
          >
            <SelectTrigger id="sim-source" className="h-8" aria-label="Simulator source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual (recommended)</SelectItem>
              <SelectItem value="active_account">Use active account</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sim-balance" className="text-xs">Notional balance ($)</Label>
          <Input
            id="sim-balance"
            type="number"
            inputMode="decimal"
            min={0}
            step={1000}
            value={d.sim_balance}
            onChange={(e) =>
              setDraft({ ...d, sim_balance: Number(e.target.value) || 0 })
            }
            disabled={d.sim_source === "active_account"}
            className="h-8"
            aria-label="Notional balance in dollars"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sim-prop-firm" className="text-xs">Prop firm</Label>
          <Select
            value={d.sim_prop_firm ?? NONE}
            onValueChange={(v) =>
              setDraft({ ...d, sim_prop_firm: v === NONE ? null : v })
            }
            disabled={d.sim_source === "active_account"}
          >
            <SelectTrigger id="sim-prop-firm" className="h-8" aria-label="Prop firm">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {firms.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="sim-risk" className="text-xs">Risk / trade (%)</Label>
            <Input
              id="sim-risk"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              value={d.sim_risk_per_trade_pct}
              onChange={(e) =>
                setDraft({
                  ...d,
                  sim_risk_per_trade_pct: Number(e.target.value) || 0,
                })
              }
              className="h-8"
              aria-label="Risk per trade percent"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-hard-cap" className="text-xs">Hard cap (%)</Label>
            <Input
              id="sim-hard-cap"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              value={d.sim_hard_cap_pct}
              onChange={(e) =>
                setDraft({
                  ...d,
                  sim_hard_cap_pct: Number(e.target.value) || 0,
                })
              }
              className="h-8"
              aria-label="Hard cap percent"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={update.isPending}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

