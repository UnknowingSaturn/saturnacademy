// ============================================================================
// WalkForwardControls — lens (lookback window) + as-of date slider.
//
// Walk-forward semantics: `asOfDate` clamps the END of the analysis window
// (no future leakage). `lens` controls how far back from `asOfDate` we read.
// All-time = no dateFrom. 90d / 30d = dateFrom = asOfDate - N days.
//
// The whole control bar is presentational — parent owns state.
// ============================================================================

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Calendar, History } from "lucide-react";

export type Lens = "all" | "90d" | "30d";

export interface WalkForwardState {
  lens: Lens;
  /** asOf in epoch ms. */
  asOfMs: number;
}

interface Props {
  state: WalkForwardState;
  onChange: (next: WalkForwardState) => void;
  /** Min/Max bounds for the asOf slider (epoch ms). */
  minMs: number;
  maxMs: number;
}

const DAY = 86_400_000;

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

/** Returns dateFrom/dateTo ISO strings for a given walk-forward state. */
export function resolveWindow(s: WalkForwardState): { dateFrom: string | null; dateTo: string } {
  const dateTo = new Date(s.asOfMs).toISOString();
  if (s.lens === "all") return { dateFrom: null, dateTo };
  const days = s.lens === "90d" ? 90 : 30;
  return { dateFrom: new Date(s.asOfMs - days * DAY).toISOString(), dateTo };
}

export function WalkForwardControls({ state, onChange, minMs, maxMs }: Props) {
  const safeMin = Math.min(minMs, maxMs);
  const safeMax = Math.max(minMs, maxMs);
  const clamped = Math.max(safeMin, Math.min(safeMax, state.asOfMs));
  const atNow = clamped >= safeMax - DAY;

  return (
    <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <Label className="text-xs">Lens</Label>
        </div>
        <div
          className="inline-flex rounded-md border border-border/60 overflow-hidden"
          role="group"
          aria-label="Analysis lens"
        >
          {(["all", "90d", "30d"] as const).map((l) => {
            const active = state.lens === l;
            const label = l === "all" ? "All-time" : l;
            return (
              <button
                key={l}
                type="button"
                onClick={() => onChange({ ...state, lens: l })}
                aria-pressed={active}
                aria-label={`Lens: ${label}${active ? " (selected)" : ""}`}
                className={
                  "px-2.5 py-1 text-[11px] font-medium transition-colors " +
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 " +
                  (active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <Label className="text-xs">As of</Label>
          <span className="font-mono-numbers text-xs tabular-nums">{fmtDate(clamped)}</span>
          {!atNow && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => onChange({ ...state, asOfMs: safeMax })}
            >
              Jump to today
            </Button>
          )}
        </div>
      </div>
      <Slider
        value={[clamped]}
        min={safeMin}
        max={safeMax}
        step={DAY}
        onValueChange={(v) => onChange({ ...state, asOfMs: v[0] ?? clamped })}
        aria-label="As-of date"
      />
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Walk-forward: cells only see trades up to <span className="font-mono">{fmtDate(clamped)}</span>
        {state.lens !== "all" && <> within the last {state.lens === "90d" ? "90" : "30"} days</>}.
        Slide back to inspect what your edge looked like at any point in time.
      </p>
    </div>
  );
}
