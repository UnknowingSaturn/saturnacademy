// ============================================================================
// Backtest tab (Layer 4) — a three-step workflow: data, strategy, run.
// The step panel changes; the header (what you test) and the results column
// (what came out) stay put. Config lives in local state; the run is explicit.
// ============================================================================

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Database, Loader2, SlidersHorizontal, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarCoveragePanel } from "@/components/pair-lab/backtest/BarCoveragePanel";
import { Mt5ImportPanel } from "@/components/pair-lab/backtest/Mt5ImportPanel";
import { WalkForwardReportPanel } from "@/components/pair-lab/backtest/WalkForwardReportPanel";
import { BacktestHeader } from "@/components/pair-lab/backtest/BacktestHeader";
import { StrategyPanel } from "@/components/pair-lab/backtest/StrategyPanel";
import { RunPanel } from "@/components/pair-lab/backtest/RunPanel";
import {
  windowsForKeys, DEFAULT_WF, type UiConfig, type WfUi,
} from "@/components/pair-lab/backtest/config";
import { BacktestResults } from "@/components/pair-lab/backtest/BacktestResults";
import { useIctBacktest, type RunParams } from "@/hooks/useIctBacktest";
import { useBarCoverage } from "@/hooks/useBarCoverage";
import { useDerivedInstrumentCost } from "@/hooks/useDerivedInstrumentCost";
import { DEFAULT_ENGINE_CONFIG } from "../../../../shared/quant/ict/engine";
import { expandGrid, type GridAxis } from "../../../../shared/quant/ict/walkforward";
import { normalizeSymbol } from "../../../../shared/quant/symbolAliasing";

const FALLBACK_SYMBOLS = ["NAS100", "SP500", "EURUSD", "GBPUSD", "USDJPY", "XAUUSD"];

function monthsAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

const { window: _defaultWindow, ...RULE_DEFAULTS } = DEFAULT_ENGINE_CONFIG;

/** Sweep axes stay small and bounded — a big grid buys noise, not edge. */
function gridAxes(wf: WfUi): GridAxis {
  const axes: GridAxis = {};
  if (wf.sweepTargetR) axes.targetR = [1.5, 2, 3, 4];
  if (wf.sweepEntry) axes.entry = ["proximal", "mid", "distal"];
  if (wf.sweepStopBuffer) axes.stopBufferTicks = [1, 2, 4, 8];
  return axes;
}

