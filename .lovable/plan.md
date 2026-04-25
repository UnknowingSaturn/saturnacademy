
# Two new features: Shareable Trade Reports + AI Knowledge Base

Both are independent — I can ship them as PR 1 and PR 2 in the same loop.

---

## PR 1 — Shareable Weekly Trade Reports

### Concept

You hand-pick trades → assemble them into a "Trade Report" with educational context (no $ amounts, no lot sizes) → share via either a public link OR keep it logged-in-only.

This is **separate** from the existing Sensei `reports` table (which is your private weekly sensei analysis). The new feature is for outward-facing storytelling — closer to a Substack post built from your trades.

### Database — new tables (one migration)

**`shared_reports`**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | RLS: owner only for write |
| slug | text unique | short unguessable, e.g. `r_a8f3k2` |
| title | text | "Week of Apr 15 – NAS reversal week" |
| intro | text nullable | markdown — your weekly preamble |
| visibility | text | `public_link` \| `private` |
| period_start | date | |
| period_end | date | |
| author_display_name | text nullable | shown to public viewers |
| view_count | int default 0 | |
| published_at | timestamptz nullable | null = draft |
| created_at / updated_at | timestamptz | |

**`shared_report_trades`** (many-to-many — picks which trades appear)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| shared_report_id | uuid → shared_reports |
| trade_id | uuid → trades | |
| sort_order | int | |
| caption_what_went_well | text nullable | your free-text |
| caption_what_went_wrong | text nullable | |
| caption_what_to_improve | text nullable | |
| screenshot_overrides | jsonb default `[]` | optional per-screenshot captions/order overrides; if empty, fall back to `trades.id`'s own screenshots/captions |
| unique (shared_report_id, trade_id) | | |

### RLS

- `shared_reports`: owner can CRUD. Anonymous SELECT allowed **only** when `visibility = 'public_link' AND published_at IS NOT NULL`.
- `shared_report_trades`: owner CRUD. Anonymous SELECT allowed only when the parent `shared_reports` row passes the rule above (subquery in the policy).
- For `trades` and `trade_screenshots`/`trade_reviews`: anonymous users can't query them directly. The public route uses an **edge function** (`get-shared-report`) that runs with service role and returns ONLY the educational fields below.

### Public-facing trade card — fields exposed

Locked-down whitelist enforced server-side in the edge function:
- `symbol`, `direction`, `entry_time` (formatted), `session`
- `playbook.name` (looked up via `actual_playbook_id || playbook_id`)
- screenshots[] from `trades.id`'s screenshot gallery → `{ url, timeframe, description }`
- your three captions (well / wrong / improve) from `shared_report_trades`

**Hidden:** `entry_price`, `exit_price`, `total_lots`, `net_pnl`, `gross_pnl`, `r_multiple_*`, `risk_percent`, `balance_at_entry`, `equity_at_entry`, `account_id`. None of these enter the JSON response — they're stripped at the edge function boundary, not at the React layer.

### Frontend — new files

- `src/pages/SharedReports.tsx` — list of your reports + "New report" button (sidebar entry under Main, between Reports and Trade Journal)
- `src/pages/SharedReportEditor.tsx` — edit screen with three panes:
  - left: title / intro / visibility toggle / publish button
  - middle: trade picker (search + check trades by symbol/date/session, drag-to-reorder)
  - right: per-trade caption editor + live preview of the educational card
- `src/pages/PublicReport.tsx` — the shared view at `/r/:slug` (no auth required, route registered before `<ProtectedRoute>`)
- `src/components/shared-reports/EducationalTradeCard.tsx` — the public card (used in both editor preview and public page)
- `src/components/shared-reports/ShareDialog.tsx` — copy link, toggle public/private
- `src/hooks/useSharedReports.tsx` — CRUD hooks

### Edge function — `get-shared-report`

- Public (no JWT). Input: `{ slug }`.
- Validates the report is `public_link` + published OR caller is the owner (check `Authorization` header → `auth.getUser()` → match `user_id`).
- Loads report + trade IDs, fetches trades + screenshots + playbook names, **whitelists** the fields, returns sanitized payload.
- Increments `view_count` on first load per session (using a simple in-memory rate map; not a critical metric).

### Sidebar nav

Add "Shared Reports" with `Share2` icon between "Reports" and "Trade Journal".

### Publishing flow

1. Draft → user picks trades, writes captions
2. Set visibility (private = only logged-in owner can view, public_link = anyone with `/r/:slug`)
3. Click Publish → sets `published_at`, slug becomes shareable
4. ShareDialog shows the URL + copy button + visibility toggle

---

## PR 2 — AI Knowledge Base (`/knowledge`)

### Concept

Paste any URL (article, Substack, YouTube transcript page, etc.) → Firecrawl scrapes it → Lovable AI extracts trading concepts + screenshots + key takeaways → saves as a "knowledge entry". You can then **chat with each entry** to ask follow-up questions.

### Database — one migration

**`knowledge_entries`**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | RLS owner-only |
| source_url | text | |
| source_title | text | scraped `<title>` |
| source_author | text nullable | |
| source_published_at | date nullable | from page metadata if present |
| status | text | `extracting` \| `ready` \| `failed` |
| error_message | text nullable | |
| summary | text | AI-generated 2-3 sentence summary |
| key_takeaways | jsonb | `string[]` — bulleted lessons |
| concepts | jsonb | `[{label, definition}]` |
| tags | text[] | AI-suggested e.g. `["volume profile","imbalance","NAS100"]` |
| screenshots | jsonb | `[{url, caption, source_url}]` — images Firecrawl extracts, copied to our storage |
| raw_markdown | text | full scraped body, kept for chat context |
| created_at / updated_at | timestamptz | |

