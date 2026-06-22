// ============================================================================
// Strategy Lab — joint sweep of risk % × rotation model.
// Replaces the separate Risk Lab and Rotation Lab tabs.
//
// Why joint: risk and rotation interact. The optimal rotation at 1.0% risk
// is not necessarily the optimal rotation at 2.0%. Testing them separately
// hides the true optimum.
// ============================================================================

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Sparkles, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Trade } from "@/types/trading";
import {
  runMonteCarlo,
  extractRSample,
  meanRWithCI,
  ROTATION_LABELS,
  type RotationModel,
  type MCParams,
  type MCResult,
} from "@/lib/propFirmMonteCarlo";
import { NumericInput } from "./NumericInput";
import { classifyDataTier, DATA_TIER_VALIDATED_N } from "../../../shared/quant/config";


interface Props {
  trades: Trade[];
  /** Per-account starting balance from simulator profile / active account. */
  defaultAccountSize: number;
  /** Active prop-firm rules (already converted to $). Null when "Any profile". */
  dailyLossDollars: number | null;
  maxDrawdownDollars: number | null;
  /** Whether a real prop-firm profile is selected. */
  hasPropFirmProfile: boolean;
}

const RISK_TIERS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const ROTATION_MODELS: RotationModel[] = ["one_only", "simultaneous", "stay_on_winner", "round_robin"];
const TARGET_PRESETS = [6, 8, 10, 12];
const WINDOW_PRESETS = [30, 60, 90];

// Score components (exposed for the breakdown line).
//
// All three terms live on the 0–1 probability scale so the additive form is
// dimensionally consistent:
//   passProb × survival  → 0–1 probability of finishing in the money
//   ddPenalty            → 0.02 per 1pp of avgDD above 5%, capped at 0.4
//                          (so a 25% avg DD costs 0.4, comparable to passProb)
//   inconclusivePenalty  → fraction of paths that neither passed nor fully
//                          failed within the window
function scoreCellParts(r: MCResult, inconclusiveWeight = 0.1) {
  const survival = 1 - r.riskOfRuin;
  const ddPenaltyRaw = 0.02 * Math.max(0, r.avgDrawdownPct - 5);
  const ddPenalty = Math.min(0.4, ddPenaltyRaw);
  const inconclusivePenalty = inconclusiveWeight * r.inconclusiveProb;
  const score = r.passProb * survival - ddPenalty - inconclusivePenalty;
  return { passProb: r.passProb, survival, ddPenalty, inconclusivePenalty, score };
}

// Deterministic but distinct seed per cell — prevents the heatmap from showing
// artificial similarity between cells that happen to walk the same sample path.
function cellSeed(model: RotationModel, risk: number): number {
  const modelIdx = ROTATION_MODELS.indexOf(model);
  // Encode model in high bits, risk×100 in low bits.
  return ((modelIdx + 1) * 100003) ^ Math.round(risk * 1000) ^ 0x5f3759df;
}

// Auto-detect average trades/day from the user's history.
//
// Denominator is the count of *distinct dates with at least one closed trade*.
// Prior versions used calendar span × 5/7 which under-counted for traders
// who skip many sessions (e.g. only trading London open), biasing simulated
// pass-prob downward. Distinct-active-days is the right denominator because
// the simulator's `tradesPerDay` should describe *days on which trading
// happens*, not days on the wall calendar.
function autoTradesPerDay(trades: Trade[]): number {
  const activeDays = new Set<string>();
  let n = 0;
  for (const t of trades) {
    if (t.is_open || t.is_archived) continue;
    if (t.r_multiple_actual == null) continue;
    if (!t.entry_time) continue;
    activeDays.add(String(t.entry_time).slice(0, 10));
    n += 1;
  }
  if (n === 0 || activeDays.size === 0) return 2;
  return Math.max(1, Math.min(12, Math.round(n / activeDays.size)));
}