const STEPS = [
  { key: "data", label: "Data", icon: Database },
  { key: "strategy", label: "Strategy", icon: SlidersHorizontal },
  { key: "run", label: "Run", icon: Play },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export function BacktestTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const step = (searchParams.get("btStep") as StepKey) ?? "data";
  const setStep = useCallback(
    (next: StepKey) => {
      const p = new URLSearchParams(searchParams);
      p.set("btStep", next);
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [symbol, setSymbol] = useState("NAS100");
  const [fromMonth, setFromMonth] = useState(monthsAgo(12));
  const [toMonth, setToMonth] = useState(monthsAgo(1));
  const [cfg, setCfg] = useState<UiConfig>({ ...RULE_DEFAULTS, windowKeys: ["ny_am"] });
  const [wf, setWf] = useState<WfUi>(DEFAULT_WF);
  const [persist, setPersist] = useState(true);

  const { snapshot } = useBarCoverage(symbol);
  // Imported (broker) symbols first — they are what the user actually has data
  // for; the vendor catalogue only matters for the Dukascopy fallback.
  const symbols = useMemo(() => {
    const list = [
      ...(snapshot?.importedSymbols ?? []),
      ...(snapshot?.instruments ?? []).map((i) => normalizeSymbol(i.symbol)),
    ];
    const unique = [...new Set(list)];
    return unique.length ? unique : FALLBACK_SYMBOLS;
  }, [snapshot]);

  /** Step 1 is "done" once the symbol has months ingested with no big holes. */
  const dataReady = useMemo(() => {
    const rows = (snapshot?.manifest ?? []).filter((m) => m.symbol === symbol);
    return rows.length > 0 && rows.every((r) => (r.missing_minutes ?? 0) <= 2000);
  }, [snapshot, symbol]);

  const { derived, override } = useDerivedInstrumentCost(symbol);
  const {
    run, loadRun, result, isRunning, phase, loaded, total, error, coverageWarning, savedRunId,
  } = useIctBacktest();

  const patch = useCallback(
    (p: Partial<UiConfig>) => setCfg((c) => ({ ...c, ...p })),
    [],
  );
  const patchWf = useCallback((p: Partial<WfUi>) => setWf((w) => ({ ...w, ...p })), []);
  const onMonths = useCallback((f: string, t: string) => {
    setFromMonth(f);
    setToMonth(t);
  }, []);

  const gridSize = useMemo(() => expandGrid(gridAxes(wf)).length, [wf]);

  const buildParams = useCallback(
    (ignoreCoverageGaps: boolean): RunParams => {
      const { windowKeys, ...rules } = cfg;
      return {
        symbol,
        fromMonth,
        toMonth,
        cfg: { ...rules, windows: windowsForKeys(windowKeys) },
        mode: wf.enabled ? "walkforward" : "single",
        walkForward: wf.enabled
          ? {
              trainMonths: wf.trainMonths,
              testMonths: wf.testMonths,
              anchored: wf.anchored,
              minTrainTrades: wf.minTrainTrades,
              grid: gridAxes(wf),
            }
          : undefined,
        specOverride: override,
        persist,
        ignoreCoverageGaps,
        label: `${normalizeSymbol(symbol)} ${fromMonth}→${toMonth}${wf.enabled ? " WF" : ""}`,
      };
    },
    [cfg, symbol, fromMonth, toMonth, wf, override, persist],
  );

  const onRun = useCallback(() => run(buildParams(false)), [run, buildParams]);
  const onRunAnyway = useCallback(() => run(buildParams(true)), [run, buildParams]);

  const progress = isRunning
    ? phase === "loading"
      ? `Loading bar data — ${loaded}/${total || "?"} months`
      : phase === "saving"
        ? "Saving the run…"
        : wf.enabled
          ? `Running ${gridSize} rule set(s) across every fold…`
          : "Running the engine over every session…"
    : null;

  return (
    <div className="space-y-4">
      <BacktestHeader
        symbols={symbols}
        symbol={symbol}
        onSymbol={setSymbol}
        fromMonth={fromMonth}
        toMonth={toMonth}
        onMonths={onMonths}
        onRun={onRun}
        isRunning={isRunning}
        runLabel={wf.enabled ? "Run walk-forward" : "Run backtest"}
        progress={progress}
        historySymbol={normalizeSymbol(symbol)}
        onOpenRun={loadRun}
      />

      <div className="grid lg:grid-cols-[360px_1fr] gap-4 items-start">
        <div className="space-y-3">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const active = step === s.key;
              const done = s.key === "data" && dataReady;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStep(s.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                    active
                      ? "border-primary/60 bg-primary/10 font-medium"
                      : "border-border/50 text-muted-foreground hover:bg-muted/30"
                  }`}
                >
                  {done && !active
                    ? <Check className="w-3.5 h-3.5 text-primary" />
                    : <Icon className="w-3.5 h-3.5" />}
                  <span>{i + 1}. {s.label}</span>
                </button>
              );
            })}
          </div>

          {step === "data" && (
            <>
              <Mt5ImportPanel symbol={symbol} onImported={() => setSymbol((s) => s)} />
              <BarCoveragePanel symbol={symbol} fromMonth={fromMonth} toMonth={toMonth} />
              {derived && (
                <p className="text-[11px] text-muted-foreground px-1">{derived.note}</p>
              )}
            </>
          )}

          {step === "strategy" && <StrategyPanel cfg={cfg} onChange={patch} />}

          {step === "run" && (
            <RunPanel
              cfg={cfg}
              onChange={patch}
              wf={wf}
              onWf={patchWf}
              persist={persist}
              onPersist={setPersist}
              gridSize={gridSize}
            />
          )}
        </div>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {coverageWarning && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2">
              <p className="text-sm text-destructive">
                {coverageWarning.months.length} month(s) have large gaps (up to{" "}
                {coverageWarning.missingMinutes.toLocaleString()} missing minutes):{" "}
                {coverageWarning.months.join(", ")}. Sessions inside those holes are silently
                skipped, which flatters the results.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={onRunAnyway}>
                  Run anyway
                </Button>
              </div>
            </div>
          )}

          {isRunning && (
            <div className="rounded-lg border border-border/60 p-6 flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{progress}</p>
            </div>
          )}

          {!isRunning && result?.walkForward && (
            <WalkForwardReportPanel report={result.walkForward} />
          )}

          {!isRunning && result && <BacktestResults result={result} />}

          {savedRunId && !isRunning && (
            <p className="text-[11px] text-muted-foreground">Saved to run history.</p>
          )}

          {!isRunning && !result && !error && !coverageWarning && (
            <div className="rounded-lg border border-dashed border-border/60 p-8 text-center space-y-2">
              <h3 className="text-sm font-medium">No backtest yet</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Step 1: import your MT5 M1 history (or queue the vendor fallback). Step 2: pick a
                named strategy and adjust the rules. Step 3: set sizing and walk-forward, then run.
                Entries fill on limit at the chosen FVG edge; ambiguous bars resolve stop-first,
                so results stay pessimistic.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
