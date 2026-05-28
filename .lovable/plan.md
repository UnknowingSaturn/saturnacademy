
# Tutorial & Onboarding Overhaul

## Goal
Make it obvious to every user — new or returning — what each page does and how to operate the MT5 EAs correctly (one terminal for many accounts, attach to a non-traded chart, coexist with other EAs like position sizers, prop-firm safety, etc.). Today the only docs live inside `QuickConnectDialog` and `MT5SetupDialog` and they don't cover any of these multi-EA / multi-account scenarios.

## Audit — what's missing per page

| Page | Current help | Gap |
|---|---|---|
| `Accounts` | `QuickConnectDialog`, `MT5SetupDialog` | No mention of: 1 terminal → many accounts via multiple MT5 installs, attaching EA to a "scratch" chart, coexistence with other EAs, UTC offset detection, Algo Trading toggle nuances, what to do per prop-firm. No "what is this page" intro for first-time users. |
| `Copier` | Has a "Getting started" panel with steps | Doesn't explain: shared-terminal vs separate-terminal masters/receivers, why receivers should be on a dedicated chart, symbol-mapping basics, prop-firm lockouts, how risk lot sizing works. No callout when one half (master or receiver) is missing. |
| `Dashboard` | None | No intro tour of widgets (Equity curve, KPIs, drawdown). First-time empty state is silent. |
| `Journal` | None | No hint about hypothetical trades, screenshot upload, stale-trade dismiss, monthly default filter. |
| `LiveTrades` | None | No explanation of "Start live trade" dialog, how it ties to EA events, prop-firm safety, why some trades show "Awaiting repair". |
| `Reports` | None | No hint about delta units ($/R/%), report sharing flow. |
| `Playbooks` | None | No intro: what a playbook is, how rule-compliance works, screenshot gallery. |
| `Import` | Some inline copy | Missing: difference vs live EA, deal vs order import, prop-firm history limits. |
| `Knowledge` | Empty-state line | Fine as is; minor polish only. |
| `SharedReports` | None | Quick "what's a shared report" line + privacy note. |

## Solution — three coordinated pieces

### 1. New reusable primitives (`src/components/tutorial/`)
- **`PageIntroBanner`** — dismissible top banner per route. Stores dismissal in `localStorage` under `tutorial.intro.<routeKey>`. Props: `title`, `body`, `learnMoreHref`, `routeKey`.
- **`HintPopover`** — small `(?)` icon next to any control; uses existing `Popover` from shadcn. Props: `title`, `body`, optional `link`. No persistence needed.
- **`TutorialDialog`** — full setup walkthrough modal (reuses `Dialog` + `Tabs`). Used by the new "How it works" buttons on each page header.
- **`useFirstVisit(routeKey)`** — hook that auto-opens the `TutorialDialog` once per user per route (localStorage flag).

All built with existing shadcn primitives + semantic tokens — no new deps.

### 2. New `EASetupGuide` content module (`src/components/tutorial/EASetupGuide.tsx`)
A single shared component rendered inside `TutorialDialog` (Accounts + Copier + LiveTrades). Tabs:
- **Install** — current install steps (lifted from `MT5SetupDialog`).
- **One terminal, many accounts** — explains the `%APPDATA%\MetaQuotes\Terminal\<HASH>` portable-install trick: copy MT5 install folder, log into a different account, attach a fresh EA instance with that account's API key. Diagram + numbered steps.
- **Dedicated EA chart** — best practice: open a low-volume symbol you never trade (e.g. `EURUSD M1`), attach the EA there, never close that chart. Prevents accidental detach when you swap chart timeframes for analysis.
- **Coexist with other EAs** — `Allow Algo Trading` is global; position sizers, news filters, copiers all share it. Use a unique chart per EA, ensure magic numbers don't collide (EA reads all deals so it's safe), and keep the journal-bridge chart minimized.
- **Prop-firm notes** — receivers SL/TP locked, throttling, no pending orders, what gets logged.
- **Troubleshooting** — WebRequest URL list, compile errors, "EA shows smiley but no events", time-zone offset auto-detect.

### 3. Page-by-page wiring

- **Accounts** — `PageIntroBanner` ("Connect MT5 terminals — one EA per chart, multiple accounts supported"). Header gets `?` button → `EASetupGuide`. Auto-open once on first visit. `HintPopover` next to the "Add account" button explaining the setup-token flow.
- **Copier** — replace ad-hoc help with `EASetupGuide` opened to "Copier" tab (new section: master vs receiver chart placement, symbol mapping basics, risk model). `HintPopover` on each receiver card describing the lock-icons (SL/TP locked, throttling).
- **Dashboard** — `PageIntroBanner` describing widgets; `HintPopover` on Equity Curve explaining $ delta + % of starting balance (post-recent fix).
- **Journal** — `PageIntroBanner` + hints on: hypothetical-trade toggle, screenshot uploader (max 5, labels), monthly filter default, "Dismiss as closed" for stuck trades.
- **LiveTrades** — `PageIntroBanner` + hints on: "Awaiting repair" badge, `phase_a_one_shot` resolution, manual `Start live trade`.
- **Reports** — `PageIntroBanner` + hint on delta unit cells.
- **Playbooks** — `PageIntroBanner` ("What is a playbook?") + hint on rule-compliance alerts.
- **Import** — clarifying hints on history depth and deal-vs-order mode.
- **SharedReports / Editor** — small intro banner.

All banners use `routeKey` so dismissals are independent. A single `Settings → Reset tutorials` action (in user menu) clears all `tutorial.*` localStorage keys.

## Technical Details

- **Files added** (~10):
  - `src/components/tutorial/PageIntroBanner.tsx`
  - `src/components/tutorial/HintPopover.tsx`
  - `src/components/tutorial/TutorialDialog.tsx`
  - `src/components/tutorial/EASetupGuide.tsx`
  - `src/components/tutorial/guides/{InstallTab,MultiAccountTab,DedicatedChartTab,CoexistTab,PropFirmTab,TroubleshootingTab}.tsx`
  - `src/hooks/useFirstVisit.ts`
  - `src/lib/tutorialStorage.ts` (localStorage helpers + reset-all)
- **Files edited** (~10 pages): inject banner + header `?` button only. No business-logic touch.
- **Content**: existing copy in `MT5SetupDialog` and `QuickConnectDialog` is refactored into the shared `EASetupGuide` tabs so we have one source of truth. Both dialogs continue to work but link out to the guide for advanced topics.
- **No backend changes.** No new migrations. No new env vars. Lovable Cloud untouched.
- **A11y**: banners are `role="status"`, popovers are keyboard-reachable via the trigger button (shadcn handles focus).
- **Theming**: all colors via semantic tokens (`bg-muted`, `text-muted-foreground`, `border-border`). No hex.

## Out of scope
- No interactive product-tour library (e.g. Driver.js / Shepherd). Hints are static, dismissible, lightweight.
- No translation system; English copy only (matches current app).
- No analytics on dismissal — can be added later if you want adoption metrics.

## Open question
Two reasonable scope choices — happy to go either way:
- **A. Full rollout (recommended)** — all pages get banners + the shared `EASetupGuide`. ~1 medium turn of edits.
- **B. Phase 1 only** — ship `EASetupGuide` + banners on `Accounts` and `Copier` first (where the EA pain lives), then layer the rest. Smaller diff.

Reply "go A" or "go B" (or tweak the audit) and I'll implement.
