

# Fix the regenerated Sensei report (3 real bugs)

The rerun ran, but the output has 3 concrete defects you can see in the current report:

## What's actually broken

**1. Only 3 of 5 required sections rendered** — `The Verdict` and `The One Thing` got silently dropped.
The tool schema requires exactly 5 sections, but `callSensei` post-validation strips any section that fails *any* of these filters:
- has 0 cited trade IDs
- contains a banned phrase (e.g., the word "indicating a need for")
- starts with a banned opener
- is <40 words
- alphaRatio <0.55

When the LLM returns a perfectly valid section that happens to use a banned phrase or doesn't cite a trade (the verdict section often doesn't need citations), it's deleted entirely with no fallback. Result: a broken 3-section report with no "Verdict" or "One Thing" — exactly what you're seeing.

**2. Raw cluster labels leak into prose** — `'off_hours · EURUSD+ · unknown (NY Continuation)'`, `'new_york_am · XAGUSD · unknown (No playbook)'`.
The stored `edge_clusters[].label` was generated **before** the humanizer was added, so it's still raw `session · symbol · emotion (playbook)`. The rerun reuses these stored labels verbatim → the LLM quotes them as-is.

**3. Wrong model used + raw UUIDs in body text**
- `sensei_model = "google/gemini-2.5-flash"` — but the plan says weekly/monthly/custom should default to `gemini-2.5-pro`. The rerun code (line 955) defaults to `gemini-2.5-flash` for `report_type='custom'`. The original report was generated as `custom` so it's stuck on flash.
- Bodies render raw UUIDs like `(trade ID: \`5418a91d-...\`)` — the LLM was told to "anchor with P&L/R/date" but not told to *omit* the bare UUID since the citation chip system handles that visually.

## Fix plan

### A. `supabase/functions/generate-report/index.ts`

**A1. Re-humanize cluster labels at LLM-time, not just at compute-time.**
In `buildLlmContext`, before passing `edge_clusters` / `leak_clusters` to the LLM, *re-derive* a humanized `label` from the stored `dimensions` field (which has clean `{session, symbol, emotion, playbook}` even on old reports). Stored labels stay untouched (no migration); only the LLM payload gets the polished version.

**A2. Soften the post-validation so sections aren't silently dropped.**
- Don't strip the verdict/headline section for missing citations (it summarizes).
- For other sections, instead of *deleting* on banned-phrase / short-body / low-alpha, mark them `_quality_warning` and keep them — better partial than blank. Hard-drop only on banned *opener* (since that's an obvious recap-the-table tell).
- If after filtering we have <5 sections, fall back to `args.sections` originals (raw model output) so the user always gets the full coaching letter.

**A3. Rerun model default flip.**
Change line 955 so reruns always default to `google/gemini-2.5-pro` (the deeper-reasoning model) regardless of original `report_type`. Pro handles the long structured-output requirement much better than flash, which is partly why we got 3 sections instead of 5.

**A4. Tell the LLM not to print bare UUIDs in prose.**
Add to the system prompt: *"Reference trades by their `trade_number` and date in prose (e.g., 'trade #29 on Dec 11, +17.4R'). Do NOT paste UUIDs into body text — the `cited_trade_ids` array handles linking."* The LLM has `trade_number` available in `worst_trade_narratives` and cluster `trade_refs` but isn't being told to use it instead of the UUID.

**A5. Strip raw UUIDs as a safety net.**
After validation, regex-replace any `[0-9a-f]{8}-[0-9a-f]{4}-...` pattern in section bodies with empty string + cleanup of orphan parentheses ("(trade ID: )" → ""). Belt + suspenders.

### B. Frontend — no changes needed
`ReportView.tsx` already renders `cited_trade_ids` as chips; the prose just needs to stop duplicating them.

## After the fix, re-run Sensei on the December report → expect

- 5 distinct sections (Verdict, Edge, Bleed, Pattern Underneath, One Thing) all visible
- Cluster references read as English: "Your Silver trades during NY-AM" instead of `'new_york_am · XAGUSD · unknown (No playbook)'`
- Trade references read as "trade #29 on Dec 11, +17.4R" with chips below — no inline UUIDs
- `sensei_model` shows `google/gemini-2.5-pro`
- `sensei_regenerated_at` updates to current time

## Files

| File | Change |
|---|---|
| `supabase/functions/generate-report/index.ts` | Re-humanize cluster labels in `buildLlmContext` (A1); relax `callSensei` validation to keep partial sections + fallback to raw if <5 (A2); default rerun model to gemini-2.5-pro (A3); add "no UUIDs in prose, use trade_number+date" rule to system prompt (A4); regex-strip UUIDs as safety net (A5) |

No DB migration. No frontend change. No new dependencies.

## Validation

1. Click "Re-run Sensei" on the December report → returns 5 sections with `sensei_model = google/gemini-2.5-pro`.
2. Body text contains no UUIDs and no `· · ` separator strings.
3. "Verdict" and "One Thing" sections are present and non-empty.
4. Existing trade-citation chips still link correctly.

