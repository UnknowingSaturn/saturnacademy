## What's in place (Phase 1 + Phase 2 review)

Verified the simulator stack:

- `src/lib/pairLabSimulator.ts` — deterministic replay engine (R-multiples → $, DD, prop-firm verdict).
- `src/lib/pairLabPresets.ts` — 6 presets including "Your current behavior" baseline.
- `src/components/pair-lab/StrategyPresetPicker.tsx`, `EquityCurveOverlay.tsx`, `StrategyCompare.tsx` — head-to-head compare.
- `src/components/pair-lab/StrategyRanker.tsx` — runs all presets at one risk %, demotes busters, picks a winner with $ uplift vs current behavior.
- `src/pages/PairLab.tsx` — Simulator tab renders Ranker + Compare; scope follows the bucket selected in Grid, otherwise "All trades in scope".

**Gap you spotted:** the Simulator hard-blocks with "Pick a single account…" because `accountBalance` only comes from `useAccount(selectedAccountId)`, which is `undefined` whenever the global Account filter is "all". With 278 closed trades aggregated across accounts, the simulator should still run — we just need a balance to convert R into $.

## Plan — let the Simulator work across all accounts

### 1. Aggregate balance when filter = "all"
In `src/hooks/usePairLab.tsx`:
- Call `useAccounts()` unconditionally.
- New derived field `aggregateBalance` = sum of `balance_start` across all the user's accounts.
- `accountBalance` returned by the hook becomes: single account's `balance_start` when one is picked, else the aggregate sum.
- Expose `isAllAccounts: boolean` so the UI can label the mode.
- Prop-firm context stays `null` in all-accounts mode (mixing firms' DD caps would be meaningless) — the verdict column simply renders as "—".

### 2. Manual balance override in the Simulator
In `StrategyRanker.tsx` and `StrategyCompare.tsx`:
- Add a small "Sim balance $" numeric input (defaults to the hook's `accountBalance`, persists in component state only).
- Lets the user model "what if this were a $50k account" without changing their global filter.
- Both components already accept `balance` as a prop; just lift it into local state initialised from the prop.

### 3. Drop the hard block in `PairLab.tsx`
Replace the "Pick a single account" empty-state with the Simulator panels as long as `accountBalance > 0` (now true in both modes). If `accountBalance === 0` (no accounts at all), keep a softer message: "Add an account in Settings, or enter a sim balance below" plus a balance input.

### 4. Banner copy
Update the scope banner in the Simulator tab to read e.g. *"Simulating All trades in scope across all accounts · sim balance $X (aggregate, edit below). Prop-firm verdict disabled in all-accounts mode."* when in all-accounts mode.

## Out of scope
- Per-account replay (running the ranker once per account and aggregating). Possible later, but the single-pooled-balance approach matches how the user is already viewing the data.
- Persisting the sim-balance override to the DB. Local state is enough; the user just wants quick what-ifs.

## Files touched
- `src/hooks/usePairLab.tsx` — aggregate balance + flag.
- `src/pages/PairLab.tsx` — drop hard block, update banner.
- `src/components/pair-lab/StrategyRanker.tsx` — local balance override.
- `src/components/pair-lab/StrategyCompare.tsx` — local balance override.

No DB or edge-function changes.