**`knowledge_chat_messages`**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| knowledge_entry_id | uuid → knowledge_entries |
| user_id | uuid | redundant for RLS speed |
| role | text | `user` \| `assistant` |
| content | text | markdown |
| created_at | timestamptz | |

RLS: owner-only on both tables.

### Storage

Reuse the existing `trade-screenshots` bucket but namespace under `knowledge/{user_id}/{entry_id}/{n}.{ext}` so we don't need a new bucket. Public bucket — fine for educational images.

### Connector required: Firecrawl

I'll trigger the connector picker via `standard_connectors--connect` with `connector_id: firecrawl` early in the implementation. Free tier is enough to start.

### Edge functions — two new

**1. `extract-knowledge`** (called from frontend after creating the entry row in `extracting` state)
- Input: `{ entry_id, url }`
- Auth: requires JWT; checks the row belongs to caller.
- Steps:
  1. Call Firecrawl `/v2/scrape` with formats `["markdown", "summary"]` and `onlyMainContent: true` → get markdown, title, summary, image URLs from metadata + inline.
  2. Pull images: download each image URL, upload to Supabase storage under `trade-screenshots/knowledge/{user_id}/{entry_id}/`.
  3. Call Lovable AI (`google/gemini-3-flash-preview`) with a prompt like: "From this trading article, extract: 2-3 sentence summary, 5-8 key takeaways, 3-6 named concepts (with definition), 4-8 tags. Return strict JSON." Use the `--json` mode equivalent in code (response_format: json_object).
  4. For each saved screenshot, optionally ask AI to write a 1-line caption based on its surrounding paragraph — only if it's an actual chart image (heuristic: filter out logos/avatars by min dimensions ≥ 400×200 if Firecrawl returns dimensions; otherwise keep all).
  5. Update the row with `status='ready'`, all fields populated, plus `raw_markdown` for later chat context.
- On failure: set `status='failed'`, `error_message`, return 200 with the error inside.

**2. `knowledge-chat`** (per-entry chat)
- Input: `{ entry_id, messages: [{role, content}] }` — full client-managed history per chat best practices.
- Auth: requires JWT.
- Loads the entry, builds system prompt: "You are answering questions about this trading article. Source: {title} ({source_url}). Summary: {summary}. Key takeaways: {...}. Full body: {raw_markdown[:20k chars]}. Cite specific takeaways when relevant."
- Calls Lovable AI with full message history.
- Persists both the latest user message and the assistant reply to `knowledge_chat_messages` (so the user can come back later).
- Returns assistant message.

### Frontend — new files

- `src/pages/Knowledge.tsx` — two-pane layout (sidebar list of entries + main detail view), matches existing `Reports.tsx` structure
- `src/components/knowledge/KnowledgeSidebar.tsx` — list grouped by month, shows tags + status badge (`Extracting…` spinner / `Ready` / `Failed`)
- `src/components/knowledge/AddUrlDialog.tsx` — single input + Submit; creates row in `extracting` state and invokes `extract-knowledge`
- `src/components/knowledge/KnowledgeEntryView.tsx` — the article-style read view: title, source link, summary, takeaways list, concepts cards, screenshot gallery (reuse the same gallery pattern as `TradeScreenshotGallery`), tags
- `src/components/knowledge/KnowledgeChat.tsx` — collapsible chat pane below the article. ReactMarkdown rendering. Manages full message history client-side, persists via the edge function.
- `src/hooks/useKnowledge.tsx` — list / detail / create / extract / delete
- `src/hooks/useKnowledgeChat.tsx` — load history + send message

### Sidebar nav

Add "Knowledge" with `BookMarked` icon at the bottom of the **Tools** group (after Accounts).

### Failure modes handled

- Firecrawl 402 / quota exhausted → friendly error with link to Connectors
- AI returns malformed JSON → retry once, then fall back to summary-only entry with a "Re-run extraction" button
- Image download fails → skip that image, continue with others (don't fail the whole extract)

---

## What's intentionally NOT in scope

- **Email delivery of shared reports** — link sharing only. We can add SendGrid/Resend later if you want auto-send to a subscriber list, but that needs an email connector and a recipient model. Not blocking — you can already paste the link in DMs/X/email yourself.
- **Comments/likes on public reports** — pure read-only public view first. Adding a comments table later is straightforward.
- **PDF export** — same idea, can layer on later if you actually want to email PDFs.
- **Knowledge → playbook auto-suggestion** — interesting but a separate feature. For now, knowledge is a read/chat archive.

---

## Validation checklist

After build:
1. Create a shared report → pick 3 trades → add captions → publish as `public_link` → open `/r/:slug` in incognito → verify NO $ amounts, lots, R-multiples, balances anywhere in the DOM or network response.
2. Toggle the same report to `private` → incognito should now get 404; logged-in owner still sees it.
3. Paste the example URL `https://otgresearch.substack.com/p/volume-profile-trading-trading-imbalances` → wait ~15-20s → verify summary + takeaways + at least one chart screenshot saved.
4. Open chat on that entry → ask "How does this apply to NAS100 during London open?" → get a contextual reply citing the takeaways.
5. RLS sanity: log in as User B → cannot read User A's `knowledge_entries` rows even via direct query.
