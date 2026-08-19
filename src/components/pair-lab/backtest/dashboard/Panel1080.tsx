// ============================================================================
// Dashboard primitives — a fixed 1920x1080 board that scales to its container.
//
// Everything is hand-drawn SVG rather than a chart library: the board has to
// stay legible when it is downscaled into a 1080p screen recording, which means
// tight control over stroke widths, tick counts and label sizes. Colours come
// from the design tokens so the board matches the rest of the lab.
// ============================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";

export const BOARD_W = 1920;
export const BOARD_H = 1080;

/** Scales the 1920x1080 board down to whatever width it is given. */
export function Board1080({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / BOARD_W)));
    ro.observe(el);
    setScale(Math.min(1, el.clientWidth / BOARD_W));
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full overflow-hidden">
      <div style={{ height: BOARD_H * scale }}>
        <div
          className="bg-card text-card-foreground rounded-lg border border-border/60"
          style={{
            width: BOARD_W,
            height: BOARD_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-md border border-border/50 bg-background/40 p-3 flex flex-col min-h-0 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <h4 className="text-[13px] font-medium leading-none">{title}</h4>
        {subtitle && <span className="text-[10px] text-muted-foreground truncate">{subtitle}</span>}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export function Empty({ label = "No data" }: { label?: string }) {
  return (
    <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">{label}</div>
  );
}

// --- chart primitives -------------------------------------------------------

const AXIS = "hsl(var(--border))";
const MUTED = "hsl(var(--muted-foreground))";
const PRIMARY = "hsl(var(--primary))";

function bucketize(values: number[], bins: number, lo: number, hi: number): number[] {
  const out = new Array(bins).fill(0);
  const span = hi - lo || 1;
  for (const v of values) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / span) * bins)));
    out[i] += 1;
  }
  return out;
}

/**
 * Overlaid histograms: the real population in the primary colour, an optional
 * null population behind it in muted grey, plus optional marker lines.
 */
