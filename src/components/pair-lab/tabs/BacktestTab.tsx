// ============================================================================
// Backtest tab (Layer 4) — data coverage, rule controls, results.
//
// Config lives in local state (URL-persisting 25 knobs would be unreadable);
// the run is explicit, so nothing heavy fires while the user tweaks rules.
// ============================================================================

import { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { BarCoveragePanel } from "@/components/pair-lab/backtest/BarCoveragePanel";
import {
  BacktestControls,
  windowForKey,
  type UiConfig,
} from "@/components/pair-lab/backtest/BacktestControls";
import { BacktestResults } from "@/components/pair-lab/backtest/BacktestResults";
import { useIctBacktest } from "@/hooks/useIctBacktest";
import { useBarCoverage } from "@/hooks/useBarCoverage";
import { DEFAULT_ENGINE_CONFIG } from "../../../../shared/quant/ict/engine";

const FALLBACK_SYMBOLS = ["NASUSD", "SPXUSD", "EURUSD", "GBPUSD", "USDJPY", "XAUUSD"];

function monthsAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

const { window: _defaultWindow, ...RULE_DEFAULTS } = DEFAULT_ENGINE_CONFIG;

export function BacktestTab() {
  const [symbol, setSymbol] = useState("NASUSD");
  const [fromMonth, setFromMonth] = useState(monthsAgo(12));
  const [toMonth, setToMonth] = useState(monthsAgo(1));
  const [cfg, setCfg] = useState<UiConfig>({ ...RULE_DEFAULTS, windowKey: "ny_am" });

  const { snapshot } = useBarCoverage(null);
  const symbols = useMemo(() => {
    const list = (snapshot?.instruments ?? []).map((i) => i.symbol);
    return list.length ? list : FALLBACK_SYMBOLS;
  }, [snapshot]);

  const { run, result, isRunning, phase, loaded, total, error } = useIctBacktest();

  const patch = useCallback(
    (p: Partial<UiConfig>) => setCfg((c) => ({ ...c, ...p })),
    [],
  );
  const onMonths = useCallback((f: string, t: string) => {
    setFromMonth(f);
    setToMonth(t);
  }, []);

  const onRun = useCallback(() => {
    const { windowKey, ...rules } = cfg;
    run({
      symbol,
      fromMonth,
      toMonth,
      cfg: { ...rules, window: windowForKey(windowKey) },
    });
  }, [cfg, symbol, fromMonth, toMonth, run]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4 items-start">
      <div className="space-y-4">
        <BarCoveragePanel symbol={symbol} fromMonth={fromMonth} toMonth={toMonth} />
        <BacktestControls
          cfg={cfg}
          onChange={patch}
          symbols={symbols}
          symbol={symbol}
          onSymbol={setSymbol}
          fromMonth={fromMonth}
          toMonth={toMonth}
          onMonths={onMonths}
          onRun={onRun}
          isRunning={isRunning}
        />
      </div>

      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {isRunning && (
          <div className="rounded-lg border border-border/60 p-6 flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {phase === "loading"
                ? `Loading bar data — ${loaded}/${total || "?"} months`
                : "Running the engine over every session…"}
            </p>
          </div>
        )}

        {!isRunning && result && <BacktestResults result={result} />}

        {!isRunning && !result && !error && (
          <div className="rounded-lg border border-dashed border-border/60 p-8 text-center space-y-2">
            <h3 className="text-sm font-medium">No backtest yet</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Pick a symbol and month range, queue the bar data if a month is missing,
              set your ICT rules, then run. Entries fill on limit at the chosen FVG edge;
              ambiguous bars resolve stop-first, so results stay pessimistic.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
