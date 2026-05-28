## Root cause

The "-129%" badge comes from `src/components/dashboard/EquityCurve.tsx:186-188`:

```ts
const delta = periodPnl - previousPeriodPnl;          // e.g. -2,600 - 9,081 = -11,681
const deltaPercent = previousPeriodPnl !== 0
  ? ((delta / Math.abs(previousPeriodPnl)) * 100).toFixed(0)  // -11,681 / 9,081 ≈ -129%
  : ...
```

The math is technically correct but **semantically wrong**: net P&L is a flow, not a stock, so a "% change of P&L vs last week" is meaningless. When the sign flips (profit → loss) or the previous value is near zero, the number explodes past ±100% and confuses users into thinking something is broken.

## Where else this pattern hides

Audit of every `*100` percent calc in the codebase (`rg "/ ... * 100"`):

- **Only offender**: `EquityCurve.tsx:188` — % change between two P&L totals.
- **Safe (bounded ratios)**: win rate, success rate, checklist compliance, progress bars, % return on starting balance (`periodPnl / startingBalance`).
- **Reports `DeltaCell`** (`ReportView.tsx:71-81`) shows server-computed **absolute** deltas (`a - b`, not %), so no false percentages — but it prints them without units (e.g. a Net P&L delta of `1500` shows as `+1500.00` with no `$`). Minor polish opportunity.

No similar broken `%` exists anywhere else.

## Fix plan

### 1. Replace the P&L delta badge in `EquityCurve.tsx`

Switch from "% change of P&L" to a representation that always reads correctly:

- **Primary**: show the **$ delta** vs last period (`+$X` / `-$X`), which is unambiguous.
- **Secondary** (only when meaningful): show the % expressed as a **share of starting balance**, i.e. `(periodPnl - previousPeriodPnl) / startingBalance * 100`. This stays in a sane range (typically ±10%) and is the metric traders actually care about ("we gave back 1.3% of the account vs last week"). Suppress this secondary if `startingBalance <= 0`.
- **Sign-flip case** (profit → loss or loss → profit): drop the % entirely and show a small label like `Flipped` so we never display `-129%`-style noise.
- Keep the existing `TrendingUp/Down/Minus` icon and color logic; just feed it the new value.

### 2. Polish `DeltaCell` in `ReportView.tsx`

Pass the metric's unit (`$`, `R`, `%`, or none) alongside the delta so the rendered chip reads `+$1,500` / `+1.2R` / `+3.5%` instead of a bare number. No formula change, just formatting.

### Technical notes

- All changes are confined to two presentation files: `src/components/dashboard/EquityCurve.tsx` and `src/components/reports/ReportView.tsx`.
- No edge function, schema, or hook changes required — the underlying numbers (`periodPnl`, `previousPeriodPnl`, `startingBalance`, server-side `deltas`) are already correct.
- No DB migration.

### Out of scope

- Server-side deltas in `generate-report` (already absolute, already correct).
- Bounded-ratio percentages (win rate, compliance, etc.) — these are correct.
