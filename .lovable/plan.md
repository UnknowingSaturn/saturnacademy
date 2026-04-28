## Goal

Rename every user-visible "Saturn Trade Copier", "Saturn", "Saturn Trading", and "TradeLog" reference to **Ephemeris** so the brand is consistent across the web app, the desktop copier, the MQL5 EAs and supporting docs.

## Scope at a glance

Three brand strings exist today:

- **TradeLog** — used in the web app (sidebar, auth pages, public report footer, OG meta).
- **Saturn / Saturn Trade Copier / Saturn Trading** — used in the desktop copier app and its docs.
- **Ephemeris** — already the page `<title>` in `index.html`. Will become the single brand.

## Web app changes (user-visible)

1. **`index.html`** — change `<meta name="author">` and `<meta name="twitter:site">` from `TradeLog` to `Ephemeris` (title is already correct).
2. **`src/components/layout/AppSidebar.tsx`** — sidebar wordmark "TradeLog" → "Ephemeris".
3. **`src/pages/Auth.tsx`** — both `<h1>` headings (sign-in and sign-up cards) → "Ephemeris".
4. **`src/pages/ResetPassword.tsx`** — `<h1>` → "Ephemeris".
5. **`src/pages/PublicReport.tsx`** — header wordmark and footer "Built with TradeLog" → "Ephemeris".
6. **`src/components/copier-preview/PreviewSidebar.tsx`** — "Saturn" → "Ephemeris".
7. **`src/components/copier-preview/PreviewSettings.tsx`** — copy mentioning "Saturn web dashboard", "Saturn Trade Copier v2.0.0", "© 2024 Saturn Trading" → "Ephemeris" equivalents (e.g. "Ephemeris Trade Copier", "© 2026 Ephemeris").

Localstorage key in `AccountFilterContext.tsx` (`tradelog-selected-account`) stays as-is — renaming it would log every existing user out of their saved account filter for no visible benefit. Noted as an internal identifier only.

## Desktop copier (Tauri) changes

User-visible strings:

7. **`copier-desktop/index.html`** — `<title>` → "Ephemeris Trade Copier".
8. **`copier-desktop/src/App.tsx`** — header label "Saturn Trade Copier" → "Ephemeris Trade Copier".
9. **`copier-desktop/src/components/Sidebar.tsx`** — "Saturn" → "Ephemeris".
10. **`copier-desktop/src/components/Settings.tsx`** — Settings copy referring to "Saturn web dashboard", "Saturn Trade Copier v{appVersion}", "© 2024 Saturn Trading" → Ephemeris equivalents (year bumped to 2026).
11. **`copier-desktop/src/components/wizard/ConfirmationStep.tsx`** — "Saturn web app" → "Ephemeris web app".
12. **`copier-desktop/src-tauri/tauri.conf.json`** — `productName`, window `title` → "Ephemeris Trade Copier". `bundle.identifier` stays `com.saturn.tradecopier` (changing it would break auto-updates and existing installs — see Technical notes).

Documentation:

13. **`copier-desktop/INSTALLATION.md`**, **`copier-desktop/README.md`**, **`copier-desktop/RELEASE.md`** — replace prose mentions of "Saturn Trade Copier" / "Saturn journal" / "Saturn web app" with Ephemeris. GitHub repo URLs and the signing-key filename stay untouched (they are real external references, not brand prose).

## Edge function

14. **`supabase/functions/copier-update-check/index.ts`** — `User-Agent` header → `Ephemeris-Trade-Copier-Updater`. `GITHUB_OWNER` / `GITHUB_REPO` stay as the real repo names that host the released binaries.

## Things intentionally left unchanged (technical identifiers)

To avoid breaking installed users, releases or persisted state, these stay as-is:

- `package.json` `name: "saturn-trade-copier"` (npm package id, not user-visible).
- `Cargo.toml` `name = "saturn-trade-copier"` and crate-internal references.
- Tauri `bundle.identifier` `com.saturn.tradecopier` — changing it would orphan existing Windows installations and break the signed auto-updater channel.
- `APP_DATA_FOLDER = "SaturnTradeCopier"`, `saturn_copier_config.json`, `ProjectDirs::from("com", "saturn", …)`, log filename `saturn-copier.log` — renaming these would lose every existing user's local config, queue state and logs.
- `STORAGE_KEY = "tradelog-selected-account"` in the web app — renaming would silently reset every user's saved account filter.
- `supabase/functions/copier-update-check`: `GITHUB_OWNER`/`GITHUB_REPO` remain pointed at the actual release repo.

If you want the desktop app's bundle identifier and on-disk paths migrated too (with a one-time migration that copies old config into the new location on first launch), say so and I will add that as a follow-up step — it is a meaningfully larger change and risks data loss if rushed.

## Verification after implementation

- `rg -i 'saturn|tradelog'` in the repo should return only the intentionally-preserved technical identifiers listed above.
- Manual visual check: web sidebar, Auth page, Reset password, Public report header/footer; desktop app titlebar, sidebar, Settings page, Wizard confirmation step.
