

# Verify MT5 Connect Instructions & URL

## Direct answer

**The URL is correct.** `https://soosdjmnpcyuqppdjsse.supabase.co` is your actual cloud project URL, and the EA (`TradeJournalBridge.mq5` v3.00) calls `https://soosdjmnpcyuqppdjsse.supabase.co/functions/v1/ingest-events`. MT5's WebRequest whitelist matches by URL prefix, so whitelisting the root domain is correct and sufficient — no change needed there.

**The instructions are mostly correct but have 3 small issues** worth fixing:

### Issue 1 — Step 2 missing the compile step
After copying the `.mq5` file to `MQL5/Experts/`, the user must **compile it** (open in MetaEditor → press F7) before MT5 recognizes it as an EA. Restart/refresh alone won't work — they'll see the file but no EA in the Navigator. Every working install guide we have (`mt5-bridge/INSTALL.md`, `MT5SetupDialog.tsx`) mentions compile; only `QuickConnectDialog` skips it.

### Issue 2 — Step 5 missing "Allow Algo Trading" + "Allow WebRequest" checkboxes on the chart
When the user drags the EA onto a chart, the dialog that appears has a "Common" tab with checkboxes. They need to tick **"Allow Algo Trading"** (or the smiley face turns sad and the EA does nothing). Worth adding a one-line note.

### Issue 3 — "Need help?" link points to wrong place
Currently links to `https://docs.lovable.dev` (generic Lovable docs). It should link to the project's own install guide at `/mt5-bridge/INSTALL.md` (which is already shipped and detailed), matching what `MT5SetupDialog.tsx` does.

### Verified correct (no change)
- ✅ URL `https://soosdjmnpcyuqppdjsse.supabase.co` — matches `VITE_SUPABASE_URL` and the EA's hardcoded endpoint
- ✅ Step 1 download path (`/TradeJournalBridge.mq5` exists in `public/`)
- ✅ Step 2 folder path (`File → Open Data Folder → MQL5 → Experts`)
- ✅ Step 3 WebRequest config location (`Tools → Options → Expert Advisors`)
- ✅ Step 4 history import toggle + presets work as described
- ✅ Step 5 API key (setup token) generation flow works

## Plan

Edit `src/components/accounts/QuickConnectDialog.tsx`:

| Step | Change |
|------|--------|
| Step 2 | Add 5th sub-step: "Open the file in MetaEditor and press **F7** to compile" |
| Step 5 | Add a sub-line under the API key: "When the EA settings dialog appears, also tick **Allow Algo Trading** under the Common tab" |
| Footer "Need help?" link | Change `href` from `https://docs.lovable.dev` to `/mt5-bridge/INSTALL.md` (open in new tab) |

No code logic, no DB, no edge function changes. Pure copy + one link href fix.

