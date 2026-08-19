// ============================================================================
// Holdout step — the last look, run once.
//
// The configs are already frozen by the discovery study; this panel only says
// "go" and shows how the discovery-era numbers held up on unseen months.
// ============================================================================

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Lock, Loader2, Play } from "lucide-react";
import { useHoldoutRun } from "@/hooks/useHoldoutRun";
import type { SweepReport } from "@/lib/backtest/summaryPack";
import { SWEEP } from "../../../../shared/quant/ict/sweep";

const n2 = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(2));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function HoldoutPanel({ report }: { report: SweepReport }) {
  const { state, run } = useHoldoutRun();
  const busy = state.phase === "loading" || state.phase === "running";
  const done = state.phase === "done" && state.result;
  const pctDone = state.progress.total ? Math.round((state.progress.done / state.progress.total) * 100) : 0;

  return (
    <section className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lock className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-medium">Holdout — {SWEEP.holdoutFromMonth} onward</h4>
        <Badge variant="outline" className="text-[10px]">one run</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Runs the top {report.topCandidates.length} FDR survivors plus the named configs on months the
        sweep never loaded. Nothing is re-selected here: whatever comes out is the result.
      </p>

      <div className="flex gap-2">
        <Button size="sm" onClick={() => run(report)} disabled={busy || Boolean(done)} className="gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {done ? "Holdout used" : "Run the holdout"}
        </Button>
      </div>

      {busy && (
        <div className="space-y-1">
          <Progress value={pctDone} className="h-1.5" />
          <p className="text-[11px] text-muted-foreground">{state.progress.label}</p>
        </div>
      )}

      {state.error && <p className="text-xs text-destructive">{state.error}</p>}

      {done && state.result && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            {state.result.symbol} · {state.result.fromMonth} → {state.result.toMonth}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3">Config</th>
                  <th className="py-1 pr-3">Trades</th>
                  <th className="py-1 pr-3">Win</th>
                  <th className="py-1 pr-3">Avg R</th>
                  <th className="py-1 pr-3">Discovery avg R</th>
                  <th className="py-1 pr-3">Net Sharpe</th>
                  <th className="py-1 pr-3">Max DD (R)</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {state.result.rows.map((r) => (
                  <tr key={r.hash} className="border-t border-border/40">
                    <td className="py-1 pr-3 font-mono">
                      {r.namedKey ?? r.hash.slice(0, 8)}
                      <span className="ml-1 text-muted-foreground">
                        {r.origin === "named" ? "taught" : "survivor"}
                      </span>
                    </td>
                    <td className="py-1 pr-3">{r.trades}</td>
                    <td className="py-1 pr-3">{pct(r.winRate)}</td>
                    <td className="py-1 pr-3">{n2(r.avgR)}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{n2(r.discoveryAvgR)}</td>
                    <td className="py-1 pr-3">{n2(r.netSharpe)}</td>
                    <td className="py-1 pr-3">{n2(r.maxDrawdownR)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
