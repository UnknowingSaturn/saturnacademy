# Verify the backtests against your GBP/EUR data

## What the uploaded data actually looks like

A read of the bar manifest shows the imports landed under three different symbol names:

```text
EURUSD                  32 months  2024-01 .. 2026-08   (canonical, good)
GBPUSD+_M1_202401020    32 months  2024-01 .. 2026-08   (raw MT5 filename)
EURUSD+_M1_202605140     4 months  2026-05 .. 2026-08   (raw filename, duplicates EURUSD)
```

So there is no canonical `GBPUSD` series at all, and four EURUSD months exist twice. This matters beyond cosmetics: the engine looks up costs by symbol, and an unknown name falls through to the generic FX default (tick 0.00001, 8-tick spread, $3.50/side). A GBPUSD backtest run today is priced by a fallback, not by its real spec — every R, expectancy and Sharpe number from those runs is suspect. The import panel never normalises the typed symbol before ingest, which is how the filename got through.

## Plan

### 1. Fix the data naming (root cause + cleanup)
- Normalise the symbol in the import path so a pasted filename (`GBPUSD+_M1_202401020`) is reduced to `GBPUSD` before upload, and show the resolved canonical name in the panel before the user confirms.
- Migrate existing rows: repoint the 32 `GBPUSD+_M1_...` manifest rows to `GBPUSD` (stored object paths stay valid), and delete the 4 duplicate `EURUSD+_M1_...` months and their storage objects.
- Add `GBPUSD` to the instrument spec catalogue alongside EURUSD so costs are explicit rather than defaulted.

### 2. Data-integrity harness on the real bars
A script that loads every stored month for EURUSD and GBPUSD and asserts:
- strictly increasing timestamps, no duplicate minutes, no cross-month overlap after concatenation;
- OHLC sanity (low <= open/close <= high, no zero/negative prices, no absurd single-minute gaps);
- weekend/roll gaps land where the FX 17:00 ET calendar says they should, including both DST transitions in the range;
- decoded values round-trip the binary codec exactly.

### 3. Definition audit against your playbook
For each detector — FVG, sweep, MSS, displacement, order-flow leg (1-2-3), V-shape, range/quartile context, session profile, SMT — re-read the implementation next to your journal descriptions and confirm: the exact three-bar gap predicate, whether a sweep needs a close back inside, MSS on close vs wick, displacement measured in ATR or points, and the leg-origin swing used for stops. Anything ambiguous gets pinned with a hand-built fixture test so the definition is executable, not just documented.

### 4. Execution correctness on real data
Run the named configs (Silver Bullet, the five `pb_*` playbook presets) over GBPUSD and EURUSD and verify:
- **causality** — truncating the series after each trade's exit reproduces that trade bit-for-bit;
- **fill legality** — every limit fill price was actually traded through on its bar; stops/targets never fill outside the bar range; ambiguous bars resolve to the stop and are flagged;
- **session mapping** — entry timestamps fall inside the configured killzone in ET, on both sides of DST;
- **cost accounting** — gross minus commission minus spread equals net, and points→cash uses the right tick value for each pair;
- **R arithmetic** — `rMultiple` equals (exit − entry)/risk with sign by direction, and the summary's expectancy/win rate reconcile to the trade list.

### 5. Statistical sanity
- Walk-forward on GBPUSD: confirm folds are time-disjoint, selection uses train only, and the OOS curve is built solely from test slices.
- Null benchmarks (random entry, other hours) on the same bars, to check the real edge is separated from the null distribution rather than sitting inside it.
- Cross-pair check: a config tuned on EURUSD evaluated untouched on GBPUSD.

### 6. Report
A written findings document listing every discrepancy found, with severity and the fix applied, plus the corrected headline numbers per pair once the naming fix is in.

## Technical notes
- New tests live beside the existing suite in `src/lib/__tests__/`; the real-bar harness runs as a script against stored chunks rather than in unit tests, so CI stays offline-safe.
- The symbol migration is a manifest `UPDATE` plus a storage delete for the duplicates; no re-upload or re-download of your data is needed.
- Fixes stay in `shared/quant/` (engine, detectors, instruments) and the import panel; no schema changes beyond the manifest row rename.
