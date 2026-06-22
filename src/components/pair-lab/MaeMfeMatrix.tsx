// ============================================================================
// MAE / MFE cross-tab matrix: setup × session, with a stop-distance verdict
// per row. Reuses pairLabMath excursion data already computed per bucket.
// ============================================================================

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys } from "@/lib/pairLabMath";
import { tradeMaeR } from "@/lib/pairLabSimulator";
import { normalizeSession } from "@/lib/pairLabMath";

interface Props {
  trades: Trade[];
  fieldKeys: PairLabFieldKeys;
}

function getCf(t: any, key: string | null): number | null {
  if (!key) return null;
  const v = t?.custom_fields?.[key];
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mean(xs: number[]) {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function verdict(meanMaeRatio: number | null) {
  if (meanMaeRatio == null) return null;
  if (meanMaeRatio >= 0.85) return { label: "Stops too tight", tone: "warn" } as const;
  if (meanMaeRatio <= 0.4) return { label: "Stops too wide", tone: "info" } as const;
  return { label: "Stops aligned", tone: "good" } as const;
}

export function MaeMfeMatrix({ trades, fieldKeys }: Props) {
  const data = useMemo(() => {
    const closed = trades.filter((t) => !t.is_open && !t.is_archived && t.net_pnl != null);
    const setupOf = (t: Trade) => t.playbook?.name ?? t.playbook_id ?? "Untagged";
    const setups = Array.from(new Set(closed.map(setupOf))).sort();
    const sessions = Array.from(new Set(closed.map((t) => normalizeSession(t.session)))).sort();

    const cells: Record<string, Record<string, { meanMaeTicks: number | null; meanMfe: number | null; n: number }>> = {};
    const rowRatios: Record<string, number[]> = {};
    for (const setup of setups) {
      cells[setup] = {};
      rowRatios[setup] = [];
      for (const sess of sessions) {
        const subset = closed.filter((t) => setupOf(t) === setup && normalizeSession(t.session) === sess);
        const maeTicks = subset.map((t) => getCf(t, fieldKeys.mae)).filter((v): v is number => v != null).map(Math.abs);
        const maeRatios = subset.map((t) => tradeMaeR(t, getCf(t, fieldKeys.mae))).filter((v): v is number => v != null);
        const mfes = subset.map((t) => getCf(t, fieldKeys.mfe)).filter((v): v is number => v != null && v >= 0);
        cells[setup][sess] = { meanMaeTicks: mean(maeTicks), meanMfe: mean(mfes), n: subset.length };
        rowRatios[setup].push(...maeRatios);
      }
    }
    return { setups, sessions, cells, rowRatios };
  }, [trades, fieldKeys]);

  if (data.setups.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        No closed trades with setup data yet.
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">MAE / MFE matrix · setup × session</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Cells show mean MAE in ticks and mean MFE in R for each setup × session combo.
          Row verdict compares MAE vs planned-SL ratio: ≤0.4 = stops too wide; ≥0.85 = stops too tight.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60">
              <th className="text-left py-2 pr-2">Setup</th>
              {data.sessions.map((s) => <th key={s} className="text-right py-2 px-2">{s}</th>)}
              <th className="text-left py-2 pl-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {data.setups.map((setup) => {
              const rowMean = mean(data.rowMaes[setup]);
              const v = verdict(rowMean);
              return (
                <tr key={setup} className="border-b border-border/30">
                  <td className="py-2 pr-2 font-medium">{setup}</td>
                  {data.sessions.map((sess) => {
                    const cell = data.cells[setup]?.[sess];
                    if (!cell || cell.n === 0) {
                      return <td key={sess} className="py-2 px-2 text-right text-muted-foreground">—</td>;
                    }
                    return (
                      <td key={sess} className="py-2 px-2 text-right font-mono-numbers">
                        <div className="text-xs"><span className="text-destructive">MAE {cell.meanMae?.toFixed(2) ?? "—"}R</span></div>
                        <div className="text-xs"><span className="text-emerald-500">MFE {cell.meanMfe?.toFixed(2) ?? "—"}R</span></div>
                        <div className="text-[10px] text-muted-foreground">N {cell.n}</div>
                      </td>
                    );
                  })}
                  <td className="py-2 pl-2">
                    {v ? (
                      <Badge
                        className={`text-xs ${
                          v.tone === "warn"
                            ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
                            : v.tone === "info"
                            ? "bg-sky-500/15 text-sky-600 border-sky-500/30"
                            : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                        }`}
                      >
                        {v.label}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
