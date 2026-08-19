// ============================================================================
// Step 2 — Strategy. Named presets first, then the rule groups behind
// collapsible sections that state their current setting while shut.
// ============================================================================

import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Num, Toggle, RuleSection } from "./controls";
import { WINDOW_OPTIONS, windowLabel, type UiConfig } from "./config";
import { STRATEGY_PRESETS, activePresetKey } from "./presets";

interface Props {
  cfg: UiConfig;
  onChange: (patch: Partial<UiConfig>) => void;
}

const BIAS_LABEL: Record<string, string> = {
  none: "no HTF bias",
  prior_close: "prior-session close bias",
  trend: "multi-day trend bias",
};

export function StrategyPanel({ cfg, onChange }: Props) {
  const preset = activePresetKey(cfg);

  const confluence = [
    BIAS_LABEL[cfg.biasMode] ?? cfg.biasMode,
    cfg.requireSweep ? "sweep" : null,
    cfg.requireMss ? "MSS" : null,
    cfg.requireDisplacement ? "displacement" : null,
  ].filter(Boolean).join(" · ");

  const entryExit = [
    `${cfg.entry} entry`,
    `${cfg.stopMode === "gap" ? "gap stop" : "swing stop"} +${cfg.stopBufferTicks} ticks`,
    cfg.targetMode === "r" ? `${cfg.targetR}R target` : "liquidity target",
  ].join(" · ");

  const filters = [
    `min FVG ${cfg.minFvgPoints}`,
    `max ${cfg.maxTradesPerWindow}/window`,
    `swing ${cfg.swingStrength}`,
  ].join(" · ");

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 p-3 space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Strategy</p>
        <div className="grid grid-cols-1 gap-1.5">
          {STRATEGY_PRESETS.map((p) => {
            const active = preset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange(p.patch)}
                className={`text-left rounded-md border px-2.5 py-2 transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/50 hover:bg-muted/30"
                }`}
              >
                <span className="block text-xs font-medium">{p.label}</span>
                <span className="block text-[11px] text-muted-foreground">{p.blurb}</span>
              </button>
            );
          })}
        </div>
        {preset === "custom" && (
          <p className="text-[11px] text-muted-foreground">
            Custom — edited away from every preset. Pick one above to reset.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-2">
        <Label className="text-xs">Session windows</Label>
        <div className="flex flex-wrap gap-1.5">
          {WINDOW_OPTIONS.map((w) => {
            const on = cfg.windowKeys.includes(w.key);
            return (
              <Button
                key={w.key}
                type="button"
                size="sm"
                variant={on ? "secondary" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => {
                  const next = on
                    ? cfg.windowKeys.filter((k) => k !== w.key)
                    : [...cfg.windowKeys, w.key];
                  onChange({ windowKeys: next.length ? next : cfg.windowKeys });
                }}
              >
                {w.key === "rth" ? "RTH" : w.key.replace("_", " ").toUpperCase()}
              </Button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground pt-0.5">
          {cfg.windowKeys.map(windowLabel).join(" · ")}
        </p>
      </div>

      <RuleSection title="Setup" summary={confluence}>
        <div className="space-y-1 pt-2">
          <Label className="text-xs">HTF bias</Label>
          <Select value={cfg.biasMode} onValueChange={(v) => onChange({ biasMode: v as UiConfig["biasMode"] })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="prior_close">Prior session close</SelectItem>
              <SelectItem value="trend">Multi-day trend</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {cfg.biasMode === "trend" && (
          <Num id="bt-trend" label="Trend days" value={cfg.biasTrendDays} min={1} max={20}
            onChange={(n) => onChange({ biasTrendDays: n })} />
        )}
        <Toggle id="bt-sweep" label="Require liquidity sweep" checked={cfg.requireSweep}
          onChange={(v) => onChange({ requireSweep: v })} />
        {cfg.requireSweep && (
          <Num id="bt-sweep-lb" label="Sweep lookback (bars)" value={cfg.sweepLookbackBars} min={1} max={240}
            onChange={(n) => onChange({ sweepLookbackBars: n })} />
        )}
        <Toggle id="bt-mss" label="Require market-structure shift" checked={cfg.requireMss}
          onChange={(v) => onChange({ requireMss: v })} />
        {cfg.requireMss && (
          <Num id="bt-mss-lb" label="MSS lookback (bars)" value={cfg.mssLookbackBars} min={1} max={240}
            onChange={(n) => onChange({ mssLookbackBars: n })} />
        )}
        <Toggle id="bt-disp" label="Require displacement" checked={cfg.requireDisplacement}
          onChange={(v) => onChange({ requireDisplacement: v })} />
        {cfg.requireDisplacement && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Displacement measure</Label>
              <Select value={cfg.displacementMode}
                onValueChange={(v) => onChange({ displacementMode: v as UiConfig["displacementMode"] })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="atr">ATR multiple</SelectItem>
                  <SelectItem value="percentile">Range percentile</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {cfg.displacementMode === "atr" && (
              <Num id="bt-atr" label="ATR multiple" value={cfg.displacementAtrMultiple} min={0.5} max={5} step={0.1}
                onChange={(n) => onChange({ displacementAtrMultiple: n })} />
            )}
          </>
        )}
      </RuleSection>

      <RuleSection title="Entry & exit" summary={entryExit}>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="space-y-1">
            <Label className="text-xs">Entry at</Label>
            <Select value={cfg.entry} onValueChange={(v) => onChange({ entry: v as UiConfig["entry"] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="proximal">Proximal edge</SelectItem>
                <SelectItem value="mid">50% of gap</SelectItem>
                <SelectItem value="distal">Distal edge</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Num id="bt-expiry" label="Entry expiry (bars)" value={cfg.entryExpiryBars} min={1} max={240}
            onChange={(n) => onChange({ entryExpiryBars: n })} />
          <div className="space-y-1">
            <Label className="text-xs">Stop</Label>
            <Select value={cfg.stopMode} onValueChange={(v) => onChange({ stopMode: v as UiConfig["stopMode"] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gap">Far side of the gap</SelectItem>
                <SelectItem value="swing">Protected swing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Num id="bt-buf" label="Stop buffer (ticks)" value={cfg.stopBufferTicks} min={0} max={200}
            onChange={(n) => onChange({ stopBufferTicks: n })} />
          <div className="space-y-1">
            <Label className="text-xs">Target</Label>
            <Select value={cfg.targetMode} onValueChange={(v) => onChange({ targetMode: v as UiConfig["targetMode"] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="r">Fixed R multiple</SelectItem>
                <SelectItem value="liquidity">Opposing liquidity</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {cfg.targetMode === "r" && (
            <Num id="bt-r" label="Target R" value={cfg.targetR} min={0.25} max={20} step={0.25}
              onChange={(n) => onChange({ targetR: n })} />
          )}
        </div>
        <Toggle id="bt-hexw" label="Hard exit at window end" checked={cfg.hardExitAtWindowEnd}
          onChange={(v) => onChange({ hardExitAtWindowEnd: v })} />
        <Toggle id="bt-hexr" label="Hard exit at RTH close" checked={cfg.hardExitAtRthEnd}
          onChange={(v) => onChange({ hardExitAtRthEnd: v })} />
      </RuleSection>

      <RuleSection title="Filters" summary={filters}>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Num id="bt-minfvg" label="Min FVG (points)" value={cfg.minFvgPoints} min={0} step={0.25}
            onChange={(n) => onChange({ minFvgPoints: n })} />
          <Num id="bt-max" label="Max trades / window" value={cfg.maxTradesPerWindow} min={1} max={10}
            onChange={(n) => onChange({ maxTradesPerWindow: n })} />
          <Num id="bt-swing" label="Swing strength" value={cfg.swingStrength} min={1} max={10}
            onChange={(n) => onChange({ swingStrength: n })} />
        </div>
      </RuleSection>
    </div>
  );
}
