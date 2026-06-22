# Expandable strategy rows with SL/TP details

Users can't read what each preset actually does. The ranker shows totals but hides the rules (slRule, exit ladder, runner) and never surfaces "if I run this preset, what stop and TPs am I using". Fix by making each row expandable into a parameters panel, and by computing the **applied SL (in pips) and TP ladder (in R)** during replay so we can show them.

## What the user sees

Per row in `StrategyRanker`: a chevron toggles a slide-out detail panel with three blocks.

```text
▸ Tighten SL → ideal · runner 33%@1R + 33%@2R + trail        5/55   …
  ────────────────────────────────────────────────────────────────────
  ▼ click to expand
  ────────────────────────────────────────────────────────────────────
   STOP LOSS                    TAKE PROFITS                RUNNER
   Rule  tighten to ideal       1R   33%  fixed             Trail to MFE
   Median applied  6 pips       2R   33%  fixed             (capture 38%)
   Range  4 – 9 pips            trail third — see runner    BE after TPs:
   (≈ 60 ticks · 1 pip = 10t)                                no
```

Includes a one-line legend at the top of the ranker:

> MAE & Ideal-SL are stored in **ticks** (TradingView long/short tool). MFE & TP targets are **R-multiples** (1R = the initial stop distance).

## Technical changes

### 1. Engine: surface applied SL / TP per replay

`src/lib/pairLabSimulator.ts`
- Extend `ReplayResult` with:
  ```ts
  appliedSlPipsMedian: number | null;
  appliedSlPipsRange: [number, number] | null;
  appliedTpLadder: Array<{ atR: number; fraction: number; source: "fixed" | "bucket_mfe_p50" | "bucket_mfe_p60" | "bucket_mfe_p75" }>;
  runnerLabel: string;            // plain English
  slRuleLabel: string;            // plain English
  ```
- In `replayOneTrade` (or its caller), for each eligible trade capture the SL distance actually used (original × scale for `tighten_to_ideal` / `widen_to_mae_p75_x_1_15`). Aggregate p25/p50/p75 across the eligible set after the loop.
- Resolve adaptive partial targets once at the bucket level (`resolvePartialAtR`) and emit them into `appliedTpLadder` so the UI shows e.g. "2.8R · adaptive (MFE p60)".
- Add a small `slRuleLabel` / `runnerLabel` map so the UI doesn't carry rule strings.

### 2. UI: expandable rows

`src/components/pair-lab/StrategyRanker.tsx`
- Track `openId: string | null` in local state.
- Wrap each `<tr>` in a Fragment; render a second `<tr>` with `colSpan={9}` that contains the detail panel when `openId === r.strategy.id`.
- Strategy name becomes a `<button>` with chevron icon; tapping toggles. Keyboard accessible.
- Detail panel layout — three columns: **Stop loss**, **Take profits**, **Runner** + a short description line above them (re-uses `r.strategy.description`).
- TP table rows: `{atR}R · {fraction*100}% · {source === "fixed" ? "fixed" : `adaptive (${source.replace("bucket_mfe_", "MFE ")})`}`.
- For ineligible / insufficient-sample strategies, still show the rules block (it's static) but render SL/TP medians as "—".

### 3. Units legend

Single line under the ranker header, before the toolbar:

> MAE & Ideal-SL in **ticks** · MFE & TP targets in **R**.

## Out of scope

- No changes to the math layer (`pairLabMath.ts`).
- No changes to the AI quant note or bucket grid.
- No edge-function changes (`pair-lab-report` consumer is unaffected — fields are additive).

## Verification

- Playwright on `/pair-lab` simulator tab:
  - Expand the winner row, screenshot, confirm SL median in pips renders and TP ladder lists fractions + sources.
  - Expand an "insufficient sample" row, confirm rules render with SL/TP medians as `—`.
  - Click again to collapse.
- Console errors: none.
- Type check passes (new `ReplayResult` fields propagate through `StrategyRanker`, `EquityCurveOverlay`, walk-forward).
