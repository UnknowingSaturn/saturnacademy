## Pass D Verification & Sidebar Color Fix

### Findings

**1. Sidebar regression — confirmed cause**
Playwright probe of the live preview shows every sidebar link's `className` attribute literally contains the stringified function:

```
... h-8 text-sm ({ isActive })=>cn("flex items-center gap-3 ... text-sidebar-foreground ...", isActive && "bg-sidebar-accent text-sidebar-primary font-medium")
```

`SidebarMenuButton asChild` wraps the child in Radix `Slot`. `Slot` merges `className` by string-concatenation; it cannot evaluate the function-as-className API React Router exposes. The function gets coerced to a string and dumped into the `class` attribute, so:
- Our `text-sidebar-foreground` baseline is never applied.
- The anchor falls back to Chromium's dark-mode default `<a>` color `rgb(51,129,255)` (≈ primary blue).
- `isActive` styling never fires either, so the active item also looks identical.

**2. Suggested MAE / MFE math — already correct**
Ripgrep across `src/lib/pairLabMath.ts`, `src/lib/pairLabSimulator.ts`, and `supabase/functions/_shared/quant/pairLabMath.ts` shows MAE/MFE are **never** averaged:
- Bucket stats: `median()`, `quantile(_, 0.5/0.6/0.75)`.
- SL recommendation: `quantile(winnersMaePips, 0.90) * 1.10`.
- TP recommendation: `argmax E[R]` over an MFE grid, not mean MFE.
- Only one `mean`-shaped term exists — the conditional `r_actual` mean when `MFE < TP target` (legitimate miss-cost estimator, not a distribution collapse).

No code change required; we'll add a one-shot diagnostic that prints the bucket-level p50/p75/p90 alongside a recomputation directly from `trade_partial_fills` so you have evidence the simulator output matches the underlying ticks.

**3. Pass D cleanups — verified intact**
`withForwardRef`, `NavLink.tsx` wrapper, and the dead `symbolMapping` exports are gone. `useTradeCompliance` resolves `normalizeSymbol` from `symbolAliasing`. Tooltip still mounts (Radix Provider/Root re-exported directly).

---

### Plan

**Fix 1 — Sidebar colors (`src/components/layout/AppSidebar.tsx`)**

Replace the function-className pattern with the existing `SidebarMenuButton.isActive` data-attribute that `sidebarMenuButtonVariants` already understands:

```text
import { NavLink, useLocation } from "react-router-dom";

const { pathname } = useLocation();
...
<SidebarMenuButton asChild tooltip={item.title} isActive={pathname === item.url || pathname.startsWith(item.url + "/")}>
  <NavLink to={item.url} className="flex items-center gap-3">
    <item.icon className="w-5 h-5 shrink-0" />
    {!collapsed && <span className="flex-1">{item.title}</span>}
    {item.url === '/live-trades' && openTradesCount > 0 && (
      <Badge variant="secondary" className="ml-auto h-5 min-w-5 px-1.5 text-xs">{openTradesCount}</Badge>
    )}
  </NavLink>
</SidebarMenuButton>
```

This delegates inactive (`text-sidebar-foreground` via variant base) and active (`data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground`) styling to the component variants — which is what every other shadcn sidebar consumer does. No more function-className passing through Slot.

Apply the same treatment to both `mainItems` and `toolItems` loops.

**Fix 2 — MAE/MFE verification script (read-only)**

Add a throwaway `scripts/verify_pair_lab_math.ts` (not bundled) that:
- Loads the closed trades for the current user via psql.
- For each bucket (symbol × session) computes MAE p50/p75/p90 in pips and MFE p50/p75 in R directly from `trade_partial_fills` + `cf_mae`/`cf_ideal_stop_loss`.
- Calls `buildBucket()` from `src/lib/pairLabMath.ts` on the same input.
- Asserts both sides agree to within float epsilon and prints a one-line PASS/FAIL per bucket.

Run it once, attach the output, then delete the script. Purpose is to prove (not promise) the simulator and the raw data agree.

**Out of scope**
- No changes to the simulator math itself — the audit found nothing averaged.
- Remaining Pass D items (D3 selector extraction, D4 TradeTable split, D10 edge-function CORS migration, D11 type regen) and the Q1 PnL historical reconciliation decision still stand and will be addressed when you choose to bundle them.
