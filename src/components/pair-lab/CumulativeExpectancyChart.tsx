// ============================================================================
// CumulativeExpectancyChart — causal visualisation of a bucket's events.
//
// X axis: trade index (chronological by entry_time).
// Y axis: cumulative mean R (lifetime) + rolling-10 mean R overlay + per-trade
// outcome dots. No CI band here — `bucket.expectedRCi` is already shown in the
// QuantNotePanel header; doubling it as a band confuses the per-trade story.
//
// All math is local to keep this component pure / dependency-free.
// ============================================================================

import { memo, useEffect, useMemo, useRef } from "react";
import type { BucketEvent } from "@/lib/pairLabMath";

interface Props {
  events: BucketEvent[];
  rollingN?: number;
  height?: number;
}

// Above this many dots, switch the scatter from inline SVG <circle> nodes
// to a single <canvas> overlay. SVG keeps each dot in the DOM tree, which
// React + the browser layout engine both pay for on every parent re-render.
const CANVAS_SCATTER_THRESHOLD = 100;

export function CumulativeExpectancyChart({ events, rollingN = 10, height = 140 }: Props) {
  if (events.length < 5) {
    return (
      <div className="text-xs text-muted-foreground py-3">
        Need at least 5 trades to chart expectancy over time. ({events.length} so far.)
      </div>
    );
  }

  const W = 560;
  const H = height;
  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // Cumulative mean.
  const cumMean: number[] = [];
  let sum = 0;
  for (let i = 0; i < events.length; i++) {
    sum += events[i].r;
    cumMean.push(sum / (i + 1));
  }
  // Rolling mean.
  const roll: Array<number | null> = events.map((_, i) => {
    if (i + 1 < rollingN) return null;
    let s = 0;
    for (let j = i - rollingN + 1; j <= i; j++) s += events[j].r;
    return s / rollingN;
  });

  const ys = [
    ...cumMean,
    ...roll.filter((v): v is number => v != null),
    ...events.map((e) => e.r),
    0,
  ];
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.1 || 0.5;
  const lo = yMin - yPad;
  const hi = yMax + yPad;

  const x = (i: number) =>
    padL + (events.length <= 1 ? innerW / 2 : (i / (events.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - lo) / (hi - lo)) * innerH;

  const cumPath = cumMean.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const rollPts = roll
    .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean) as string[];
  const rollPath = rollPts.length > 0 ? "M" + rollPts.join(" L") : "";

  const zeroY = y(0);
  const useCanvasScatter = events.length > CANVAS_SCATTER_THRESHOLD;

  // Canvas overlay path — renders the same dot scatter as the SVG branch,
  // but in one paint op instead of one DOM node per event.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!useCanvasScatter) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = W * dpr;
    cvs.height = H * dpr;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < events.length; i++) {
      ctx.beginPath();
      ctx.arc(x(i), y(events[i].r), 1.6, 0, Math.PI * 2);
      ctx.fillStyle = events[i].won
        ? "hsl(var(--heat-positive))"
        : "hsl(var(--heat-negative))";
      ctx.fill();
    }
  }, [events, useCanvasScatter, W, H]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-0.5 bg-primary inline-block" /> cumulative E[R]
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-0.5 bg-amber-500 inline-block" style={{ borderTop: "1px dashed" }} /> rolling-{rollingN} E[R]
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> win
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" /> loss
        </span>
      </div>
      <div className="relative w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
          {zeroY > padT && zeroY < padT + innerH && (
            <line
              x1={padL}
              x2={padL + innerW}
              y1={zeroY}
              y2={zeroY}
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeDasharray="2 3"
            />
          )}
          <text x={padL - 4} y={padT + 4} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {hi.toFixed(2)}R
          </text>
          <text x={padL - 4} y={padT + innerH} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {lo.toFixed(2)}R
          </text>
          {!useCanvasScatter &&
            events.map((e, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(e.r)}
                r={1.6}
                className={e.won ? "fill-emerald-500" : "fill-destructive"}
                opacity={0.7}
              />
            ))}
          {rollPath && (
            <path
              d={rollPath}
              fill="none"
              stroke="hsl(var(--chart-trail))"
              strokeWidth={1.4}
              strokeDasharray="4 3"
            />
          )}
          <path d={cumPath} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.8} />
        </svg>
        {useCanvasScatter && (
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "auto", aspectRatio: `${W} / ${H}` }}
            className="absolute inset-0 pointer-events-none"
          />
        )}
      </div>
    </div>
  );
}
