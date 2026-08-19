// ============================================================================
// Data coverage — which months of 1-minute bars exist for a symbol, plus the
// enqueue / drain controls that fill the gaps.
// ============================================================================

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Download, ChevronRight, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useBarCoverage } from "@/hooks/useBarCoverage";

interface Props {
  symbol: string;
  fromMonth: string;
  toMonth: string;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function BarCoveragePanel({ symbol, fromMonth, toMonth }: Props) {
  const { snapshot, isLoading, error, refetch, enqueue, drain, isDraining } =
    useBarCoverage(symbol);
  const [from, setFrom] = useState(fromMonth);
  const [to, setTo] = useState(toMonth);

  const rows = useMemo(
    () => (snapshot?.manifest ?? []).filter((m) => m.symbol === symbol),
    [snapshot, symbol],
  );
  const jobs = useMemo(
    () => (snapshot?.jobs ?? []).filter((j) => j.symbol === symbol),
    [snapshot, symbol],
  );
  const pending = jobs.filter((j) => j.status === "pending").length;
  const failed = jobs.filter((j) => j.status === "failed");
  const totalBars = rows.reduce((a, r) => a + (r.bar_count ?? 0), 0);
  const missing = rows.reduce((a, r) => a + (r.missing_minutes ?? 0), 0);
  const validRange = MONTH_RE.test(from) && MONTH_RE.test(to) && from <= to;

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Data coverage — {symbol}</h3>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading manifest…"
              : `${rows.length} month${rows.length === 1 ? "" : "s"} ingested · ${totalBars.toLocaleString()} bars · ${missing.toLocaleString()} missing minutes`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          aria-label="Refresh coverage"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <p className="text-xs text-muted-foreground">
        Vendor fallback (Dukascopy) — use it for history your terminal no longer holds.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="cov-from" className="text-xs">From</Label>
          <Input
            id="cov-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="YYYY-MM"
            className="h-8 w-28"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cov-to" className="text-xs">To</Label>
          <Input
            id="cov-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="YYYY-MM"
            className="h-8 w-28"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!validRange || enqueue.isPending}
          onClick={() => enqueue.mutate({ symbol, from, to })}
        >
          {enqueue.isPending ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5 mr-1.5" />
          )}
          Queue months
        </Button>
        <Button size="sm" disabled={isDraining || pending === 0} onClick={() => void drain()}>
          {isDraining && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Fetch queued ({pending})
        </Button>
      </div>

      {failed.length > 0 && (
        <div className="space-y-0.5">
          {failed.slice(0, 3).map((j) => (
            <p key={`${j.month}-${j.source}`} className="text-xs text-destructive break-words">
              {j.month} failed after {j.attempts} attempt{j.attempts === 1 ? "" : "s"} —{" "}
              {j.last_error?.slice(0, 160) ?? "unknown error"}
            </p>
          ))}
          {failed.length > 3 && (
            <p className="text-xs text-destructive">+{failed.length - 3} more failed month(s)</p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rows.map((r) => {
            const gap = (r.missing_minutes ?? 0) > 2000;
            return (
              <span
                key={r.month}
                title={`${r.source} · ${r.bar_count.toLocaleString()} bars · ${r.missing_minutes.toLocaleString()} missing minutes`}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  gap
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border/50 bg-muted/20 text-muted-foreground"
                }`}
              >
                {r.month}
                {r.source === "broker" && <span className="ml-1 opacity-70">MT5</span>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
