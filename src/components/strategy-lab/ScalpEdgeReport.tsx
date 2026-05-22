import * as React from "react";
import { useMemo, useState } from "react";
import { ChevronRight, Lightbulb, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Verdict = "GO" | "SKIP" | "REVIEW";
type Confidence = "high" | "moderate" | "low";

export interface ScalpCell {
  context: Record<string, string>;
  n: number;
  wins: number;
  win_rate: number;
  expected_R: number;
  expected_R_shrunk?: number;
  std_R: number;
  wilson_low: number;
  verdict: Verdict;
  confidence?: Confidence;
}

export interface ScalpMarginalValue {
  value: string;
  n: number;
  wins: number;
  win_rate: number;
  expected_R: number;
  expected_R_shrunk?: number;
  wilson_low: number;
  verdict: Verdict;
  confidence?: Confidence;
}

export interface ScalpMarginal {
  dim: string;
  values: ScalpMarginalValue[];
}

export interface ScalpReport {
  mode: "conservative" | "aggressive";
  sample_size: number;
  dimensions_detected: string[];
  cells: ScalpCell[];
  marginals?: ScalpMarginal[];
  coverage_pct: number;
  joint_coverage_pct?: number;
  marginal_coverage_pct?: number;
  suggested_next_tag: string | null;
  suggested_next_tag_coverage?: number | null;
  suggestion?: {
    kind: "coarsen" | "complete" | "none";
    dim: string | null;
    reason: string;
  };
  message?: string;
}

const verdictTone: Record<Verdict, string> = {
  GO: "bg-primary/15 text-primary border-primary/30",
  SKIP: "bg-destructive/15 text-destructive border-destructive/30",
  REVIEW: "bg-muted text-muted-foreground border-border",
};

const confidenceTone: Record<Confidence, string> = {
  high: "bg-primary/10 text-primary",
  moderate: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  low: "bg-muted text-muted-foreground",
};

function formatContext(ctx: Record<string, string>): string {
  return Object.entries(ctx)
    .filter(([k]) => k !== "playbook_id")
    .map(([k, v]) => `${k.replace(/^cf_/, "")}=${v}`)
    .join("  ·  ");
}

function cleanDim(d: string) {
  return d.replace(/^cf_/, "");
}

function MarginalsSection({
  marginals,
  minN,
  showLowConf,
}: {
  marginals: ScalpMarginal[];
  minN: number;
  showLowConf: boolean;
}) {
  if (!marginals.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          By single tag
        </h4>
        <span className="text-[10px] text-muted-foreground">
          Per-dimension breakdowns — most reliable view when sample is thin
        </span>
      </div>
      <div className="space-y-4">
        {marginals.map((m) => {
          const visible = showLowConf
            ? m.values
            : m.values.filter((v) => (v.confidence ?? (v.n >= minN ? "high" : "low")) !== "low");
          if (visible.length === 0) return null;
          return (
            <div key={m.dim} className="rounded-md border border-border/60 bg-muted/20">
              <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">{cleanDim(m.dim)}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {m.values.length} values
                </span>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {visible.map((v, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/30"
                    >
                      <td className="py-1.5 pl-3 pr-2 w-16">
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] px-1.5 py-0", verdictTone[v.verdict])}
                        >
                          {v.verdict}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-3 text-foreground font-medium">{v.value}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground w-14">
                        n={v.n}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums w-14">
                        {(v.win_rate * 100).toFixed(0)}%
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-3 text-right tabular-nums w-20",
                          v.expected_R > 0
                            ? "text-primary"
                            : v.expected_R < 0
                              ? "text-destructive"
                              : ""
                        )}
                      >
                        {v.expected_R.toFixed(2)}R
                      </td>
                      <td className="py-1.5 pr-3 w-20 text-right">
                        {v.confidence && (
                          <span
                            className={cn(
                              "inline-block rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                              confidenceTone[v.confidence]
                            )}
                          >
                            {v.confidence}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ScalpEdgeReport({ report }: { report: ScalpReport }) {
  const [showLowConf, setShowLowConf] = useState(false);
  const minN = report.mode === "conservative" ? 20 : 8;
  const marginals = report.marginals ?? [];
  const jointCov = report.joint_coverage_pct ?? report.coverage_pct ?? 0;
  const marginalCov = report.marginal_coverage_pct ?? 0;
  const hasMarginals = marginals.length > 0;
  const jointCollapsedDefault = jointCov < 20;
  const [showJoint, setShowJoint] = useState(!jointCollapsedDefault);

  const visibleCells = useMemo(
    () => (showLowConf ? report.cells : report.cells.filter((c) => c.n >= minN)),
    [report, showLowConf, minN]
  );

  if ((!report.cells || report.cells.length === 0) && !hasMarginals) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {report.message ?? "No edge cells available yet — keep journaling."}
      </div>
    );
  }

  const suggestion = report.suggestion;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="font-medium text-foreground text-sm">Scalp Edge Report</div>
            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="tabular-nums">{report.sample_size} trades</span>
              <span>·</span>
              <span>{report.mode} mode</span>
              {report.dimensions_detected.length > 0 && (
                <>
                  <span>·</span>
                  <span>
                    joint dims: {report.dimensions_detected.map(cleanDim).join(", ")}
                  </span>
                </>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">
              <span className="text-foreground tabular-nums font-medium">
                {marginalCov.toFixed(0)}%
              </span>
              <span>of trades covered by at least one meaningful tag</span>
              <span>·</span>
              <span className="text-foreground tabular-nums font-medium">
                {jointCov.toFixed(0)}%
              </span>
              <span>land in fully-confident joint cells</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground">
                    <Info className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Single-tag coverage uses each dimension on its own (n ≥ {minN} per value).
                  Joint coverage requires the full {report.dimensions_detected.length || 0}-way
                  combo to reach n ≥ {minN}, which is hard at small sample sizes — single-tag
                  is what to act on first.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            <Switch checked={showLowConf} onCheckedChange={setShowLowConf} />
            Show low-confidence (n &lt; {minN})
          </label>
        </div>

        {/* Suggestion */}
        {suggestion && suggestion.kind !== "none" && suggestion.dim ? (
          <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            <Lightbulb className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-foreground">
                {suggestion.kind === "coarsen" ? "Coarsen this tag" : "Complete this tag"}:{" "}
                {cleanDim(suggestion.dim)}
              </span>
              <span className="text-muted-foreground"> — {suggestion.reason}</span>
            </div>
          </div>
        ) : suggestion ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{suggestion.reason}</span>
          </div>
        ) : (
          report.suggested_next_tag && (
            <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <Lightbulb className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <div>
                Most informative tag:{" "}
                <span className="font-medium text-foreground">
                  {cleanDim(report.suggested_next_tag)}
                </span>
              </div>
            </div>
          )
        )}

        {/* Primary view: marginals */}
        {hasMarginals && (
          <MarginalsSection marginals={marginals} minN={minN} showLowConf={showLowConf} />
        )}

        {/* Joint cells — collapsed when sparse */}
        {report.cells.length > 0 && (
          <Collapsible open={showJoint} onOpenChange={setShowJoint}>
            <CollapsibleTrigger className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight
                className={cn("h-3 w-3 transition-transform", showJoint && "rotate-90")}
              />
              Joint cells
              {jointCollapsedDefault && (
                <span className="font-normal normal-case tracking-normal text-[10px] text-muted-foreground">
                  (sparse — single-tag view above is more reliable)
                </span>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
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
                    {visibleCells.map((c, i) => {
                      const conf = c.confidence ?? (c.n >= minN ? "high" : "low");
                      const shrunk = c.expected_R_shrunk;
                      return (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                          <td className="py-1.5 pr-3">
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] px-1.5 py-0", verdictTone[c.verdict])}
                            >
                              {c.verdict}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-3 text-foreground">
                            <div className="flex items-center gap-1.5">
                              <span>{formatContext(c.context)}</span>
                              {conf !== "high" && (
                                <span
                                  className={cn(
                                    "inline-block rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                                    confidenceTone[conf]
                                  )}
                                >
                                  {conf}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{c.n}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {(c.win_rate * 100).toFixed(0)}%
                          </td>
                          <td
                            className={cn(
                              "py-1.5 pr-3 text-right tabular-nums",
                              c.expected_R > 0
                                ? "text-primary"
                                : c.expected_R < 0
                                  ? "text-destructive"
                                  : ""
                            )}
                          >
                            {conf !== "high" && shrunk != null ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help underline decoration-dotted underline-offset-2">
                                    {shrunk.toFixed(2)}R*
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">
                                  Raw: {c.expected_R.toFixed(2)}R · shown shrunk toward global
                                  mean because n &lt; {minN}.
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              `${c.expected_R.toFixed(2)}R`
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                            {(c.wilson_low * 100).toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                    {visibleCells.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-3 text-center text-muted-foreground">
                          No joint cells meet n ≥ {minN}. Toggle low-confidence to inspect.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </TooltipProvider>
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
        <Badge
          variant="outline"
          className={cn("text-[10px] px-1.5 py-0", verdictTone[match.verdict])}
        >
          {match.verdict}
        </Badge>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-foreground">{formatContext(match.context)}</span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        n={match.n} · win={(match.win_rate * 100).toFixed(0)}% · E[R]=
        {match.expected_R.toFixed(2)} · wilson↓={(match.wilson_low * 100).toFixed(0)}% · matched{" "}
        {matched_keys} keys
      </div>
    </div>
  );
}
