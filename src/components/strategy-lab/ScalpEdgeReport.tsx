import * as React from "react";
import { useMemo, useState } from "react";
import { ChevronRight, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface ScalpCell {
  context: Record<string, string>;
  n: number;
  wins: number;
  win_rate: number;
  expected_R: number;
  std_R: number;
  wilson_low: number;
  verdict: "GO" | "SKIP" | "REVIEW";
}

export interface ScalpReport {
  mode: "conservative" | "aggressive";
  sample_size: number;
  dimensions_detected: string[];
  cells: ScalpCell[];
  coverage_pct: number;
  suggested_next_tag: string | null;
  suggested_next_tag_coverage?: number | null;
  message?: string;
}

const verdictTone: Record<ScalpCell["verdict"], string> = {
  GO: "bg-primary/15 text-primary border-primary/30",
  SKIP: "bg-destructive/15 text-destructive border-destructive/30",
  REVIEW: "bg-muted text-muted-foreground border-border",
};

function formatContext(ctx: Record<string, string>): string {
  return Object.entries(ctx)
    .filter(([k]) => k !== "playbook_id")
    .map(([k, v]) => `${k.replace(/^cf_/, "")}=${v}`)
    .join("  ·  ");
}

export function ScalpEdgeReport({ report }: { report: ScalpReport }) {
  const [showLowConf, setShowLowConf] = useState(false);
  const minN = report.mode === "conservative" ? 20 : 8;

  const visible = useMemo(
    () => (showLowConf ? report.cells : report.cells.filter((c) => c.n >= minN)),
    [report, showLowConf, minN]
  );

  if (!report.cells || report.cells.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {report.message ?? "No edge cells available yet — keep journaling."}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium text-foreground text-sm">Scalp Edge Report</div>
          <div className="text-xs text-muted-foreground">
            {report.sample_size} trades · {report.coverage_pct}% confident coverage ·{" "}
            {report.mode} mode · dims: {report.dimensions_detected.join(", ") || "—"}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showLowConf} onCheckedChange={setShowLowConf} />
          Show low-confidence (n &lt; {minN})
        </label>
      </div>

      {report.suggested_next_tag && (
        <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
          <Lightbulb className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
          <div>
            Next tag to start filling for sharper edges:{" "}
            <span className="font-medium text-foreground">
              {report.suggested_next_tag.replace(/^cf_/, "")}
            </span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left py-1.5 pr-3 font-normal">Verdict</th>
              <th className="text-left py-1.5 pr-3 font-normal">Context</th>
              <th className="text-right py-1.5 pr-3 font-normal">n</th>
              <th className="text-right py-1.5 pr-3 font-normal">Win%</th>
              <th className="text-right py-1.5 pr-3 font-normal">E[R]</th>
              <th className="text-right py-1.5 font-normal">Wilson↓</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => (
              <tr key={i} className="border-b border-border/40 last:border-0">
                <td className="py-1.5 pr-3">
                  <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", verdictTone[c.verdict])}>
                    {c.verdict}
                  </Badge>
                </td>
                <td className="py-1.5 pr-3 text-foreground">{formatContext(c.context)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{c.n}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{(c.win_rate * 100).toFixed(0)}%</td>
                <td
                  className={cn(
                    "py-1.5 pr-3 text-right tabular-nums",
                    c.expected_R > 0 ? "text-primary" : c.expected_R < 0 ? "text-destructive" : ""
                  )}
                >
                  {c.expected_R.toFixed(2)}R
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {(c.wilson_low * 100).toFixed(0)}%
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-muted-foreground">
                  No cells meet n ≥ {minN}. Toggle low-confidence to inspect.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ScalpLookupResult({
  match,
  matched_keys,
  query,
}: {
  match: ScalpCell | null;
  matched_keys: number;
  query: Record<string, string>;
}) {
  if (!match) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        No matching context found for {JSON.stringify(query)}.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", verdictTone[match.verdict])}>
          {match.verdict}
        </Badge>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-foreground">{formatContext(match.context)}</span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        n={match.n} · win={(match.win_rate * 100).toFixed(0)}% · E[R]={match.expected_R.toFixed(2)} ·
        wilson↓={(match.wilson_low * 100).toFixed(0)}% · matched {matched_keys} keys
      </div>
    </div>
  );
}
