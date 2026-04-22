

# Should you journal the *intended* model or the *actual* one?

## Short answer: both. They're different signals.

Right now your journal has **one** model field (`Model`, mapped to `playbook_id`). That collapses two very different facts into one cell:

- **Intended**: what playbook you *thought* you were trading at entry (your thesis at the moment of pulling the trigger).
- **Actual**: what the price action and trade behavior turned out to actually be, judged in hindsight.

Mixing them destroys your ability to answer the most important questions a journal exists to answer:

| Question | Needs intended | Needs actual | Needs both |
|---|---|---|---|
| "How well does my Liquidity Sweep playbook perform?" | ✓ | | |
| "How often was my read of the market correct?" | | | ✓ |
| "What setup do I keep mistaking for X?" | | | ✓ |
| "Am I drifting from my plan mid-trade?" | ✓ | ✓ | ✓ |
| "Which playbook is genuinely my edge vs. which I just label everything as?" | | ✓ | ✓ |

The pros (Mike Bellafiore's SMB, Brett Steenbarger, every prop desk review template) all separate **plan vs execution vs outcome** for exactly this reason. You want to grade your *thesis quality* independently from your *execution quality* independently from your *result*.

## What this app currently captures

Looking at `src/types/settings.ts` and `TradeProperties.tsx`:

- **Model** (`playbook_id`) — single field, no time-of-decision distinction
- **Profile** (consolidation/expansion/reversal/continuation) — single field, same problem
- **Regime** (rotational/transitional) — same
- **Alignment / Entry TF** — same

There's also a free-text `Place` field and `psychology_notes`, but nothing structured for "I called this X but it was actually Y."

## Recommendation: add a 2nd "actual" column for the things that matter

Don't add it for everything — that creates fatigue. Add it for the **3 fields where the intended-vs-actual gap is most diagnostic**:

| Field | Intended (what you thought at entry) | Actual (judged after close) |
|---|---|---|
| `playbook_id` → keep as **"Planned Model"** | Already captured | NEW: `actual_playbook_id` |
| `profile` → keep as **"Planned Profile"** | Already captured | NEW: `actual_profile` |
| Regime | Already captured | NEW: `actual_regime` |

Don't duplicate Alignment/Entry TF — those are objective and don't shift in hindsight much.

Also add a derived/computed badge: **"Read Quality"** = `match | partial | mismatch` based on whether intended === actual. This is the single most powerful new metric you'd unlock — your *market-reading accuracy*, separate from your P&L.

## How journaling should flow

```
At entry (live trade dialog or quick capture)
  └─ Pick PLANNED model + profile + regime  ← what you think
        ↓
Trade closes
  └─ Open trade detail panel
        ↓
  Review section now has:
    • Planned Model: Liquidity Sweep      [locked, set at entry]
    • Actual Model: ___                   [you fill in hindsight]
    • Read Quality auto-computes: ✓ match / ⚠ partial / ✗ mismatch
```

If you didn't pre-set "planned" (e.g. CSV imports, missed entries), the Planned field stays empty and Actual becomes the only one. No data loss, no forced workflow.

## What columns to add to the table

Add these as **optional** (default-hidden) columns so you can opt in once you've used it for a few weeks:

- `Planned Model` (rename existing `Model`)
- `Actual Model` (new)
- `Read Quality` (new, computed badge: green/yellow/red)

Hide `Profile` → `actual_profile` and `Regime` → `actual_regime` by default; expose in detail panel only. Adds depth without table clutter.

## What this unlocks in reports

Your weekly Sensei report can now answer:
- "You called Liquidity Sweep 12 times this week. 4 were actually Trend Continuation. Win rate when correctly identified: 67%. When mis-identified: 18%. **Your read is your edge — the setups you label correctly print money.**"
- "Your *planned* playbook compliance is 80%. Your *actual* playbook compliance is 45%. You're entering on plan but the market isn't giving you what you expected — consider waiting for confirmation."

Neither of those insights is possible with one combined field.

## Implementation scope (when you approve)

**Database** — add 3 nullable columns to `trades`:
- `actual_playbook_id uuid REFERENCES playbooks(id)`
- `actual_profile text`
- `actual_regime text`

**Frontend**:
- `TradeProperties.tsx`: rename "Model"→"Planned Model", add "Actual Model" row below it; same for Profile and Regime.
- `settings.ts` `DEFAULT_COLUMNS`: rename `model`→`planned_model`, add `actual_model` and `read_quality` (computed). Keep both default-hidden except `planned_model`.
- `TradeTable.tsx`: render new columns + read-quality badge.
- Reports edge function (`generate-report`): include planned-vs-actual deltas in prompt context.

**No EA changes, no breaking changes** — old trades just have `actual_*` = null, treated as "not graded yet."

## Validation

1. Open any past trade → Properties panel shows "Planned Model" (existing value preserved) and a new empty "Actual Model" picker.
2. Set Actual = Planned → Read Quality badge = green "match".
3. Set Actual ≠ Planned → badge = red "mismatch", visible in table once column enabled.
4. Old trades with no Actual set → badge hidden, no false "mismatch" noise.
5. Generated weekly Sensei report references read-quality stats when ≥10 graded trades exist.

