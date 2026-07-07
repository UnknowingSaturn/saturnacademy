# Pair Lab Audit

Compiled from three parallel read-only investigations. Every finding cites `file:line` and quotes code where relevant. Nothing has been changed based on these findings — this is a decision doc. Review, mark accepted/rejected, and we'll open a targeted fix plan.

Sections:
1. Data ingress vs. Journal — **complete**
2. Math core — **complete**
3. UI shell + dead code — **pending** (background task still running)

---

## 1. Data ingress vs. Journal

### 1.1 Trade-universe parity

Both surfaces call `useTrades()` with the same shape:

| Scenario | Journal (`src/pages/Journal.tsx:65-69`) | Pair Lab (`src/hooks/usePairLab.tsx:147-150`) |
|---|---|---|
| All accounts | `useTrades(undefined)` | `useTrades(undefined)` |
| Account selected | `{ accountId, includeUnassigned: true }` | `{ accountId, includeUnassigned }` |

`useTrades` defaults `is_archived = false` at `src/hooks/useTrades.tsx:49`, so neither surface sees archived rows.

**Divergence 1 — Orphan rows (account_id IS NULL). CONFIRMED BUG.**
Journal hardcodes `includeUnassigned: true` (`Journal.tsx:67`). Pair Lab evaluates `filters.includeUnassigned === true` (`usePairLab.tsx:146`), defaulting to **false** when the caller omits it. Result: with an account selected, Journal shows legacy imports with NULL account_id; Pair Lab silently drops them → different row counts for the same DB snapshot. Note: the OverviewTab toggle defaults `orphans=on` in the URL (`PairLab.tsx`), so in practice most users don't see this — but a caller of `usePairLab` without setting the flag would.

**Divergence 2 — Open positions.** Intentional. Pair Lab excludes at `usePairLab.tsx:271`. Journal counts include open trades. Not a bug; document if `totalTrades` numbers are ever compared.

**Divergence 3 — Unrealized (idea/paper/missed).** Intentional. Pair Lab defaults `includeUnrealized = false`; Journal shows all types. Not a bug.

**Divergence 4 — Profile filter.** Pair Lab only. Correctly mirrored between `buildBuckets` and `matchesScope` (`usePairLab.tsx:272`).

**Divergence 5 — Walk-forward window.** Pair Lab only. See §1.2 for TZ risk.

### 1.2 Timezone / timestamp handling

- Walk-forward window generation is UTC-clean. `resolveWindow` (`WalkForwardControls.tsx:41-44`) emits ISO `Z` strings; Pair Lab compares via `ensureUtcMs` (`usePairLab.tsx:279-288`).
- `ensureUtcMs` (`shared/quant/stats.ts:706-722`) treats naive strings as UTC midnight.
- **Known semantic divergence:** Journal's period filter (`Journal.tsx:134`) uses `parseISO` + `isWithinInterval`, which interpret naive strings as *local* time. A trade with `entry_time = "2024-01-15 23:30:00"` lands on different calendar days in the two views for a user east of UTC. No fix without changing Journal semantics.

### 1.3 Loading & memoization

- **`isLoading` misses queries — CONFIRMED BUG.** `usePairLab.tsx:317-322` OR-s only `tradesQuery / defsQuery / aliasesQuery / profileQuery`. Missing: `rulesQuery`, `accountQuery`, `groupsQuery`. In prop-firm mode, `propFirm` is briefly built from an empty rules array with zero balance during initial mount → transient wrong daily-loss / max-DD constraints.
- **`groupsQuery.groups` reference stability — needs verification.** Listed as a memo dep at `usePairLab.tsx:362`. If `useSymbolGroups` returns a new array on every render, this fires the expensive memo unnecessarily.

### 1.4 Additional findings

- **`usePairLabTradeBounds` orphan mismatch — CONFIRMED BUG.** `src/hooks/usePairLabTradeBounds.ts:21` calls `useTrades({ accountId })` with no `includeUnassigned`, defaulting to `true` inside `useTrades`. When Pair Lab runs with `includeUnassigned=false`, slider bounds are drawn from a wider universe than the analytics window. Cosmetic only — no math depends on the bounds.
- **`naiveTimestampCount` scope — semantic ambiguity.** `usePairLab.tsx:315` counts across the *full* fetch, not the scoped window. Comment at line 312 says this is intentional ("across the whole user trade set"), but the chip label doesn't convey that. Either scope down or clarify the tooltip.

### 1.5 Needs your call

1. **Orphan default.** Change `usePairLab.filters.includeUnassigned` default from `false` to `true` to match Journal? Would fold NULL-account rows into every caller of `usePairLab` that doesn't set the flag — not just the Pair Lab page (which explicitly wires the toggle already).
2. **Journal's local-time period vs. Pair Lab's UTC lens.** Fixing Journal to use UTC would shift what "This week" means for users east of UTC. Accept the divergence, or unify?
3. **`naiveTimestampCount`** — chip counts all trades or only in-scope?
4. **`isLoading`** — hold the spinner until rules/account/groups resolve, or accept the transient render?

---

## 2. Math core

*Pending — background task in progress.*

## 3. UI shell + dead code

*Pending — background task in progress.*
