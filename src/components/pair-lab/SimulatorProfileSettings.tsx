import { useState } from "react";
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

  const current: SimulatorProfile = profile ?? DEFAULT_SIM_PROFILE;
  const [draft, setDraft] = useState<SimulatorProfile>(current);

  // Reset draft to latest server values whenever the popover is opened.
  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(profile ?? DEFAULT_SIM_PROFILE);
    setOpen(next);
  };

  const save = () => {
    update.mutate(draft, { onSuccess: () => setOpen(false) });
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="w-3.5 h-3.5" />
          <span className="text-xs">Simulator profile</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        <div className="space-y-1">
          <div className="text-sm font-medium">Simulator profile</div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Drives R-to-$ conversion and prop-firm verdicts. Independent of your
            account list — deleting a failed challenge won't change it.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Source</Label>
          <Select
            value={draft.sim_source}
            onValueChange={(v) =>
              setDraft({ ...draft, sim_source: v as SimulatorProfile["sim_source"] })
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual (recommended)</SelectItem>
              <SelectItem value="active_account">Use active account</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Notional balance ($)</Label>
          <Input
            type="number"
            min={0}
            step={1000}
            value={draft.sim_balance}
            onChange={(e) =>
              setDraft({ ...draft, sim_balance: Number(e.target.value) || 0 })
            }
            disabled={draft.sim_source === "active_account"}
            className="h-8"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Prop firm</Label>
          <Select
            value={draft.sim_prop_firm ?? NONE}
            onValueChange={(v) =>
              setDraft({ ...draft, sim_prop_firm: v === NONE ? null : v })
            }
            disabled={draft.sim_source === "active_account"}
          >
            <SelectTrigger className="h-8">
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

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label className="text-xs">Risk / trade (%)</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={draft.sim_risk_per_trade_pct}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  sim_risk_per_trade_pct: Number(e.target.value) || 0,
                })
              }
              className="h-8"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Hard cap (%)</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={draft.sim_hard_cap_pct}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  sim_hard_cap_pct: Number(e.target.value) || 0,
                })
              }
              className="h-8"
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