export function Histogram({
  values,
  nullValues,
  markers = [],
  bins = 40,
  width = 560,
  height = 190,
  xLabel,
}: {
  values: number[];
  nullValues?: number[];
  markers?: Array<{ x: number; label: string; color?: string }>;
  bins?: number;
  width?: number;
  height?: number;
  xLabel?: string;
}) {
  const all = [...values, ...(nullValues ?? []), ...markers.map((m) => m.x)].filter(Number.isFinite);
  if (!all.length) return <Empty />;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = { l: 34, r: 8, t: 8, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const real = bucketize(values, bins, lo, hi);
  const nul = nullValues?.length ? bucketize(nullValues, bins, lo, hi) : null;
  // Densities so populations of different size stay comparable.
  const maxReal = Math.max(1, ...real);
  const maxNull = nul ? Math.max(1, ...nul) : 1;
  const bw = w / bins;
  const xOf = (v: number) => pad.l + ((v - lo) / (hi - lo || 1)) * w;

  return (
    <svg width={width} height={height} role="img">
      <line x1={pad.l} y1={pad.t + h} x2={pad.l + w} y2={pad.t + h} stroke={AXIS} />
      {nul &&
        nul.map((c, i) => (
          <rect
            key={`n${i}`}
            x={pad.l + i * bw}
            y={pad.t + h - (c / maxNull) * h}
            width={Math.max(1, bw - 0.5)}
            height={(c / maxNull) * h}
            fill={MUTED}
            opacity={0.28}
          />
        ))}
      {real.map((c, i) => (
        <rect
          key={`r${i}`}
          x={pad.l + i * bw}
          y={pad.t + h - (c / maxReal) * h}
          width={Math.max(1, bw - 0.5)}
          height={(c / maxReal) * h}
          fill={PRIMARY}
          opacity={0.75}
        />
      ))}
      {markers.map((m, i) => (
        <g key={`m${i}`}>
          <line
            x1={xOf(m.x)}
            y1={pad.t}
            x2={xOf(m.x)}
            y2={pad.t + h}
            stroke={m.color ?? "hsl(var(--destructive))"}
            strokeDasharray="4 3"
          />
          <text x={xOf(m.x) + 3} y={pad.t + 10 + i * 11} fontSize={9} fill={m.color ?? "hsl(var(--destructive))"}>
            {m.label}
          </text>
        </g>
      ))}
      <text x={pad.l} y={height - 5} fontSize={9} fill={MUTED}>{lo.toFixed(2)}</text>
      <text x={pad.l + w} y={height - 5} fontSize={9} fill={MUTED} textAnchor="end">{hi.toFixed(2)}</text>
      {xLabel && (
        <text x={pad.l + w / 2} y={height - 5} fontSize={9} fill={MUTED} textAnchor="middle">{xLabel}</text>
      )}
    </svg>
  );
}

/** Horizontal labelled bars — funnel, ablation ladder, win rates. */
export function BarRows({
  rows,
  width = 560,
  rowHeight = 22,
  format = (v: number) => v.toFixed(2),
  baseline,
}: {
  rows: Array<{ label: string; value: number; note?: string; color?: string }>;
  width?: number;
  rowHeight?: number;
  format?: (v: number) => string;
  baseline?: number;
}) {
  if (!rows.length) return <Empty />;
  const labelW = 190;
  const valueW = 78;
  const barW = width - labelW - valueW;
  const lo = Math.min(0, baseline ?? 0, ...rows.map((r) => r.value));
  const hi = Math.max(0, baseline ?? 0, ...rows.map((r) => r.value));
  const span = hi - lo || 1;
  const zero = labelW + ((0 - lo) / span) * barW;

  return (
    <svg width={width} height={rows.length * rowHeight} role="img">
      {baseline !== undefined && (
        <line
          x1={labelW + ((baseline - lo) / span) * barW}
          y1={0}
          x2={labelW + ((baseline - lo) / span) * barW}
          y2={rows.length * rowHeight}
          stroke={MUTED}
          strokeDasharray="3 3"
        />
      )}
      {rows.map((r, i) => {
        const x = labelW + ((Math.min(0, r.value) - lo) / span) * barW;
        const w = (Math.abs(r.value) / span) * barW;
        const y = i * rowHeight + 4;
        return (
          <g key={r.label + i}>
            <text x={0} y={y + 10} fontSize={11} fill="currentColor">{r.label}</text>
            <rect x={Math.min(x, zero)} y={y} width={Math.max(1, w)} height={rowHeight - 9} rx={2}
              fill={r.color ?? (r.value >= 0 ? PRIMARY : "hsl(var(--destructive))")} opacity={0.8} />
            <text x={width} y={y + 10} fontSize={11} fill={MUTED} textAnchor="end">
              {r.note ?? format(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Scatter({
  points,
  width = 560,
  height = 190,
  xLabel,
  yLabel,
}: {
  points: Array<{ x: number; y: number; label?: string; highlight?: boolean }>;
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
}) {
  if (!points.length) return <Empty />;
  const pad = { l: 36, r: 10, t: 10, b: 22 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xlo = Math.min(0, ...xs), xhi = Math.max(0, ...xs);
  const ylo = Math.min(0, ...ys), yhi = Math.max(0, ...ys);
  const X = (v: number) => pad.l + ((v - xlo) / (xhi - xlo || 1)) * w;
  const Y = (v: number) => pad.t + h - ((v - ylo) / (yhi - ylo || 1)) * h;

  return (
    <svg width={width} height={height} role="img">
      <line x1={pad.l} y1={Y(0)} x2={pad.l + w} y2={Y(0)} stroke={AXIS} />
      <line x1={X(0)} y1={pad.t} x2={X(0)} y2={pad.t + h} stroke={AXIS} />
      {/* y = x reference: agreement between the two symbols */}
      <line x1={X(Math.max(xlo, ylo))} y1={Y(Math.max(xlo, ylo))} x2={X(Math.min(xhi, yhi))} y2={Y(Math.min(xhi, yhi))}
        stroke={MUTED} strokeDasharray="4 4" opacity={0.6} />
      {points.map((p, i) => (
        <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={p.highlight ? 4.5 : 2.5}
          fill={p.highlight ? "hsl(var(--destructive))" : PRIMARY} opacity={p.highlight ? 0.95 : 0.55} />
      ))}
      {xLabel && <text x={pad.l + w / 2} y={height - 5} fontSize={9} fill={MUTED} textAnchor="middle">{xLabel}</text>}
      {yLabel && <text x={10} y={pad.t + 8} fontSize={9} fill={MUTED}>{yLabel}</text>}
    </svg>
  );
}

/** Config x year grid, green/red by average R. */
export function Heatmap({
  rows,
  columns,
  cell,
  width = 560,
  rowHeight = 20,
}: {
  rows: Array<{ label: string; values: Array<number | null> }>;
  columns: string[];
  cell?: (v: number) => string;
  width?: number;
  rowHeight?: number;
}) {
  if (!rows.length || !columns.length) return <Empty />;
  const labelW = 150;
  const cw = (width - labelW) / columns.length;
  const mag = Math.max(0.01, ...rows.flatMap((r) => r.values.filter((v): v is number => v !== null).map(Math.abs)));

  return (
    <svg width={width} height={rows.length * rowHeight + 16} role="img">
      {columns.map((c, i) => (
        <text key={c} x={labelW + i * cw + cw / 2} y={10} fontSize={9} fill={MUTED} textAnchor="middle">{c}</text>
      ))}
      {rows.map((r, ri) => (
        <g key={r.label + ri}>
          <text x={0} y={16 + ri * rowHeight + rowHeight / 2 + 3} fontSize={10} fill="currentColor">{r.label}</text>
          {r.values.map((v, ci) => (
            <g key={ci}>
              <rect
                x={labelW + ci * cw}
                y={16 + ri * rowHeight}
                width={cw - 1.5}
                height={rowHeight - 2}
                rx={2}
                fill={v === null ? MUTED : v >= 0 ? "hsl(142 70% 45%)" : "hsl(var(--destructive))"}
                opacity={v === null ? 0.12 : 0.18 + 0.72 * Math.min(1, Math.abs(v) / mag)}
              />
              {v !== null && cw > 42 && (
                <text x={labelW + ci * cw + cw / 2} y={16 + ri * rowHeight + rowHeight / 2 + 3}
                  fontSize={9} fill="currentColor" textAnchor="middle">
                  {(cell ?? ((n: number) => n.toFixed(2)))(v)}
                </text>
              )}
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Equity curves with an optional shaded null band behind them. */
export function EquityCurves({
  series,
  band,
  width = 560,
  height = 190,
}: {
  series: Array<{ label: string; points: number[]; color?: string }>;
  band?: { lo: number[]; hi: number[] };
  width?: number;
  height?: number;
}) {
  const lens = series.map((s) => s.points.length);
  if (!series.length || !Math.max(0, ...lens)) return <Empty />;
  const pad = { l: 36, r: 10, t: 10, b: 18 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const n = Math.max(...lens, band?.hi.length ?? 0);
  const all = [...series.flatMap((s) => s.points), ...(band ? [...band.lo, ...band.hi] : []), 0];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const X = (i: number) => pad.l + (i / Math.max(1, n - 1)) * w;
  const Y = (v: number) => pad.t + h - ((v - lo) / (hi - lo || 1)) * h;
  const path = (pts: number[]) => pts.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");

  return (
    <svg width={width} height={height} role="img">
      {band && band.hi.length > 1 && (
        <path
          d={`${path(band.hi)} L${X(band.lo.length - 1)},${Y(band.lo[band.lo.length - 1])} ${band.lo
            .map((v, i) => `L${X(band.lo.length - 1 - i)},${Y(band.lo[band.lo.length - 1 - i])}`)
            .join(" ")} Z`}
          fill={MUTED}
          opacity={0.18}
        />
      )}
      <line x1={pad.l} y1={Y(0)} x2={pad.l + w} y2={Y(0)} stroke={AXIS} />
      {series.map((s, i) => (
        <path key={s.label + i} d={path(s.points)} fill="none" strokeWidth={1.6}
          stroke={s.color ?? (i === 0 ? PRIMARY : MUTED)} opacity={i === 0 ? 1 : 0.7} />
      ))}
      <text x={pad.l} y={pad.t + 8} fontSize={9} fill={MUTED}>{hi.toFixed(1)}R</text>
      <text x={pad.l} y={pad.t + h} fontSize={9} fill={MUTED}>{lo.toFixed(1)}R</text>
      {series.length > 1 && (
        <text x={width - 10} y={pad.t + 8} fontSize={9} fill={MUTED} textAnchor="end">
          {series.map((s) => s.label).join(" · ")}
        </text>
      )}
    </svg>
  );
}

export function KeyValue({ items }: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground truncate">{it.label}</span>
          <span className="tabular-nums font-medium" title={it.hint}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}
