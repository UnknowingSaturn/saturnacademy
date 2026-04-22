

# Fix the broken trade fetch (PGRST201) — Journal is empty because of an ambiguous embed

## What's actually broken

The April-22 migration added `actual_playbook_id` as a foreign key to `playbooks`. The `trades` table now has **two** FKs to `playbooks`:

- `trades_playbook_id_fkey` (planned model)
- `trades_actual_playbook_id_fkey` (actual model)

Every existing query uses `playbook:playbooks (*)` — PostgREST can no longer auto-pick which FK to follow and returns:

```
HTTP 300 — PGRST201
Could not embed because more than one relationship was found
for 'trades' and 'playbooks'
```

This is what the network log shows on `/journal` right now. The result: **Journal, Trade Detail, Live Trades, Archived view, and `useTrade()` all return errors** and render empty. No data was lost (DB still has 153 active trades), the queries just can't deserialize.

## The fix — disambiguate the embed by FK name

PostgREST hint syntax: `alias:table!fk_constraint_name (*)`.

Change every `playbook:playbooks (*)` to `playbook:playbooks!trades_playbook_id_fkey (*)` (the planned model — the existing semantic). Optionally also add `actual_playbook:playbooks!trades_actual_playbook_id_fkey (*)` where the UI needs the joined Actual Model name (currently `TradeTable` and `TradeProperties` resolve names from the local playbooks list, so embedding it isn't strictly required, but it's cheap and consistent).

## Files to change

| File | Edit |
|---|---|
| `src/hooks/useTrades.tsx` | 4 embeds: `useTrades` select (line 60, 63), `useTrade` select (line 98 — twice), `useArchivedTrades` select (line 318, 321). Replace `playbook:playbooks (*)` with `playbook:playbooks!trades_playbook_id_fkey (*)` and add `actual_playbook:playbooks!trades_actual_playbook_id_fkey (id, name, color)` alongside. The nested `trade_reviews.playbook:playbooks(*)` join uses a different table (`trade_reviews.playbook_id`) and is unaffected by the new FK — but to be safe, change to `playbook:playbooks!trade_reviews_playbook_id_fkey (*)` only if a similar ambiguity exists; otherwise leave it. |
| `src/hooks/useOpenTrades.tsx` | 1 embed at line 136 — same change. |

The `transformTrade` helpers already spread `...row`, so the new `actual_playbook` alias passes through harmlessly even without a Trade type field.

## What about `trade_reviews → playbooks`?

`trade_reviews` only has one FK to `playbooks` (`playbook_id`), so `playbook:playbooks(*)` inside the nested `trade_reviews` block stays valid. No change needed there. (Verified against the schema dump — `trade_reviews` has no `actual_playbook_id`.)

## Comprehensive-review notes (the rest of your prompt)

I checked the broader items you listed and the only blocking regression is the one above. Quick status on the others:

- **DB integrity**: schema, RLS, and FK relationships are correct (the new FK is exactly what we want — we just need to tell PostgREST which one to follow).
- **RLS**: every table uses per-user `user_id = auth.uid()` predicates. The "wrap in `(select auth.uid())`" optimization is a nice-to-have for very large tables but not necessary here — your tables are small (~150 trades) and the perf gain is negligible. Skipping unless you want me to do a separate pass.
- **Edge functions**: all 14 functions are referenced in code; none are orphaned. `generate-report` already includes the new `actual_*` columns from the previous turn.
- **Cleanup**: no dead code introduced by the planned-vs-actual feature; the `as any` casts were already removed in the prior fix turn.
- **Auth, subscriptions, role-based access**: this app has no roles/subscriptions/driver-invite flows — those bullets in your prompt template don't apply to this project.
- **Mobile/perf**: not in scope for this fix; no recent changes affect responsiveness.

## Validation

1. Reload `/journal` → trades render again (no more PGRST201 in network tab).
2. Open a trade detail panel → loads without error; Planned Model + Actual Model both display.
3. `/live-trades` → open positions list populates.
4. Archived view → still loads.
5. Check console — no `PGRST201` or `Could not embed` errors.

