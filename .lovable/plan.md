## Part 1 — Playbook stats when Planned ≠ Actual

**Current behaviour:** `usePlaybookStats` (and the `playbook_id` foreign key on every chart, report, recent-trades panel) credits a trade entirely to the **Planned** model, even if you graded the actual setup as a different one. So a "London Reversal" stat card silently includes trades you ex-post tagged as "Continuation."

**Industry best practice** (this is what serious prop desks / journalling tools do):

> Edge stats should be attributed to the **Actual** model, because that's what the market actually paid you for. The **Planned** model is a *read-quality / discipline* metric, not an *edge* metric.

So a mismatch shouldn't pollute either playbook's edge — it should:
- Count toward the **Actual** playbook's win-rate / avg-R / equity curve (that's the setup that actually played out).
- Count as a **read miss** in a separate "Read Quality" stat on the **Planned** playbook (so you can see "you call London Reversal correctly 62% of the time").
- Count as **discretionary / un-modeled** if Actual is blank.

### Proposed change

**`usePlaybookStats.tsx`** — switch the attribution column from `playbook_id` to `COALESCE(actual_playbook_id, playbook_id)`. Trades stay attributed to Planned by default, but the moment you grade an Actual, the stats follow the Actual.

Add three new fields per playbook:
- `readAccuracy` — % of trades where this playbook was the Planned *and* Actual.
- `falsePositives` — count of trades where this was Planned but Actual was something else (read misses).
- `discoveredHere` — count of trades where this was Actual but Planned was something else (mistagged-into-this-model).

**`PlaybookCard.tsx` / `PlaybookStatsCard.tsx`** — show a small "Read accuracy: 62% (8 misreads)" line under the headline metrics. Trades you misread won't quietly inflate a model's win-rate any more.

**Reports (`generate-report` edge function)** — the existing `read_quality` block already covers the cross-cutting view; no change needed there.

**Migration concerns:** none. `actual_playbook_id` is nullable and most trades have it blank, so behaviour is identical for ungraded trades. Only graded mismatches shift attribution.

---

## Part 2 — Properties tab: collapse the redundant Profile / Regime duplication

You're right that **Profile** and **Regime** are doing overlapping work:

| Field | Current options | What it really means |
|---|---|---|
| **Profile** | Consolidation, Expansion, Reversal, Continuation | *Price-action structure* the trade is built on |
| **Regime** | Rotational, Transitional | *Market state* (range vs trending) |

In practice: "Consolidation + Rotational" and "Expansion + Transitional" are nearly always the same call worded twice. The other combinations rarely get used.

### Proposed change

**Option A — Merge into a single "Market Profile" field** (recommended):
- Deprecate `regime` as a user-facing dropdown.
- Expand `profile` options to: Rotational-Consolidation, Rotational-Reversal, Transitional-Expansion, Transitional-Continuation (or let the user define their own — see below).
- Keep `regime` column in the DB (and `valid_regimes` on playbooks) for backward compat and for the Sensei AI to keep grouping, but auto-derive it from the profile via a tiny mapping.

**Option B — Keep both but stop showing them as separate rows**:
- Render a single "Profile · Regime" row in `TradeProperties.tsx` with two compact pickers side-by-side (and one row for Planned, one for Actual). Goes from **6 rows → 2 rows** for the Profile/Regime block.

I'll implement **Option B** by default since it preserves your existing report data and doesn't require a migration — but if you confirm you'd rather collapse to a single concept (Option A), I'll do that instead.

### Make all property dropdowns user-editable

Right now `Settings → Properties` only lets you customise **Profile / Timeframe / Emotion**. The Regime, Session, and Direction dropdowns are hardcoded. Add **Regime** and **Session** to the `PROPERTY_TYPES` array in `PropertyOptionsPanel.tsx` and wire `TradeProperties.tsx` to read those options from `usePropertyOptions(...)` instead of the hardcoded `regimeOptions` / `sessionOptions` constants. (Sessions already have their own dedicated tab for time-window editing — this just lets you rename the labels.)

### Tighten the Properties side-panel layout

Also collapse:
- **Planned Model + Actual Model** → one row, two pickers ("Planned ⟶ Actual").
- **Alignment + Entry TF** → one row labelled "Timeframes" (HTF chips on the left, entry chips on the right). They're both timeframe pickers and visually identical today.

Net result: Properties panel goes from ~14 rows to ~8, and every dropdown is user-editable from Settings.

---

## Files I'll touch

- `src/hooks/usePlaybookStats.tsx` — switch attribution to `COALESCE(actual_playbook_id, playbook_id)`, add read-accuracy fields.
- `src/components/playbooks/PlaybookCard.tsx`, `PlaybookStatsCard.tsx` — surface read-accuracy line.
- `src/components/journal/TradeProperties.tsx` — merge Planned/Actual rows for Model, Profile, Regime; merge Alignment/Entry TF; pull regime/session options from `usePropertyOptions` instead of hardcoded arrays.
- `src/components/journal/settings/PropertyOptionsPanel.tsx` — add Regime + Session to `PROPERTY_TYPES`.
- `src/hooks/useUserSettings.tsx` — seed default Regime + Session options on first load (so existing users see the same labels they have now).

No DB migration needed.

---

**One question before I build it:** for the Profile/Regime overlap, do you want me to **merge them into a single "Market Profile" field (Option A — cleaner, irreversible)**, or **keep both but show them side-by-side in one row (Option B — safer, recommended)**? I'll default to **B** unless you say otherwise.