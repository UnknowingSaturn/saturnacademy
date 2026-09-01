# Journal: stop the save/unsave loop and make the write path single-owner

## What's actually happening

The trade detail panel has two loops fighting each other, and screenshots are the one field that guarantees the loop never settles.

**1. Round-trip identity loop (the screenshot bug).**
`TradeDetailPanel` keeps a full in-memory `ReviewData` copy and autosaves it on a 500 ms debounce (`src/components/journal/TradeDetailPanel.tsx:130-168`). A separate effect re-seeds that copy from the server whenever `JSON.stringify(trade.review)` changes (`:208-215`), comparing local vs server with `JSON.stringify(prev) === JSON.stringify(next)`.

Every review save calls `invalidateAllTradeCaches`, which invalidates the entire `["trade", *]` and `["trade-group", *]` namespaces (`src/hooks/_shared/tradeQueries.ts:46-58`) — including the row that was just written. The refetch delivers a new `trade.review`, the signature changes, the re-seed effect runs, and the string comparison decides local ≠ server, so it calls `setReviewData`. `useAutoSave` sees changed data, flips to `unsaved`, saves again 500 ms later, which invalidates again. Save → unsaved → save, forever.

Scalar and string-array fields survive the round trip byte-identically, so the loop stays dormant — until screenshots exist. Screenshots are an array of **objects** stored in `jsonb`; Postgres does not preserve client key order in `jsonb`, so the array that comes back is never string-equal to the array the panel sent, no matter how many times it saves. Adding a screenshot is precisely the action that arms the loop. (Checked the data: all 199 review rows already store screenshots as well-formed objects, so no legacy string rows are involved — the mismatch is ordering/shape, not bad data.)

**2. Fan-out amplification.** For a grouped (multi-leg) trade, one autosave tick issues one upsert per leg (`TradeDetailPanel.tsx:153-158`), each with its own full-namespace invalidation. A 3-leg trade produces 3 writes and 3 refetch storms per keystroke-debounce.

**3. Dropped writes look like "unsaving".** `useAutoSave.performSave` returns early when a save is already in flight (`src/hooks/useAutoSave.tsx:87`), so edits made during a save are silently discarded from the baseline and the status bounces. There is also no coalescing: `lastSavedRef` is only updated with the payload that was sent, not the payload that is current.

**4. Dead field.** `reviewed_at` is sent by `saveReview` but is not in the upsert allowlist (`src/hooks/useTrades.tsx:345-359`), so it is silently dropped on every save.

## The fix

### Phase 1 — Break the loop (this is your bug)

1. **Canonical comparison.** Add a `canonicalizeReview(data)` helper that sorts object keys and normalizes `null`/`undefined`/`""` before any equality check, and use it in the re-seed effect and in `useAutoSave`'s change detection instead of raw `JSON.stringify`. A server echo of what we just wrote must compare equal.
2. **Don't self-invalidate.** Give `useUpsertTradeReview` (and `useUpdateTrade`) an `echo`-suppression path: after a silent autosave, write the returned row into the caches directly (`setQueryData`) instead of invalidating the whole trade namespace. Reserve full invalidation for user-initiated, non-silent mutations.
3. **Version guard.** Track the payload signature of the last successful save; the re-seed effect ignores any server snapshot whose canonical form matches a save this panel just issued.
4. **Coalesce saves.** In `useAutoSave`, replace the "drop while saving" early-return with a pending-payload queue: if data changes mid-flight, save again once the in-flight request resolves, then compare against the latest data rather than the sent data.
5. **Screenshots save immediately and independently.** Adding/deleting a screenshot is a discrete action, not a text-typing action. Route it through a dedicated `screenshots`-only upsert (fires on add/delete/edit, no debounce), so an upload can never be lost to a debounce race or clobbered by a stale panel snapshot.
6. Drop `reviewed_at` from the payload or add it to the allowlist — pick one; currently it is a lie.

### Phase 2 — One owner per field

7. Make the debounced autosave send only the fields the review body owns (checklist, news risk, psychology notes, mistakes/did-well/to-improve, actionable steps, thoughts) and never the fields the Properties sidebar owns. The upsert already handles sparse payloads, so this removes the last cross-writer collision.
8. Fan-out for grouped trades: issue the leg writes as one batched upsert (single request, `onConflict: trade_id`) instead of N parallel mutations with N invalidations.
9. Give screenshot deletion the same treatment: storage delete and review write should not be able to half-apply — remove from the review row first, then best-effort delete the object.

### Phase 3 — Reduce refetch pressure

10. Narrow `invalidateAllTradeCaches`: invalidate the specific trade and its group key, plus list caches, rather than every `["trade", *]` entry. The current blanket invalidation refetches every open trade detail query on any edit.
11. Show a truthful status: `SaveStatusIndicator` should reflect the coalesced queue (saving / saved / retrying), not flicker between `unsaved` and `saved` on cache echoes.

## Verification

- Open a trade, add a screenshot, and watch the network panel: exactly one review write, status settles on "Saved" and stays there (today it oscillates).
- Add a screenshot to a 3-leg grouped trade; confirm one batched write and that all legs carry the image.
- Type in Psychology Notes while a save is in flight; confirm the last keystroke persists after reload.
- Edit a Properties dropdown, then type a note; confirm neither overwrites the other.
- Run the journal test suite plus a new regression test asserting that a server echo of a just-saved review does not trigger a second save.

Phase 1 fixes the reported bug and can ship alone; Phases 2 and 3 stop it recurring.
