import { Area, AreaChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import type { ReplayResult } from "@/lib/pairLabSimulator";

interface Props {
  results: ReplayResult[];
  colors?: string[];
}

const DEFAULT_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(var(--accent-foreground))",
  "hsl(var(--muted-foreground))",
];

export function EquityCurveOverlay({ results, colors = DEFAULT_COLORS }: Props) {
  if (results.length === 0) return null;

  const maxLen = Math.max(...results.map((r) => r.equityCurve.length));
  const data = Array.from({ length: maxLen }, (_, i) => {
    const row: Record<string, number | string> = { i };
    results.forEach((r, idx) => {
      row[`s${idx}`] = r.equityCurve[i]?.equity ?? r.equityCurve[r.equityCurve.length - 1]?.equity ?? 0;
    });
    return row;
  });

  const maxUnderLen = Math.max(...results.map((r) => r.underwaterCurve?.length ?? 0));
  const underData = Array.from({ length: maxUnderLen }, (_, i) => {
    const row: Record<string, number | string> = { i };
    results.forEach((r, idx) => {
      const uw = r.underwaterCurve?.[i]?.underwater ?? r.underwaterCurve?.[r.underwaterCurve.length - 1]?.underwater ?? 0;
      row[`u${idx}`] = uw;
    });
    return row;
  });

  return (
    <div className="space-y-1">
      <div className="w-full h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <XAxis dataKey="i" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
              width={50}
            />
            <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="2 2" />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelFormatter={(v) => `Trade #${v}`}
              formatter={(v: number, name: string) => {
                const idx = Number(name.replace("s", ""));
                return [`$${v.toFixed(0)}`, results[idx]?.strategy.label ?? name];
              }}
            />
            {results.map((r, idx) => (
              <Line
                key={r.strategy.id}
                type="monotone"
                dataKey={`s${idx}`}
                stroke={colors[idx % colors.length]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {maxUnderLen > 1 && (
        <div className="w-full h-28">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pb-1">
            Underwater equity (peak-to-trough)
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={underData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <XAxis dataKey="i" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                width={50}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="2 2" />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={(v) => `Trade #${v}`}
                formatter={(v: number, name: string) => {
                  const idx = Number(name.replace("u", ""));
                  return [`$${v.toFixed(0)}`, results[idx]?.strategy.label ?? name];
                }}
              />
              {results.map((r, idx) => (
                <Area
                  key={r.strategy.id}
                  type="monotone"
                  dataKey={`u${idx}`}
                  stroke={colors[idx % colors.length]}
                  fill={colors[idx % colors.length]}
                  fillOpacity={0.18}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
