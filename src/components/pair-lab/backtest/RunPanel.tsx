// ============================================================================
// Step 3 — Run. How the money is modelled and how honest the test is:
// sizing, costs, walk-forward and the sweep grid.
// ============================================================================

import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Num, Toggle } from "./controls";
import type { UiConfig, WfUi } from "./config";

interface Props {
  cfg: UiConfig;
  onChange: (patch: Partial<UiConfig>) => void;
  wf: WfUi;
  onWf: (patch: Partial<WfUi>) => void;
  persist: boolean;
  onPersist: (v: boolean) => void;
  /** Combinations the current sweep will try — shown so the cost is visible. */
  gridSize: number;
}

export function RunPanel({ cfg, onChange, wf, onWf, persist, onPersist, gridSize }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 p-3 space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Money model</p>
        <div className="space-y-1">
          <Label className="text-xs">Position sizing</Label>
          <Select value={cfg.sizing} onValueChange={(v) => onChange({ sizing: v as UiConfig["sizing"] })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="risk">Risk % of balance (matches the simulator)</SelectItem>
              <SelectItem value="fixed">Fixed size</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {cfg.sizing === "risk" ? (
          <div className="grid grid-cols-2 gap-3">
            <Num id="bt-bal" label="Account balance" value={cfg.accountBalance} min={100} step={1000}
              onChange={(n) => onChange({ accountBalance: n })} />
            <Num id="bt-riskpct" label="Risk per trade (%)" value={cfg.riskPercent} min={0.05} max={5} step={0.05}
              onChange={(n) => onChange({ riskPercent: n })} />
          </div>
        ) : (
          <Num id="bt-size" label="Size (contracts / lots)" value={cfg.size} min={0.01} step={0.01}
            onChange={(n) => onChange({ size: n })} />
        )}
        <Toggle id="bt-spread" label="Charge modelled spread" checked={cfg.applySpread}
          onChange={(v) => onChange({ applySpread: v })} />
        <p className="text-[11px] text-muted-foreground">
          Risk is fixed-fractional off the starting balance (not compounded), so a fold's
          result never depends on where it sits in the sequence.
        </p>
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Robustness</p>
        <Toggle id="bt-wf" label="Walk-forward (out-of-sample)" checked={wf.enabled}
          onChange={(v) => onWf({ enabled: v })} />
        {wf.enabled ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Num id="bt-train" label="Train months" value={wf.trainMonths} min={1} max={36}
                onChange={(n) => onWf({ trainMonths: n })} />
              <Num id="bt-test" label="Test months" value={wf.testMonths} min={1} max={12}
                onChange={(n) => onWf({ testMonths: n })} />
              <Num id="bt-mintr" label="Min train trades" value={wf.minTrainTrades} min={5} max={200}
                onChange={(n) => onWf({ minTrainTrades: n })} />
            </div>
            <Toggle id="bt-anch" label="Anchored (expanding) train window" checked={wf.anchored}
              onChange={(v) => onWf({ anchored: v })} />
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground pt-1">Sweep axes</p>
            <Toggle id="bt-sw-r" label="Sweep target R" checked={wf.sweepTargetR}
              onChange={(v) => onWf({ sweepTargetR: v })} />
            <Toggle id="bt-sw-e" label="Sweep entry level" checked={wf.sweepEntry}
              onChange={(v) => onWf({ sweepEntry: v })} />
            <Toggle id="bt-sw-b" label="Sweep stop buffer" checked={wf.sweepStopBuffer}
              onChange={(v) => onWf({ sweepStopBuffer: v })} />
            <p className="text-[11px] text-muted-foreground">
              {gridSize} rule set{gridSize === 1 ? "" : "s"} tried per fold. Selection happens on
              train data only and the reported expectancy is deflated for the number tried.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Off — the whole range is one in-sample test. Turn it on to see how the rules hold
            up on months they were never fitted to.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-3">
        <Toggle id="bt-persist" label="Save this run to history" checked={persist}
          onChange={onPersist} />
      </div>
    </div>
  );
}
