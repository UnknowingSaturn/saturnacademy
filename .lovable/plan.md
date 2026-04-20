

# Add "Re-run Sensei" to existing reports

Lets you regenerate just the LLM narrative (verdict, grade, sensei notes, goals) on any past report without recomputing the deterministic metrics or losing the report row.

## Backend — `supabase/functions/generate-report/index.ts`

Add a new request shape: `{ action: "rerun_sensei", report_id: string }`. When this is set, branch early in the handler instead of doing the full pipeline:

1. Auth check (same as today — JWT must own the report, or service key).
2. Load the existing `reports` row by `id`.
3. Reuse its already-computed `metrics`, `edge_clusters`, `leak_clusters`, `consistency`, `psychology` to rebuild the LLM payload (same code path as today, just skip the data-fetch + cluster-compute steps).
4. Re-fetch `trades` + `trade_reviews` for the same period to rebuild `worst_trade_narratives`, `tilt_narrative`, `review_excerpts`, `_valid_trade_ids/_emotions/_symbols` — these aren't stored on the report row.
5. Call `callSensei()` with the existing model (or accept an optional `model` override).
6. **Update** the row (don't insert) with fresh `sensei_notes`, `verdict`, `grade`, `goals`, `sensei_model`, `status`, `error_message`, plus a new `sensei_regenerated_at timestamptz` column.
7. Return the updated row.

If sensei fails on rerun, keep the previous narrative (don't blank the row); set `status='failed'` and `error_message`, return updated row.

### Migration
Add one nullable column:
```sql
alter table reports add column if not exists sensei_regenerated_at timestamptz;
```

## Frontend

### `src/hooks/useSenseiReports.tsx`
Add `useRerunSensei()`:
- mutationFn invokes `generate-report` with `{ action: "rerun_sensei", report_id }`
- onSuccess invalidates both `["reports","list"]` and `["reports","detail", id]`
- Toast: "Sensei rewrote the narrative" (or failure toast keeps existing)

### `src/components/reports/ReportView.tsx`
- Add a small `<Button variant="outline" size="sm">` in the hero header's top row (next to the "WEEKLY SENSEI · …" eyebrow), right-aligned: **"Re-run Sensei"** with `RefreshCw` icon.
- Disabled + spinner while pending.
- If `report.sensei_regenerated_at` exists, show a tiny muted line under the verdict: *"Narrative refreshed Apr 20, 14:32"*.
- Skip the button on empty-period reports (`isEmpty === true`) — nothing for the LLM to chew on.

## Files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_sensei_rerun.sql` | NEW — add `sensei_regenerated_at` column |
| `supabase/functions/generate-report/index.ts` | Branch on `action === "rerun_sensei"`: reuse stored metrics, re-fetch trades/reviews for LLM context, update row instead of insert |
| `src/types/reports.ts` | Add optional `sensei_regenerated_at?: string \| null` |
| `src/hooks/useSenseiReports.tsx` | Add `useRerunSensei()` mutation |
| `src/components/reports/ReportView.tsx` | Add "Re-run Sensei" button in hero + "refreshed at" timestamp |

No new dependencies. No changes to scheduling or cron. Determines metrics stay frozen; only the AI prose gets a fresh take.

## Validation

1. Open any completed report → click "Re-run Sensei" → spinner → narrative updates in place, metrics stay identical, `sensei_regenerated_at` shows "just now".
2. Re-run a `failed` report → if AI succeeds this time, `status` flips to `completed` and prior `error_message` clears.
3. Empty-period report → button hidden.
4. Non-owner trying to rerun someone else's report → 403 (RLS via JWT auth check).
5. Click rerun twice quickly → button disabled during flight, no double mutation.

