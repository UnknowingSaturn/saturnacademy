

# Make the Sensei report actually feel like a sensei

## Two distinct problems to fix

1. **The LLM section is robotic** — it parrots metrics instead of coaching. Cluster labels like `new_york_am · XAGUSD · unknown (No playbook)` leak through verbatim. No voice, no insight beyond what the table already shows.
2. **The page is visually flat** — every section looks the same, the verdict is buried, the grade is small, the metric grid has no hierarchy, and the sidebar is a list of grey buttons.

## Part A — Make the AI write like a sensei (server-side)

Edit `supabase/functions/generate-report/index.ts`:

### A1. Humanize cluster labels before sending to the LLM
Translate `new_york_am · XAGUSD · unknown (No playbook)` → `"NY-AM Silver, no playbook"`. Map sessions to friendly names (Tokyo / London / NY morning / NY afternoon / Off-hours), drop `unknown` emotion, drop `(No playbook)`. The LLM only ever sees clean English.

### A2. Rewrite the Sensei system prompt with voice + structure
Replace the current generic prompt with one that demands:
- **Voice**: Direct, second-person ("you"), conversational, dry wit allowed. No corporate hedging.
- **Forbidden openers**: "Your total R was…", "This period saw…", "It is observed that…" — kill the recap-the-table reflex.
- **Required structure** for each of the 5 sections:
  - **The Verdict** (1 sentence, names the single most important thing)
  - **The Edge** (what specifically worked + *why* it likely worked, grounded in cited trades' context)
  - **The Bleed** (the dominant leak named as a *behavior*, not a cluster — e.g. "You doubled down on Silver after a loss and lost a quarter of the month on one trade")
  - **The Pattern Underneath** (cross-references tilt sequences + emotion notes + revenge trades to name the *meta-pattern*)
  - **The One Thing** (single highest-leverage change for next period)
- **Anchor each paragraph in 1-3 specific trades** with their P&L, date, and any review text, not just IDs.
- **Banned phrases expanded**: "considerable decline", "substantial negative", "needs improvement", "decent", "indicating a need for", "review trades like", "a bit", "for entry optimizations".

### A3. Pass richer context to the LLM
Currently it gets metrics + cluster summaries. Add:
- **Worst-trade narrative**: For top 3 losses, include the actual `trade_reviews.thoughts`, `mistakes`, `psychology_notes` text and the time gap to the prior trade.
- **Tilt sequence excerpts**: For longest tilt sequence, include the chronological list of trade outcomes in plain English ("4:15 PM lost -10R Silver → 4:38 PM lost -8R Silver → 5:11 PM lost -67R Silver").
- **Unreviewed trade count + R impact** so the LLM can call out journaling gaps.
- **Symbol-level expectancy** ranked, so it can say "Gold pays you, Silver bleeds you" instead of cluster-speak.

### A4. Validate output shape
- Reject any sensei section whose body is <40 words OR whose body is ≥60% numbers/IDs (regex check on alphanumeric ratio) — forces actual sentences.
- Auto-rewrite the verdict if it starts with banned openers.

### A5. Bump model temperature to 0.7 (currently default) for the Sensei call only — metrics computation stays deterministic. Keep `gemini-2.5-pro`.

## Part B — Redesign the page so it doesn't look like ChatGPT

Edit `src/components/reports/ReportView.tsx` (major) + `src/components/reports/ReportSidebar.tsx` + `src/pages/Reports.tsx`.

### B1. Hero header (replaces current cramped header)
Full-width gradient band at top:
```text
┌──────────────────────────────────────────────────────────┐
│  WEEKLY SENSEI · Dec 1 – Dec 31, 2025                    │
│                                                          │
│   B-                                                     │
│  ────                                                    │
│   "You proved your NY-AM Gold edge but Silver           │
│    erased it on one revenge trade."                      │
│                                                          │
│  [-70.45R] [-$7,872] [216 trades] [89% checklist]       │
└──────────────────────────────────────────────────────────┘
```
- Massive grade letter (text-7xl), color-graded (A=success, B=primary, C=warning, D/F=destructive)
- Verdict in serif/large italic
- Inline "key stats strip" — 4 chips, no card chrome
- Subtle gradient bg: `bg-gradient-to-br from-primary/10 via-background to-background`

### B2. Sensei's Notes — promote it to the second hero
Currently buried near bottom. Move it to **immediately under the hero**, render as a long-form *article* not a card grid:
- Drop the Card wrapper for sensei sections; render as flowing prose with section headings (`text-2xl font-serif`)
- Each section's cited trade chips inline at the end of paragraphs, not as a separate "Cited:" footer
- Add a left border accent (`border-l-4 border-primary pl-6`) — feels like a coaching letter, not a dashboard widget

### B3. Differentiate sections with visual weight
- **What worked** → success-tinted card (`border-success/30 bg-success/5`) with trophy icon
- **What bled** → destructive-tinted card with skull icon (already exists, push the tint)
- **Numbers** → compact strip not 2x4 grid; show *only* metrics with non-zero deltas, others collapsed under "show all"
- **Consistency** → small horizontal stat row, not a 4-cell grid
- **Psychology** → emotion chips with R-multiples as a heatmap row

### B4. Sidebar redesign
- Each report row shows a **colored grade pill** (large, left-aligned)
- One-line verdict preview (currently truncated at 50 chars — bump to 80 + `line-clamp-2`)
- Period range as small subtitle
- Active row gets `border-l-2 border-primary` instead of just `bg-accent`
- Group header "December 2025" → small all-caps with a trade-count badge ("4 reports")

### B5. Empty state polish
Replace the centered `Sparkles` icon with a quote card: *"Reviewing tape is what separates pros from gamblers."* — sets the tone before any report exists.

### B6. Citation chip upgrade
`CitedTradeChip` currently shows `#42` in mono. Upgrade to show `#42 EURUSD +6.6R` inline with a colored dot — much more readable in flowing prose.

## Files

| File | Change |
|---|---|
| `supabase/functions/generate-report/index.ts` | A1–A5: humanize cluster labels, rewrite prompt with voice + structure, pass richer context (worst-trade reviews, tilt narrative, symbol expectancy), validate output, bump temp |
| `src/components/reports/ReportView.tsx` | B1, B2, B3: hero header with gradient + giant grade, promote Sensei's Notes to article-style with serif headings + left border, color-tint What Worked/What Bled |
| `src/components/reports/ReportSidebar.tsx` | B4: grade pill, 2-line verdict, period subtitle, active border accent |
| `src/components/reports/CitedTradeChip.tsx` | B6: show symbol + R-multiple inline with colored win/loss dot |
| `src/pages/Reports.tsx` | B5: quote-card empty state |

No DB migrations. No new dependencies. No edge function changes beyond the one above.

## Validation

1. Re-generate the same December report → Sensei's Notes now read as coaching prose, not metric recap. Verdict doesn't start with "This period saw…".
2. Cluster labels in narrative read as English ("NY-AM Silver"), never `new_york_am · XAGUSD · unknown`.
3. Page hero shows giant B- grade + verdict; you can read the headline finding in <2 seconds.
4. Sensei section reads as a letter (serif headings, prose flow) not as cards.
5. Sidebar grade pills make session severity scannable at a glance.
6. Cited chips inline read like `#48 XAGUSD -67R` with red dot — no need to hover for context.

