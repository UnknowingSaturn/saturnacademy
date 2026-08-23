# Journal architecture: fix the silent-overwrite bugs, then consolidate

Two audits (write path + field/layout system) found the real reason edits "save successfully" but don't stick in the Properties sidebar, plus a set of structural duplications worth collapsing. The cache-refresh fix from earlier was necessary but not sufficient.

## Root cause of what you're seeing

**The open detail panel overwrites your Properties edits.** The review panel (Psychology, Checklist, Mistakes, Notes) keeps a full in-memory copy of the trade's review and autosaves the *whole* object on a debounce. That copy is only re-seeded when you switch to a different trade — never when the same trade's data changes underneath it. So when you set Planned Regime or Emotion in the Properties sidebar, the write succeeds, the toast fires, then the next autosave tick pushes the panel's stale copy back over it. The table (a different read path) shows the new value for a moment; the sidebar reverts. Same trade, two writers, last-write-wins.

**Group legs never get review edits.** The fan-out helper assumes every mutation looks like `{ id, ...columns }`. Review mutations look like `{ review: { trade_id } }`, so the helper writes to the leader's review N times instead of once per leg. Trade-column edits (Profile, Actual Regime) fan out correctly; review-backed ones (Planned Regime, Emotion) do not.

**Renamed fields show their old name inside the field.** You renamed `alignment` to "Entry" and `entry_timeframes` to "Alignment". The row label respects the rename; the empty-state text inside the dropdown still prints the registry default ("HTF Timeframes", "Entry Timeframes"), which reads like a stale value. There are currently three separate stores for field labels — the table header reads one, the detail row reads another, and the new layout system writes a third that nothing reads.

## Phase 1 — Stop the data loss (the actual bug)

1. `TradeDetailPanel.tsx`: re-seed the local review snapshot whenever the server review changes, not only on trade switch. Reconcile per field: keep fields the user is actively editing (dirty), refresh everything else from the server.
2. `TradeDetailPanel.tsx`: make autosave send only the fields that section owns (checklist, news risk, psychology notes, mistakes/did-well/to-improve, actionable steps, thoughts, screenshots) and never `regime` / `emotional_state_before`, which the Properties sidebar owns. The upsert already handles sparse payloads, so this removes the collision entirely.
3. `FieldCell.tsx` `useLegMutate`: branch on payload shape — for review payloads, rewrite `review.trade_id` per leg instead of injecting a top-level `id`.
4. `TradeProperties.tsx`: delete the unused local fan-out wrappers so there is one fan-out implementation.
5. `useTrades.tsx` `useUpdateTrade`: an unknown column passed to the mutation is currently dropped while still showing "Trade updated successfully". Validate against the allowlist and throw on unknown keys; add the columns that legitimately belong (`trade_type`, `risk_percent`, `is_archived`, `archived_at`, `original_lots`).

## Phase 2 — One source of truth for field config

6. Make `journal_field_layout` (order, hidden, groups, labels) the only store. Read labels from `layout.labels` in both the table header and the detail row; have the Fields settings panel write only there; keep `field_label_overrides` / `column_overrides` / `visible_columns` / `column_order` / `detail_visible_fields` / `detail_field_order` as one-time migration inputs only (already handled by `normalizeLayout`).
7. Pass the resolved label into `FieldCell` so the empty-state placeholder matches the row label (and use a neutral "Empty" for detail rows).
8. Respect `field.surfaces` when rendering the detail panel, and let fields that are currently unreachable in the detail view (`direction`, `net_pnl`, `duration_seconds`, custom fields) be added to a detail group from the Fields panel.
9. Drop the dead `DEFAULT_COLUMNS` table in `types/settings.ts` — it has the alignment/entry-timeframe labels swapped and points both at the same option set, which is where that confusion originated.

## Phase 3 — Efficiency

10. Lift the per-cell data hooks (`usePropertyOptions`, `useSessionLookup`, `useCustomFieldDefinitions`, accounts, playbooks) into a single journal field context provided once by the table and the detail panel, and pass resolved option maps down. Today a 1000-row table creates thousands of independent query subscriptions that all re-render on any cache update.
11. Memoize the column definitions so `buildFieldRegistry` and per-column resolution don't re-run on every render.

## Verification

- Open a grouped trade, edit Planned Regime and Emotion in Properties, then type in Psychology Notes; confirm the regime/emotion values survive the autosave tick and match after a reload.
- Confirm each leg's review row carries the new regime (checked directly in the database).
- Rename a field and confirm the same name appears in the table header, the detail row, and the empty-field placeholder.
- Run the existing journal test suite plus a new regression test for the fan-out payload shapes.

Phase 1 is the fix for your reported bug and can ship on its own; Phases 2 and 3 are the cleanup that stops it recurring.
