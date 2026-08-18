// ============================================================================
// Run history — stored runs are re-openable and comparable. Nothing here
// recomputes: a stored run's metrics and fills come straight out of the DB.
// ============================================================================

import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "lucide-react";
import { useBacktestRuns, type BacktestRunRow } from "@/hooks/useBacktestRuns";
import type { IctBacktestResponse } from "@/workers/ictBacktest.worker";

interface Props {
  symbol: string;
  onOpen: (result: IctBacktestResponse) => void;
}

function runExpectancy(row: BacktestRunRow): string {
  const stats = (row.metrics as { stats?: { meanR?: number } })?.stats;
  if (!stats || typeof stats.meanR !== "number") return "—";
  return `${stats.meanR >= 0 ? "" : "-"}${Math.abs(stats.meanR).toFixed(2)}R`;
}

export function RunHistoryPanel({ symbol, onOpen }: Props) {
  const { runs, isLoading, remove, load } = useBacktestRuns(symbol);

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Run history</h3>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {!isLoading && runs.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No saved runs for {symbol} yet. Runs are saved when "Save this run to history" is on.
        </p>
      )}

      <div className="space-y-1.5">
        {runs.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className="flex-1 text-left rounded border border-border/50 px-2 py-1.5 hover:bg-muted/30 transition-colors"
              onClick={() => load.mutate(r, { onSuccess: onOpen })}
            >
              <span className="font-medium">{r.label}</span>
              <span className="text-muted-foreground">
                {" "}· {r.trade_count} trades · {runExpectancy(r)}
                {r.include_holdout && " · walk-forward"}
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}
              </span>
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label={`Delete run ${r.label}`}
              onClick={() => remove.mutate(r.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