export function StrategyLab({
  trades,
  defaultAccountSize,
  dailyLossDollars,
  maxDrawdownDollars,
  hasPropFirmProfile,
}: Props) {
  const rSample = useMemo(() => extractRSample(trades), [trades]);
  const detectedTpd = useMemo(() => autoTradesPerDay(trades), [trades]);
  // Bootstrap 95% CI on mean R (block bootstrap, same block-size as engine).
  // Drives the edge-direction gate: when the CI lower bound is ≤ 0 the sample
  // doesn't statistically demonstrate a positive edge, and no sizing recommendation
  // should be presented regardless of pass-prob heatmap colouring.
  const edge = useMemo(
    () => meanRWithCI(rSample, { resamples: 1500, seed: 0xC0FFEE }),
    [rSample],
  );
  const edgePositive = edge.n >= 30 && edge.ciLow > 0;

  const [numAccounts, setNumAccounts] = useState<number>(2);
  const [accountSize, setAccountSize] = useState<number>(defaultAccountSize > 0 ? defaultAccountSize : 100_000);
  const [targetPct, setTargetPct] = useState<number>(8);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [tradesPerDay, setTradesPerDay] = useState<number>(detectedTpd);
  const [trailingDD, setTrailingDD] = useState<boolean>(false);
  // Custom limits used only when no prop-firm profile is selected.
  const [customDailyPct, setCustomDailyPct] = useState<number>(5);
  const [customMaxPct, setCustomMaxPct] = useState<number>(10);

  // Selected detail cell — defaults to recommended after compute.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Firm $ limits are absolute. If the user simulates a different account size,
  // scale them by the size ratio so the firm's % rules apply at the override
  // balance (e.g. $5k daily on $100k = 5% → $2.5k on $50k override).
  const sizeRatio = defaultAccountSize > 0 ? accountSize / defaultAccountSize : 1;
  const effDailyDollars = hasPropFirmProfile && dailyLossDollars != null
    ? dailyLossDollars * sizeRatio
    : null;
  const effMaxDollars = hasPropFirmProfile && maxDrawdownDollars != null
    ? maxDrawdownDollars * sizeRatio
    : null;
  const dailyLossPct = effDailyDollars != null && accountSize > 0
    ? effDailyDollars / accountSize
    : customDailyPct / 100;
  const maxLossPct = effMaxDollars != null && accountSize > 0
    ? effMaxDollars / accountSize
    : customMaxPct / 100;

  const cells = useMemo(() => {
    if (rSample.length < 10) return [];
    const out: Array<{
      key: string; risk: number; model: RotationModel; result: MCResult;
      score: number; parts: ReturnType<typeof scoreCellParts>;
    }> = [];
    for (const model of ROTATION_MODELS) {
      for (const risk of RISK_TIERS) {
        const params: MCParams = {
          rSample,
          riskPerTradeFrac: risk / 100,
          numAccounts,
          accountSize,
          dailyLossPct,
          maxLossPct,
          targetPct: targetPct / 100,
          tradesPerDay,
          maxDays: windowDays,
          rotationModel: model,
          maxLossMode: trailingDD ? "trailing" : "static",
          paths: 1200,
          // Deterministic per cell so two cells with similar means don't show
          // artificial closeness from sharing the same sampled paths.
          seed: cellSeed(model, risk),
        };
        const result = runMonteCarlo(params);
        const parts = scoreCellParts(result);
        out.push({
          key: `${model}|${risk}`,
          risk,
          model,
          result,
          score: parts.score,
          parts,
        });
      }
    }
    return out;
  }, [rSample, numAccounts, accountSize, dailyLossPct, maxLossPct, targetPct, tradesPerDay, windowDays, trailingDD]);

  const best = cells.length > 0
    ? cells.reduce((a, b) => (b.score > a.score ? b : a), cells[0])
    : null;

  const activeKey = selectedKey ?? best?.key ?? null;
  const active = cells.find((c) => c.key === activeKey) ?? best;

  if (rSample.length < 10) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        Need ≥10 closed trades with <code className="text-xs">r_multiple_actual</code> filled in
        to run the strategy sweep. Currently have {rSample.length}.
      </Card>
    );
  }

  // Tier the simulator off the R-sample feeding the Monte Carlo. With <30 R
  // samples the bootstrap CI on pass-prob is wide; show numbers but flag them.
  const simTier = classifyDataTier({ n: rSample.length });
  const provisional = simTier === "provisional";

  // Pass-prob bounds for heatmap colouring.
  const passProbs = cells.map((c) => c.result.passProb);
  const minPass = Math.min(...passProbs);
  const maxPass = Math.max(...passProbs);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-2 flex-wrap">
        <Sparkles className="w-4 h-4 text-primary mt-0.5" />
        <div className="flex-1 min-w-[260px]">
          <h3 className="font-semibold">Strategy Lab</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {ROTATION_MODELS.length} rotation models × {RISK_TIERS.length} risk tiers ={" "}
            {ROTATION_MODELS.length * RISK_TIERS.length} configurations. Each runs 1,200 Monte-Carlo
            paths over your real R history (N {rSample.length}) and the firm rules below. Click a
            cell to inspect.
          </p>
        </div>
        {best && !provisional && (
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
            Recommended: {ROTATION_LABELS[best.model]} @ {best.risk.toFixed(2)}%
          </Badge>
        )}
        {best && provisional && (
          <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
            Provisional top: {ROTATION_LABELS[best.model]} @ {best.risk.toFixed(2)}%
          </Badge>
        )}
      </div>

      {provisional && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-medium text-amber-700 dark:text-amber-400">
              Based on N {rSample.length} R-samples — directional only.
            </span>{" "}
            <span className="text-muted-foreground">
              Pass-prob CIs are wide below {DATA_TIER_VALIDATED_N} samples. Use the heatmap to compare
              rotations relative to each other; don't read the absolute % as a forecast.
            </span>
          </div>
        </div>
      )}


      {/* Inputs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 rounded-md border border-border/60 bg-muted/10">
        <div>
          <Label className="text-xs">Accounts</Label>
          <NumericInput value={numAccounts} min={1} max={10} onCommit={setNumAccounts} />
        </div>
        <div>
          <Label className="text-xs">Account size $</Label>
          <NumericInput value={accountSize} min={1000} step={1000} onCommit={setAccountSize} />
        </div>
        <div>
          <Label className="text-xs">
            Phase target {targetPct}%
          </Label>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {TARGET_PRESETS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={targetPct === p ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setTargetPct(p)}
              >
                {p}%
              </Button>
            ))}
            <NumericInput value={targetPct} min={1} max={30} step={0.5} onCommit={setTargetPct} className="h-7 w-16 text-xs" />
          </div>
        </div>
        <div>
          <Label className="text-xs">
            Evaluation window {windowDays}d
          </Label>
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {WINDOW_PRESETS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={windowDays === p ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setWindowDays(p)}
              >
                {p}d
              </Button>
            ))}
            <NumericInput value={windowDays} min={5} max={365} onCommit={setWindowDays} className="h-7 w-16 text-xs" />
          </div>
        </div>

        <div className="col-span-2">
          <Label className="text-xs">
            Trades/day <span className="font-mono-numbers font-semibold ml-1">{tradesPerDay}</span>
            <span className="text-muted-foreground ml-2">(detected: {detectedTpd}/day from your history)</span>
          </Label>
          <Slider min={1} max={8} step={1} value={[tradesPerDay]} onValueChange={(v) => setTradesPerDay(v[0])} className="mt-3" />
        </div>

        {hasPropFirmProfile ? (
          <div className="col-span-2 text-xs text-muted-foreground self-end pb-1 leading-relaxed">
            Loss caps from the active prop-firm profile, scaled to override balance:{" "}
            <span className="text-foreground font-mono-numbers">
              ${effDailyDollars?.toFixed(0) ?? "—"}/day · ${effMaxDollars?.toFixed(0) ?? "—"} total
            </span>
            {Math.abs(sizeRatio - 1) > 0.01 && (
              <span className="ml-1 italic">(firm % rules applied to ${accountSize.toLocaleString()})</span>
            )}
            .
          </div>
        ) : (
          <>
            <div>
              <Label className="text-xs">Daily loss %</Label>
              <NumericInput value={customDailyPct} min={0} max={20} step={0.5} onCommit={setCustomDailyPct} />
            </div>
            <div>
              <Label className="text-xs">Max loss %</Label>
              <NumericInput value={customMaxPct} min={0} max={30} step={0.5} onCommit={setCustomMaxPct} />
            </div>
          </>
        )}

        <div className="col-span-2 md:col-span-4 flex items-center gap-2 pt-1">
          <input
            id="trailing-dd"
            type="checkbox"
            checked={trailingDD}
            onChange={(e) => setTrailingDD(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <Label htmlFor="trailing-dd" className="text-xs cursor-pointer">
            Trailing drawdown (FTMO / MyFF style — max-loss line follows peak equity)
          </Label>
        </div>
      </div>

      {/* Heatmap */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left py-2 pr-2">Rotation \ Risk</th>
              {RISK_TIERS.map((r) => (
                <th key={r} className="text-center py-2 px-2 font-mono-numbers">{r.toFixed(2)}%</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROTATION_MODELS.map((model) => (
              <tr key={model}>
                <td className="py-1.5 pr-2 font-medium text-sm whitespace-nowrap">
                  {ROTATION_LABELS[model]}
                </td>
                {RISK_TIERS.map((risk) => {
                  const cell = cells.find((c) => c.model === model && c.risk === risk);
                  if (!cell) return <td key={risk} />;
                  const isBest = best && cell.key === best.key;
                  const isActive = cell.key === activeKey;
                  const ratio = maxPass === minPass ? 0.5 : (cell.result.passProb - minPass) / (maxPass - minPass);
                  // Emerald-ish gradient by pass prob.
                  const bgAlpha = 0.05 + ratio * 0.35;
                  const ciHalfPp = ((cell.result.passProbCI[1] - cell.result.passProbCI[0]) / 2) * 100;
                  const noisy = ciHalfPp > 3;
                  return (
                    <td key={risk} className="p-0.5">
                      <button
                        type="button"
                        onClick={() => setSelectedKey(cell.key)}
                        className={cn(
                          "w-full rounded px-2 py-2 text-center transition-all",
                          "border",
                          isActive ? "border-primary ring-1 ring-primary" : "border-border/30 hover:border-border",
                          isBest && !isActive && !provisional && "border-emerald-500/50",
                          isBest && !isActive && provisional && "border-amber-500/50",

                        )}
                        style={{
                          backgroundColor: `hsl(150 70% 45% / ${bgAlpha})`,
                        }}
                        title={`95% CI: ${(cell.result.passProbCI[0] * 100).toFixed(0)}–${(cell.result.passProbCI[1] * 100).toFixed(0)}%`}
                      >
                        <div className="font-mono-numbers font-semibold text-sm">
                          {(cell.result.passProb * 100).toFixed(0)}%
                        </div>
                        <div className={cn(
                          "font-mono-numbers text-[10px]",
                          noisy ? "text-amber-500" : "text-muted-foreground",
                        )}>
                          {noisy ? `±${ciHalfPp.toFixed(0)}pp` : `DD ${cell.result.avgDrawdownPct.toFixed(1)}%`}
                        </div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail row */}
      {active && (
        <div className="rounded-md border border-border/60 bg-muted/10 p-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Detail:</span>{" "}
              <span className="font-medium">{ROTATION_LABELS[active.model]}</span>
              <span className="text-muted-foreground"> @ </span>
              <span className="font-mono-numbers font-semibold">{active.risk.toFixed(2)}%</span>
              {best && active.key === best.key && !provisional && (
                <Badge className="ml-2 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                  Recommended
                </Badge>
              )}
              {best && active.key === best.key && provisional && (
                <Badge className="ml-2 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs">
                  Provisional top
                </Badge>
              )}

            </div>
            <div className="text-xs text-muted-foreground">
              Score: <span className="font-mono-numbers text-foreground">{active.score.toFixed(3)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
            <Stat
              label="Pass prob"
              value={`${(active.result.passProb * 100).toFixed(0)}%`}
              sub={`95% CI ${(active.result.passProbCI[0] * 100).toFixed(0)}–${(active.result.passProbCI[1] * 100).toFixed(0)}%`}
              tone="good"
            />
            <Stat label="Fail prob" value={`${(active.result.failProb * 100).toFixed(0)}%`} tone="bad" />
            <Stat label="Inconclusive" value={`${(active.result.inconclusiveProb * 100).toFixed(0)}%`} />
            <Stat label="Avg days to pass" value={active.result.avgDaysToPass != null ? active.result.avgDaysToPass.toFixed(1) : "—"} />
            <Stat
              label="Avg drawdown"
              value={`${active.result.avgDrawdownPct.toFixed(1)}%`}
              sub={trailingDD ? "trailing" : "static"}
            />
            <Stat
              label="Risk of ruin"
              value={`${(active.result.riskOfRuin * 100).toFixed(0)}%`}
              sub={`per-acct ${(active.result.perAccountBustRate * 100).toFixed(0)}%`}
              tone="bad"
            />
            <Stat
              label="Expected return"
              value={`${active.result.expectedReturnPct >= 0 ? "+" : ""}${active.result.expectedReturnPct.toFixed(1)}%`}
              tone={active.result.expectedReturnPct >= 0 ? "good" : "bad"}
            />
            <Stat
              label="CVaR-5%"
              value={`${active.result.cvar5Pct >= 0 ? "+" : ""}${active.result.cvar5Pct.toFixed(1)}%`}
              sub="worst 5% tail"
              tone="bad"
            />
            <Stat
              label="Geom. growth / trade"
              value={`${active.result.geometricMeanGrowthPct >= 0 ? "+" : ""}${active.result.geometricMeanGrowthPct.toFixed(3)}%`}
              sub="compounding edge"
              tone={active.result.geometricMeanGrowthPct >= 0 ? "good" : "bad"}
            />
          </div>
          {/* Score breakdown */}
          <div className="text-[11px] text-muted-foreground font-mono-numbers mt-3 pt-3 border-t border-border/40 leading-relaxed">
            score = pass {active.parts.passProb.toFixed(2)}
            {" × "}survival {active.parts.survival.toFixed(2)}
            {" − "}DD penalty {active.parts.ddPenalty.toFixed(3)}
            {" − "}incon penalty {active.parts.inconclusivePenalty.toFixed(3)}
            {" = "}<span className="text-foreground font-semibold">{active.parts.score.toFixed(3)}</span>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Stationary block bootstrap (block size ≈ N<sup>1/3</sup>, Politis–Romano optimal) of your R-history preserves loss-streak clustering.
          Each cell uses an independent seed so similar-looking cells aren't artificially correlated.
          Recommendation maximises <code>passProb × (1 − RoR) − 0.02·max(0, DD% − 5) − 0.1·P(inconclusive)</code>,
          so a slightly lower pass prob with much lower drawdown — or fewer time-outs — can win.
          Risk-of-ruin is per-path (any account busts); "per-acct" sub-stat shows the legacy account-level rate.
          CVaR-5% is the mean of the worst 5% of final-equity outcomes; geometric growth/trade is the compounding edge at the chosen risk %.
        </span>
      </p>
    </Card>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-mono-numbers font-semibold mt-0.5",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-muted-foreground font-mono-numbers mt-0.5">{sub}</div>
      )}
    </div>
  );
}
