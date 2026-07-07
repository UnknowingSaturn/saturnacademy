# Fix Strategy Ranker SL block — per-symbol, actionable, robust

## The problem

Inside the expanded ranker row, the Stop Loss column currently shows:

- `Median applied: 0.10R of original` — a dimensionless ratio labeled with "R" (which normally means R-multiple, not "× original"). Not actionable, and confusing.
- `Cross-symbol median: 0.6 pips/pts · IQR 0.5–0.6` — mixes FX pips with index points into one number. Meaningless at trade time.

Both are cross-symbol aggregates. You trade one symbol at a time, so you need one number *per symbol*, in that symbol's real unit.

## What replaces it

For any preset whose SL rule is data-driven (tighten-to-ideal, tighten-to-MAE, or any rule where the sim recorded a per-trade applied SL distance), the SL column shows a compact per-symbol table:

```text
STOP LOSS  · Tighten to recorded ideal-SL

Symbol     n   Ideal SL (median)   IQR              vs original
EURUSD     6   4.2 pips            3.8 – 5.1        0.55×
XAUUSD     4   38 points           31 – 44          0.42×
NAS100     3   12 points           10 – 15          0.38×
```

Rules:

- **Unit is native to each symbol.** FX = pips, indices/metals/crypto/oil = points. If the user has the ticks toggle on (`useDistanceUnit`), show ticks instead — one consistent unit per row.
- **Robust stats only.** Median + IQR (25th–75th). No mean, no std-dev. Winsorize at 5/95 before quantile if `n ≥ 8` in that symbol; skip winsorization for small n.
- **`n` is the count of trades in that symbol** that contributed to this preset's replay (i.e. had the inputs the preset needs — MFE/MAE/ideal-SL as applicable).
- **`vs original`** = median(applied_sl / original_sl) for that symbol. This is the only ratio kept, and it's labeled `×`, never `R`.
- Rows sorted by `n` desc, then symbol asc. Cap at top 8 symbols; collapse the remainder into a single `Other (k symbols)` row that aggregates n and shows a median-of-medians.
- If a preset uses each trade's recorded SL as-is (`useActualOutcome`), keep the current "Uses each trade's recorded stop." line — no table.
- If fewer than 3 trades in *any* symbol qualify, fall back to a single-line summary using the same robust math on the pooled sample, but in R-only wording: `Applied SL ≈ 0.10× your original stop (IQR 0.05–0.20×, n=13 across 4 symbols)`. No pips/points at all in the fallback — mixing units is what caused the original bug.

## Data plumbing

`pairLabSimulator.ts` already records `slPips` and `slScale` per trade during replay (they're aggregated into the current medians at line 646/655). Add a parallel per-symbol collection:

```ts
// during eligible-trade loop
appliedSlBySymbol.get(symbol) ?? [] .push({ slNative, slScale, unitClass })
```

Emit on `ReplayResult`:

```ts
appliedSlBySymbol: Array<{
  symbol: string;
  unit: "pips" | "points";
  n: number;
  medianNative: number;
  iqrNative: [number, number];
  medianScale: number;   // applied / original
}> | null;
```

Compute in native units using `pipSizeForSymbol` + `classifySymbol` (already imported). No new dependencies.

Keep the existing `appliedSlPipsMedian`/`appliedSlScaleMedian` fields for now (server twin + tests read them); they just stop being rendered.

## UI change

`src/components/pair-lab/StrategyRanker.tsx` lines 145–174: replace the two `<div>`s ("Median applied" and "Cross-symbol median") with:

- If `result.appliedSlBySymbol?.length >= 1` and at least one row has `n >= 3` → render the table above.
- Else → render the R-only fallback line.
- Convert each row's `medianNative`/`iqrNative` through `formatDistance(symbol, valueNative, unit, distanceUnit)` so the ticks toggle keeps working.

## Server parity

`supabase/functions/_shared/quant/pairLabSimulator.ts` mirrors the client sim. Add the same per-symbol aggregation there so `pair-lab-report` edge function and `serverReplayParity.test.ts` stay in sync. No new fields consumed by report generation yet — just carried through.

## Tests

Extend `src/lib/__tests__/pairLabRobust.test.ts` with:

1. Two symbols with different `pipSizeForSymbol` values → verify each row's `medianNative` is in the correct unit (pips vs points), not blended.
2. Symbol with n=2 → excluded from table but counted in the "Other" row / triggers fallback if it's the only symbol.
3. Winsorization: 10 trades with one outlier at 20× the median → median unchanged, IQR unaffected.
4. `useActualOutcome` preset → `appliedSlBySymbol` is `null`, UI hides the table.

## What this does not change

- Ranker scoring (BCa expectancy, WR/DD) — untouched.
- Take Profits and Runner columns — untouched.
- Cross-symbol R metrics elsewhere in the row (`+4.15R`, edge, CI) — untouched; those are already unit-safe.
- The 100% WR / $0 DD caveat copy added last turn — stays.

## Answer to your MFE question

MFE is already stored and consumed as R-multiples (see `extractProof` line 245: `loggedMfe` is used directly, no unit conversion). So "if MFE is in R, use that" is already true throughout the ranker. The bug was only in the SL display block.
