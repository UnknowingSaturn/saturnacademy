// ============================================================================
// Backtest rule controls — every knob maps 1:1 to an `EngineConfig` field, so
// what you see is exactly what the Layer-3 engine executes. No hidden defaults.
// ============================================================================

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Play } from "lucide-react";
import { KILLZONES, RTH } from "../../../../shared/quant/sessions";
import type { EngineConfig } from "../../../../shared/quant/ict/engine";

export type UiConfig = Omit<EngineConfig, "window"> & { windowKey: string };

export const WINDOW_OPTIONS = [
  { key: "london", label: "London killzone (02:00–05:00 ET)" },
  { key: "ny_am", label: "NY AM killzone (07:00–10:00 ET)" },
  { key: "ny_pm", label: "NY PM killzone (13:30–16:00 ET)" },
  { key: "rth", label: "Full RTH (09:30–16:00 ET)" },
];

export function windowForKey(key: string) {
  return key === "rth" ? RTH : (KILLZONES[key] ?? KILLZONES.ny_am);
}

export interface WfUi {
  enabled: boolean;
  trainMonths: number;
  testMonths: number;
  anchored: boolean;
  minTrainTrades: number;
  sweepTargetR: boolean;
  sweepEntry: boolean;
  sweepStopBuffer: boolean;
}

export const DEFAULT_WF: WfUi = {
  enabled: false,
  trainMonths: 6,
  testMonths: 2,
  anchored: false,
  minTrainTrades: 20,
  sweepTargetR: true,
  sweepEntry: true,
  sweepStopBuffer: false,
};

interface Props {
  cfg: UiConfig;
  onChange: (patch: Partial<UiConfig>) => void;
  symbols: string[];
  symbol: string;
  onSymbol: (s: string) => void;
  fromMonth: string;
  toMonth: string;
  onMonths: (from: string, to: string) => void;
  onRun: () => void;
  isRunning: boolean;
  wf: WfUi;
  onWf: (patch: Partial<WfUi>) => void;
  persist: boolean;
  onPersist: (v: boolean) => void;
  /** Combinations the current sweep will try — shown so the cost is visible. */
  gridSize: number;
}


function Num({
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

function Toggle({
  id, label, checked, onChange,
}: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <Label htmlFor={id} className="text-xs font-normal">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function BacktestControls({
  cfg, onChange, symbols, symbol, onSymbol, fromMonth, toMonth, onMonths, onRun, isRunning,
}: Props) {
  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Symbol</Label>
          <Select value={symbol} onValueChange={onSymbol}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {symbols.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Window</Label>
          <Select value={cfg.windowKey} onValueChange={(v) => onChange({ windowKey: v })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((w) => (
                <SelectItem key={w.key} value={w.key}>{w.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bt-from" className="text-xs">From month</Label>
          <Input id="bt-from" className="h-8" value={fromMonth}
            onChange={(e) => onMonths(e.target.value, toMonth)} placeholder="YYYY-MM" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="bt-to" className="text-xs">To month</Label>
          <Input id="bt-to" className="h-8" value={toMonth}
            onChange={(e) => onMonths(fromMonth, e.target.value)} placeholder="YYYY-MM" />
        </div>
      </div>

      <div className="space-y-1 pt-1 border-t border-border/40">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground pt-2">Confluence</p>
        <div className="space-y-1">
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
            <Num id="bt-atr" label="ATR multiple" value={cfg.displacementAtrMultiple} min={0.5} max={5} step={0.1}
              onChange={(n) => onChange({ displacementAtrMultiple: n })} />
          </>
        )}
      </div>

      <div className="space-y-1 pt-1 border-t border-border/40">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground pt-2">Entry & exit</p>
        <div className="grid grid-cols-2 gap-3">
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
          <Num id="bt-minfvg" label="Min FVG (points)" value={cfg.minFvgPoints} min={0} step={0.25}
            onChange={(n) => onChange({ minFvgPoints: n })} />
          <Num id="bt-max" label="Max trades / window" value={cfg.maxTradesPerWindow} min={1} max={10}
            onChange={(n) => onChange({ maxTradesPerWindow: n })} />
          <Num id="bt-swing" label="Swing strength" value={cfg.swingStrength} min={1} max={10}
            onChange={(n) => onChange({ swingStrength: n })} />
          <Num id="bt-size" label="Size (contracts / lots)" value={cfg.size} min={0.01} step={0.01}
            onChange={(n) => onChange({ size: n })} />
        </div>
        <Toggle id="bt-hexw" label="Hard exit at window end" checked={cfg.hardExitAtWindowEnd}
          onChange={(v) => onChange({ hardExitAtWindowEnd: v })} />
        <Toggle id="bt-hexr" label="Hard exit at RTH close" checked={cfg.hardExitAtRthEnd}
          onChange={(v) => onChange({ hardExitAtRthEnd: v })} />
      </div>

      <Button className="w-full" onClick={onRun} disabled={isRunning}>
        {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
        Run backtest
      </Button>
    </div>
  );
}
