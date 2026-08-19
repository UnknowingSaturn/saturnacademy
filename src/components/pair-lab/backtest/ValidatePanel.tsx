// ============================================================================
// Validate step (Layer 5) — the sweep, the nulls, the statistics.
//
// The panel deliberately gates the expensive part behind a benchmark: you see
// the measured per-config cost and the sample size it implies BEFORE anything
// runs for an hour and a half. Nothing here reads the holdout period.
// ============================================================================

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Download, FlaskConical, Loader2, Play, RotateCcw, TriangleAlert } from "lucide-react";
import { useIctSweep } from "@/hooks/useIctSweep";
import type { NullReport, SweepReport } from "@/lib/backtest/summaryPack";
import { SWEEP } from "../../../../shared/quant/ict/sweep";

const HOLDOUT_START_MONTH = SWEEP.holdoutFromMonth;

const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "n/a");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

interface Props {
  symbol: string;
  fromMonth: string;
  toMonth: string;
}

export function ValidatePanel({ symbol, fromMonth, toMonth }: Props) {
  const sweep = useIctSweep();
  const [validationSymbol, setValidationSymbol] = useState("");
  const [seed, setSeed] = useState(20260101);

  const holdoutClash = toMonth >= HOLDOUT_START_MONTH;
  const busy =
    sweep.phase === "loading" || sweep.phase === "benchmarking" ||
    sweep.phase === "sweeping" || sweep.phase === "analysing" || sweep.phase === "validating";

  const pctDone = sweep.progress.total
    ? Math.round((sweep.progress.done / sweep.progress.total) * 100)
    : 0;

  const start = () =>
    sweep.benchmark({
      discoverySymbol: symbol,
      validationSymbol: validationSymbol.trim() || null,
      fromMonth,
      toMonth,
      seed,
    });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-medium">Sweep &amp; validate</h3>
          <Badge variant="outline" className="text-[10px]">holdout locked</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Benchmarks 50 configs first, then sizes the sweep to a 90-minute budget. Discovery runs on{" "}
          <span className="font-mono">{symbol}</span>; survivors are re-run once, raw, on the
          validation symbol. Nothing after {HOLDOUT_START_MONTH} is ever loaded.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Validation symbol</Label>
            <Input
              value={validationSymbol}
              onChange={(e) => setValidationSymbol(e.target.value)}
              placeholder="e.g. SPX500 (optional)"
              className="h-8 text-xs"
              disabled={busy}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Seed</Label>
            <Input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 1)}
              className="h-8 text-xs"
              disabled={busy}
            />
          </div>
        </div>

        {holdoutClash && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
            <TriangleAlert className="w-3.5 h-3.5 text-destructive mt-0.5" />
            <p className="text-[11px] text-destructive">
              End month {toMonth} reaches into the holdout ({HOLDOUT_START_MONTH}+). Pull the range
              back before sweeping.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" onClick={start} disabled={busy || holdoutClash} className="gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Benchmark
          </Button>
          {busy && (
            <Button size="sm" variant="outline" onClick={sweep.cancel}>Cancel</Button>
          )}
          {sweep.phase === "done" && (
            <>
              <Button size="sm" variant="outline" onClick={sweep.downloadPack} className="gap-1.5">
                <Download className="w-3.5 h-3.5" /> Summary pack
              </Button>
              <Button size="sm" variant="ghost" onClick={sweep.reset} className="gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> New sweep
              </Button>
            </>
          )}
        </div>

        {busy && (
          <div className="space-y-1">
            <Progress value={pctDone} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground">
              {sweep.progress.label} {sweep.progress.total ? `— ${sweep.progress.done}/${sweep.progress.total}` : ""}
            </p>
          </div>
        )}

        {sweep.error && <p className="text-xs text-destructive">{sweep.error}</p>}
      </div>

      {sweep.phase === "awaiting_go" && sweep.sizing && (
        <div className="rounded-lg border border-primary/50 bg-primary/5 p-4 space-y-3">
          <h4 className="text-sm font-medium">Benchmark complete — confirm the sweep size</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Median / config" value={`${sweep.sizing.medianSecPerConfig.toFixed(2)}s`} />
            <Stat label="Workers" value={String(sweep.sizing.workers)} />
            <Stat label="Configs to run" value={sweep.sizing.n.toLocaleString()} />
            <Stat label="Est. wall clock" value={`${Math.round(sweep.sizing.projectedMinutes)} min`} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Canonical grid holds {sweep.gridSize.toLocaleString()} distinct configurations.{" "}
            {sweep.sizing.n >= sweep.gridSize
              ? "The grid is small enough to run exhaustively."
              : `Sampling ${sweep.sizing.n.toLocaleString()} of them, uniformly at random from seed ${seed}.`}
            {sweep.resumed > 0 && ` ${sweep.resumed.toLocaleString()} results resume from a checkpoint.`}
          </p>
          <Button size="sm" onClick={sweep.launch} className="gap-1.5">
            <Play className="w-3.5 h-3.5" /> Run the sweep
          </Button>
        </div>
      )}

      {sweep.report && <SweepReportView report={sweep.report} savedRunId={sweep.savedRunId} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SweepReportView({ report, savedRunId }: { report: SweepReport; savedRunId: string | null }) {
  const top = useMemo(() => report.survivors.slice(0, 15), [report.survivors]);
  const validationByHash = useMemo(
    () => new Map(report.validationRows.map((r) => [r.hash, r])),
    [report.validationRows],
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border/60 p-4 space-y-2">
        <h4 className="text-sm font-medium">Funnel</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          {Object.entries(report.funnel).map(([k, v]) => (
            <Stat key={k} label={k.replace(/_/g, " ")} value={v.toLocaleString()} />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Ran in {Math.round(report.timing.totalSeconds / 60)} min on {report.timing.workers} workers.
          {savedRunId && " Saved to run history with the full summary pack."}
        </p>
      </section>

      {report.dsr && (
        <section className="rounded-lg border border-border/60 p-4 space-y-2">
          <h4 className="text-sm font-medium">Deflated Sharpe — {report.dsr.configKey}</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Observed SR" value={n2(report.dsr.observedSharpe)} />
            <Stat label="Expected max SR" value={n2(report.dsr.expectedMaxSharpe)} />
            <Stat label="DSR" value={report.dsr.dsr.toFixed(3)} />
            <Stat label="Trials" value={report.dsr.trials.toLocaleString()} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {report.dsr.dsr > 0.95
              ? "Survives deflation: the observed Sharpe exceeds what this many trials produce by luck."
              : "Does not survive deflation — the Sharpe is inside the range selection bias alone can generate."}
          </p>
        </section>
      )}

      <section className="rounded-lg border border-border/60 p-4 space-y-3">
        <h4 className="text-sm font-medium">
          FDR survivors (q={report.fdr.q}) — {report.survivors.length} of {report.fdr.tested} tested
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60">
                <Th>config</Th><Th>windows</Th><Th right>trades</Th><Th right>win%</Th>
                <Th right>avg R</Th><Th right>net SR</Th><Th right>maxDD R</Th>
                <Th right>{report.validationSymbol ?? "validation"} avg R</Th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => {
                const v = validationByHash.get(r.hash);
                const holds = v ? Math.abs(v.avgR - r.avgR) <= Math.max(0.1, Math.abs(r.avgR) * 0.5) : null;
                return (
                  <tr key={r.hash} className="border-b border-border/30">
                    <Td className="font-mono">{r.namedKey ?? r.hash.slice(0, 10)}</Td>
                    <Td>{r.windowKeys.join("+")}</Td>
                    <Td right>{r.trades}</Td>
                    <Td right>{pct(r.winRate)}</Td>
                    <Td right>{n2(r.avgR)}</Td>
                    <Td right>{n2(r.netSharpe)}</Td>
                    <Td right>{n2(r.maxDrawdownR)}</Td>
                    <Td right>
                      {v ? (
                        <span className={holds ? "text-primary" : "text-destructive"}>{n2(v.avgR)}</span>
                      ) : "—"}
                    </Td>
                  </tr>
                );
              })}
              {!top.length && (
                <tr><Td colSpan={8} className="text-muted-foreground py-3">
                  Nothing survived the FDR filter — no configuration beat noise once multiple testing was accounted for.
                </Td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 p-4 space-y-3">
        <h4 className="text-sm font-medium">Ablation ladder</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60">
                <Th>rung</Th><Th>symbol</Th><Th right>trades</Th><Th right>win%</Th>
                <Th right>avg R</Th><Th right>net SR</Th><Th right>maxDD R</Th>
              </tr>
            </thead>
            <tbody>
              {report.ablation.map((a, i) => (
                <tr key={`${a.symbol}-${a.rung}-${i}`} className="border-b border-border/30">
                  <Td>
                    {a.label}
                    {a.lookahead && <Badge variant="destructive" className="ml-1.5 text-[9px]">lookahead</Badge>}
                  </Td>
                  <Td className="font-mono">{a.symbol}</Td>
                  <Td right>{a.trades}</Td>
                  <Td right>{pct(a.winRate)}</Td>
                  <Td right>{n2(a.avgR)}</Td>
                  <Td right>{n2(a.netSharpe)}</Td>
                  <Td right>{n2(a.maxDrawdownR)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Each rung adds one requirement. If avg R does not improve when a filter is added, that
          filter is decoration. The perfect-bias rung is the ceiling discretion could ever reach.
        </p>
      </section>

      <section className="rounded-lg border border-border/60 p-4 space-y-3">
        <h4 className="text-sm font-medium">Reference nulls</h4>
        {report.nulls.map((n) => <NullBlock key={`${n.symbol}-${n.configKey}`} n={n} />)}
      </section>

      <section className="rounded-lg border border-border/60 p-4 space-y-2">
        <h4 className="text-sm font-medium">Discretion premium</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60">
                <Th>config</Th><Th right>take-all avg R</Th><Th right>perfect-skip avg R</Th>
                <Th right>skip % for breakeven</Th><Th right>skip % for SR 1.0</Th>
              </tr>
            </thead>
            <tbody>
              {report.discretion.map((d) => (
                <tr key={`${d.symbol}-${d.key}`} className="border-b border-border/30">
                  <Td>{d.label}</Td>
                  <Td right>{n2(d.premium.allSetups.avgR)}</Td>
                  <Td right>{n2(d.premium.perfectSkip.avgR)}</Td>
                  <Td right>{d.premium.skipForBreakeven === null ? "n/a" : pct(d.premium.skipForBreakeven)}</Td>
                  <Td right>{d.premium.skipForSharpe1 === null ? "unreachable" : pct(d.premium.skipForSharpe1)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          The last two columns are the share of losing setups you would have to correctly skip, in
          advance, for discretion to reach breakeven and a 1.0 net Sharpe respectively.
        </p>
      </section>
    </div>
  );
}

function NullBlock({ n }: { n: NullReport }) {
  const rows = [
    { label: "Random entry, same windows", d: n.randomEntry },
    { label: "Other hours, same logic", d: n.otherHours },
    ...(n.shuffledDirection ? [{ label: "Shuffled direction", d: n.shuffledDirection }] : []),
  ];
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">
        {n.label} <span className="font-mono text-muted-foreground">({n.symbol})</span>
      </p>
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border/30">
              <Td>{r.label}</Td>
              <Td right>real {n2(r.d.real)}</Td>
              <Td right>null median {n2(r.d.p50)}</Td>
              <Td right>p95 {n2(r.d.p95)}</Td>
              <Td right>
                <span className={r.d.realPercentile >= 95 ? "text-primary" : "text-muted-foreground"}>
                  {r.d.realPercentile.toFixed(0)}th pct
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`py-1.5 font-normal ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({
  children, right, className = "", colSpan,
}: { children: React.ReactNode; right?: boolean; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={`py-1.5 tabular-nums ${right ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}
