# Backtest Lab: audit result and a plan to test *your* systems

## What I verified (all green)

- 153 tests pass, TypeScript clean.
- Prompt 4/5/6 work is fully wired: `grid.json` presets feed both UI and worker; sweep canonicalisation, DSR/FDR, nulls (random entry, other hours, shuffled direction), ablation ladder, discretion premium, per-year/era splits, cost sensitivity, summary-pack ZIP, and the 13-panel 1080p dashboard all render inside Step 4 (Validate), with the Holdout panel below it.
- Engine safety rails are real: pessimistic ambiguous-bar fills, no-trade funnel log, `MAX_TRADES_PER_WINDOW_CAP`, holdout/discovery era assertions, spread + slippage + risk sizing.

So the machine is sound. The problem is what it can express.

## The real gap: the backtester cannot state your playbooks

Your five playbooks (TKY Continuation, LON Range, LON Continuation, NY Continuation, NY Range) are built from primitives the engine does not have:

| Your rule | Engine today |
|---|---|
| Tokyo session; London 02:00–03:00 and 03:00–05:00 ET; NY 07:00–08:00 ET | Only three fixed killzones (03–04, 10–11, 14–15 ET) + RTH. No Tokyo, no custom hours |
| 1-min order-flow leg (1-2-3 setup with FVG) | Only a raw FVG + optional MSS. No leg structure |
| 5-min V-shape reversal | Not modelled |
| Entry at 25% / 75% of an HTF consolidation range, target = range mean | No range model, no "range mean" target |
| SMT divergence vs DXY / correlated pair | Single-series engine — no second symbol at all |
| Volume-profile context (balanced middle = no trade, HVN/LVN reactions) | Not modelled |
| BE after 1.5R, close on hourly close if counter-trend, min 4-pip stop | Exits are stop / target / window-end only |
| Regime gate: rotational vs transitional | Bias modes only, no regime classifier |

Result: every "named config" currently in the lab is generic ICT, not your edge. That is the thing worth fixing.

## Plan

### Phase 1 — Windows and sessions (unblocks everything)
- Add `tokyo` (20:00–00:00 ET) and the exact playbook windows (`london_early` 02:00–03:00, `london_range` 03:00–05:00, `ny_open` 07:00–08:00) to `shared/quant/sessions.ts`, and extend `journalSessionKey` so backtest trades bucket into the same session vocabulary as the journal.
- Replace the fixed 4-item window list in the Strategy step with a picker over all defined windows plus a "custom window" row (start/end in ET), so a system can be tested at its real hours.

### Phase 2 — Detectors for your primitives
Add to `shared/quant/ict/detectors.ts`, each causal and covered by a truncation test:
- `detectOrderFlowLegs()` — 1-2-3 structure: impulse leg, pullback that leaves an FVG, then the break of the leg-2 extreme. Emits leg origin (your stop reference) and confirmation index.
- `detectVShape()` — 5-min sharp reversal: N-bar down-thrust immediately reversed by an up-thrust of >= X ATR, confirmed on close.
- `detectRanges()` — HTF consolidation detection with 25% / 50% / 75% quartile levels; feeds both entry zones and a new `targetMode: "range_mean"`.
- `volumeProfile()` — session/day POC, value-area high/low from the M1 tick-volume; exposes a "price is mid-balance" flag for the invalidation rule.

### Phase 3 — Engine: management rules and stop realism
Extend `EngineConfig` (defaults off, so existing runs are unchanged):
- `breakevenAtR` (your 1.5R rule), `minStopDistanceTicks` (your 4-pip floor), `exitOnHourClose` for counter-trend trades, `stopMode: "leg_origin"`.
- `entryZone: "fvg" | "range_quartile"` and `targetMode: "range_mean"`.
- `regimeFilter: "rotational" | "transitional" | "any"` driven by a simple, explicit classifier (range-bound vs directional over the prior N sessions) so a range playbook only trades ranges and a continuation playbook only trades trends.

### Phase 4 — SMT (needs a second data series)
- Generalise the worker/loader to hold a **reference series** (DXY, or the correlated pair) aligned by timestamp.
- `detectSmt()` — one symbol makes a higher high / lower low while the reference fails to confirm, within the lookback.
- Gate: `requireSmt: boolean`. If the reference symbol has no bars imported, the UI says so instead of silently ignoring the rule.

### Phase 5 — Your playbooks as first-class configs
- Add five entries to `shared/quant/ict/configs/grid.json` (`tky_continuation`, `lon_range`, `lon_continuation`, `ny_continuation`, `ny_range`), each an exact transcription of the playbook, so they appear as presets in the Strategy step and as named configs in the sweep, ablation ladder and holdout.
- Add a "Playbook vs backtest" comparison: run a named config over the same period as your journal trades in that playbook and show side-by-side trade count, win rate and avg R — the direct answer to "is my discretion adding or subtracting from the mechanical version of my own system?".

### Phase 6 — Tests
Extend `ictTaughtConfigs.test.ts` with a case per new playbook config (runs end to end, respects its window, never overlaps) and add truncation tests for every new detector.

## Technical notes

- Nothing in Phases 1–3 changes existing results: all new config fields default to their current behaviour, and preset hashes stay stable because canonicalisation only serialises set fields.
- SMT is the only phase that changes the worker protocol (`init` gains an optional reference chunk set); it is last for that reason and can be dropped without affecting the rest.
- Volume profile uses the tick volume already present in the bar codec — no new data required.

## Suggested order

Phases 1, 2, 3 and 5 give you a lab that can run your actual systems. Phase 4 (SMT) is worth doing only once you import DXY or the correlated pair's M1 history.
