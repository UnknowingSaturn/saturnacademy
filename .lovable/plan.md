## Root cause

Account #76036 has 2 legacy stuck trades with this `trade_repair_events` history:

```
snapshot_closed     (legacy tombstone, 2026-05-12 / 2026-05-20)
phase_a_one_shot    (one-shot backfill marker, 2026-05-27)
```

`phase_a_one_shot` is the "I've accepted this trade, stop nagging me" marker. Two places already treat it as a resolved state:

- `src/components/journal/TradeTable.tsx:325-329, 336-340` — clears the per-row "Awaiting repair" pill.
- `supabase/functions/ingest-events/index.ts:646-650` — clears the in-event awaiting check.

But the dormant-account badge ("2 awaiting repair") and the "Try repair" button go through two other paths that **don't** recognize `phase_a_one_shot`:

- `supabase/functions/trades-drift/index.ts:142-146` — counts a trade as pending if it has `snapshot_closed` and lacks `repaired_from_snapshot` / `repaired_reopened`.
- `supabase/functions/repair-snapshot-closed/index.ts:110-117` — same filter when picking candidates to repair.

So the badge counts these legacy trades forever, and clicking Try repair runs `repair-snapshot-closed`, which searches `events` for a real close, finds nothing (the events never came in because the user switched MT5 logins), and returns "pending". Badge never clears.

## Fix

Treat `phase_a_one_shot` as a "repaired" marker in both edge functions, exactly like the frontend and ingest path already do.

### Edits

1. **`supabase/functions/trades-drift/index.ts`** — add `e.action === "phase_a_one_shot"` to the `repaired` predicate at line 143-145.
2. **`supabase/functions/repair-snapshot-closed/index.ts`** — same addition at line 113-115, so phase-A-acknowledged trades stop being re-considered as candidates.

No schema changes. No frontend changes (already correct). Deploy both functions after edit.

### Why this is right, not a patch

The four call sites that read repair-event history were inconsistent — three included `phase_a_one_shot`, one did not. Aligning them on the same "resolved" definition is the actual fix, not a workaround. Optionally we can extract `REPAIRED_ACTIONS = ["repaired_from_snapshot","repaired_reopened","phase_a_one_shot"]` into a shared constant later, but inlining it in two more places is fine and keeps the change minimal.
