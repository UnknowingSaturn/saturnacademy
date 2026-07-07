// ============================================================================
// Pair Lab — top-level shell.
//
// Owns URL-bound state (profile, prop-firm, unrealized, scope, selection,
// active tab, walk-forward lens) and the single `usePairLab` data call.
// Everything else lives in the tab components under ./components/pair-lab/tabs.
//
// Tab IA (Phase 3 redesign):
//   Overview     — controls + baseline + warnings (writes to context)
//   Pair Grid    — BucketGrid + per-cell QuantNote drill-down
//   Ideal Windows— pair × hour × half heatmap
//   Strategy     — Ranker + Risk×Rotation Lab + Out-of-Sample (one sample)
//   Setup        — Simulator profile / Groups / Aliases
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, FlaskConical } from "lucide-react";
import { PageIntroBanner } from "@/components/tutorial/PageIntroBanner";
import { usePairLab } from "@/hooks/usePairLab";
import { usePairLabTradeBounds } from "@/hooks/usePairLabTradeBounds";
import { useSymbolGroups } from "@/hooks/useSymbolGroups";
import {
  useSimulatorProfile,
  useUpdatePairLabPrefs,
  type PairLabPrefs,
} from "@/hooks/useSimulatorProfile";
import {
  resolveWindow,
  type WalkForwardState,
} from "@/components/pair-lab/WalkForwardControls";
import { PairLabWalkForwardProvider } from "@/contexts/PairLabWalkForwardContext";
import { OverviewTab } from "@/components/pair-lab/tabs/OverviewTab";
import { PairGridTab, type Selected } from "@/components/pair-lab/tabs/PairGridTab";
import { IdealWindowsTab } from "@/components/pair-lab/tabs/IdealWindowsTab";
import { StrategyTab } from "@/components/pair-lab/tabs/StrategyTab";
import { SetupTab } from "@/components/pair-lab/tabs/SetupTab";

const VALID_TABS = new Set([
  "overview",
  "grid",
  "windows",
  "strategy",
  "setup",
]);
// U3 fix: hoisted to module scope. Previously declared inside the component
// body it (a) allocated a new Set on every render, and (b) was captured by
// `setSetupTab`'s useCallback without appearing in its deps → latent
// stale-closure. Content never changes.
const VALID_SETUP_TABS = new Set(["simulator", "groups", "aliases"]);

export default function PairLab() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Snapshot which URL keys were present on the very first render so hydration
  // from persisted prefs never overwrites a value the user actually typed into
  // the URL (shared link, deep link from Coach/Journal). Any key not in this
  // set is fair game for hydration once the prefs query resolves.
  const initialUrlKeys = useRef<Set<string>>(
    new Set(Array.from(searchParams.keys())),
  );
  const hydratedRef = useRef(false);

  const profileQuery = useSimulatorProfile();
  const savePrefs = useUpdatePairLabPrefs();
  const profile = searchParams.get("profile") ?? "any";
  const propFirmMode = searchParams.get("pf") !== "0";
  const includeUnrealized = searchParams.get("unreal") === "1";
  // G8 parity: Journal shows orphan (account_id IS NULL) trades by default;
  // Pair Lab now matches. Explicit `orphans=0` opts out.
  const includeUnassigned = searchParams.get("orphans") !== "0";
  const scope = searchParams.get("scope") ?? "all";
  const tabParam = searchParams.get("tab") ?? "overview";
  const tab = VALID_TABS.has(tabParam) ? tabParam : "overview";
  // Audit U-B5: Setup sub-tab persists in the URL as ?setupTab=…
  const setupTabParam = searchParams.get("setupTab") ?? "simulator";
  const setupTab = VALID_SETUP_TABS.has(setupTabParam) ? setupTabParam : "simulator";
  const selected: Selected = (() => {
    const symbol = searchParams.get("symbol");
    const session = searchParams.get("session");
    if (!symbol || !session) return null;
    return { symbol, session };
  })();

  // S1.7 fix: memoize all URL-state mutators so child effects that depend on
  // them (e.g. PairGridTab's Escape-to-deselect listener) don't tear down and
  // re-subscribe on every parent re-render — slider drags previously dropped
  // keystrokes in the gap between detach and re-attach.
  // Audit §3.1: use `setSearchParams(prev => …)` functional form so two
  // writes in the same tick both see the latest URL state instead of racing
  // on a stale `searchParams` snapshot.
  const patchParams = useCallback(
    (mut: (next: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mut(next);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setProfile = useCallback(
    (v: string) => {
      patchParams((p) => (v === "any" ? p.delete("profile") : p.set("profile", v)));
      savePrefs({ profile: v });
    },
    [patchParams, savePrefs],
  );
  const setPropFirmMode = useCallback(
    (v: boolean) => {
      patchParams((p) => (v ? p.delete("pf") : p.set("pf", "0")));
      savePrefs({ propFirmMode: v });
    },
    [patchParams, savePrefs],
  );
  const setIncludeUnrealized = useCallback(
    (v: boolean) => {
      patchParams((p) => (v ? p.set("unreal", "1") : p.delete("unreal")));
      savePrefs({ includeUnrealized: v });
    },
    [patchParams, savePrefs],
  );
  const setIncludeUnassigned = useCallback(
    (v: boolean) => {
      patchParams((p) => (v ? p.delete("orphans") : p.set("orphans", "0")));
      savePrefs({ includeUnassigned: v });
    },
    [patchParams, savePrefs],
  );
  const setScope = useCallback(
    (v: string) => {
      patchParams((p) => {
        if (v === "all") p.delete("scope");
        else p.set("scope", v);
        p.delete("symbol");
        p.delete("session");
      });
      savePrefs({ scope: v });
    },
    [patchParams, savePrefs],
  );
  const setTab = useCallback(
    (v: string) => {
      patchParams((p) => (v === "overview" ? p.delete("tab") : p.set("tab", v)));
      if (VALID_TABS.has(v)) savePrefs({ tab: v as PairLabPrefs["tab"] });
    },
    [patchParams, savePrefs],
  );
  const setSelected = useCallback(
    (cell: Selected) =>
      patchParams((p) => {
        if (!cell) {
          p.delete("symbol");
          p.delete("session");
        } else {
          p.set("symbol", cell.symbol);
          p.set("session", cell.session);
        }
      }),
    [patchParams],
  );
  const setSetupTab = useCallback(
    (v: string) => {
      patchParams((p) =>
        v === "simulator" || !VALID_SETUP_TABS.has(v)
          ? p.delete("setupTab")
          : p.set("setupTab", v),
      );
    },
    [patchParams],
  );

  // Resolve active scope group for data filtering.
  const { groups } = useSymbolGroups();
  const activeGroup = useMemo(() => {
    if (!scope.startsWith("grp:")) return null;
    const id = scope.slice(4);
    return groups.find((g) => g.id === id) ?? null;
  }, [scope, groups]);

  // Single source of truth for the as-of slider bounds (no double fetch).
  // Audit §1.4: mirror `includeUnassigned` so slider bounds match the
  // analytics universe when the toggle is off.
  const { minMs, maxMs } = usePairLabTradeBounds({ includeUnassigned });

  // S2.15: persist lens + asOf in the URL so a refresh or a shared link
  // restores the same walk-forward viewport. `lens=all` (default) and an
  // empty / absent `asOf` are both elided to keep the URL tidy.
  const lensParam = searchParams.get("lens");
  const asOfParam = searchParams.get("asOf");
  const initialLens: WalkForwardState["lens"] =
    lensParam === "90d" || lensParam === "30d" ? lensParam : "all";
  const initialAsOfMs = (() => {
    if (!asOfParam) return Date.now();
    const parsed = Date.parse(asOfParam);
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const [wf, setWfRaw] = useState<WalkForwardState>({
    lens: initialLens,
    asOfMs: initialAsOfMs,
  });
  // Wrap setter so every change writes back to URL. Only persist asOf when
  // the user has actually pinned it (not equal to maxMs / "now"), to avoid
  // an ever-shifting URL on every render.
  const setWf = useCallback(
    (next: WalkForwardState) => {
      setWfRaw(next);
      patchParams((p) => {
        if (next.lens === "all") p.delete("lens");
        else p.set("lens", next.lens);
        // Persist asOf only when the user has moved it off the right edge.
        const atLatest = Math.abs(next.asOfMs - maxMs) < 24 * 3600_000;
        if (atLatest) p.delete("asOf");
        else p.set("asOf", new Date(next.asOfMs).toISOString().slice(0, 10));
      });
      savePrefs({ lens: next.lens });
    },
    [patchParams, maxMs, savePrefs],
  );
  useEffect(() => {
    setWfRaw((s) => ({
      ...s,
      asOfMs: Math.max(minMs, Math.min(maxMs, s.asOfMs)),
    }));
  }, [minMs, maxMs]);

  // Hydrate filter state from the persisted per-user prefs, but ONLY for
  // params the URL didn't already carry at first mount. This way:
  //   - A fresh navigation to `/pair-lab` restores the last-used setup.
  //   - A shared / deep link like `?pf=0&lens=90d` always wins.
  // Runs once, after the profile query resolves.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (profileQuery.isLoading) return;
    const prefs = profileQuery.data?.pair_lab_prefs;
    hydratedRef.current = true;
    if (!prefs || Object.keys(prefs).length === 0) return;
    const present = initialUrlKeys.current;
    patchParams((p) => {
      if (prefs.profile != null && !present.has("profile") && prefs.profile !== "any") {
        p.set("profile", prefs.profile);
      }
      if (prefs.propFirmMode === false && !present.has("pf")) {
        p.set("pf", "0");
      }
      if (prefs.includeUnrealized === true && !present.has("unreal")) {
        p.set("unreal", "1");
      }
      if (prefs.includeUnassigned === false && !present.has("orphans")) {
        p.set("orphans", "0");
      }
      if (prefs.scope && prefs.scope !== "all" && !present.has("scope")) {
        p.set("scope", prefs.scope);
      }
      if (prefs.tab && prefs.tab !== "overview" && !present.has("tab") && VALID_TABS.has(prefs.tab)) {
        p.set("tab", prefs.tab);
      }
      if ((prefs.lens === "90d" || prefs.lens === "30d") && !present.has("lens")) {
        p.set("lens", prefs.lens);
      }
    });
    if ((prefs.lens === "90d" || prefs.lens === "30d") && !present.has("lens")) {
      setWfRaw((s) => ({ ...s, lens: prefs.lens as WalkForwardState["lens"] }));
    }
  }, [profileQuery.isLoading, profileQuery.data, patchParams]);

  const { dateFrom, dateTo } = useMemo(() => resolveWindow(wf), [wf]);

  const data = usePairLab({
    profile: profile === "any" ? null : profile,
    propFirmMode,
    dateFrom,
    dateTo,
    includeUnrealized,
    includeUnassigned,
    groupOverride: activeGroup
      ? { name: activeGroup.name, symbols: activeGroup.symbols }
      : null,
  });

  // P-UI: Only show the full-page spinner on the FIRST load. Subsequent refetches
  // (filter / lens / as-of changes) now keep the provider + tabs mounted so
  // local tab state (selected cell, drill-down scroll, etc.) is preserved.
  if (data.isLoading && data.totalTrades === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      <PageIntroBanner
        routeKey="pair-lab"
        title="Pair Lab — find optimal parameters per pair × session"
        body="Buckets your closed trades by canonical symbol and session, then derives suggested stop, TP ladder (incl. a win-rate-maximizing TP1*), and risk size from your MFE / MAE / TP-hit / ideal-SL fields. Toggle Prop-firm mode to cap risk against your simulator profile's daily drawdown budget."
      />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <FlaskConical className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            Pair Lab
            {data.isLoading && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="refreshing" />
            )}
          </h1>
          <p className="text-xs text-muted-foreground">
            {data.totalTrades} closed trades in scope · {data.perCell.length}{" "}
            cells · {data.perRow.length} canonical pairs
          </p>
        </div>
      </div>

      <PairLabWalkForwardProvider
        value={{
          wf,
          setWf,
          minMs,
          maxMs,
          profile: profile === "any" ? null : profile,
          scope,
          includeUnrealized,
          propFirmMode,
          groups,
        }}
      >
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="grid">Pair Grid</TabsTrigger>
            <TabsTrigger value="windows">Ideal Windows</TabsTrigger>
            <TabsTrigger value="strategy">Strategy</TabsTrigger>
            <TabsTrigger value="setup">Setup</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab
              data={data}
              profile={profile}
              setProfile={setProfile}
              propFirmMode={propFirmMode}
              setPropFirmMode={setPropFirmMode}
              includeUnrealized={includeUnrealized}
              setIncludeUnrealized={setIncludeUnrealized}
              includeUnassigned={includeUnassigned}
              setIncludeUnassigned={setIncludeUnassigned}
              scope={scope}
              setScope={setScope}
              groups={groups}
              activeGroup={activeGroup}
            />
          </TabsContent>

          <TabsContent value="grid" className="mt-4">
            <PairGridTab
              data={data}
              propFirmMode={propFirmMode}
              selected={selected}
              setSelected={setSelected}
            />
          </TabsContent>

          <TabsContent value="windows" className="mt-4">
            <IdealWindowsTab data={data} />
          </TabsContent>

          <TabsContent value="strategy" className="mt-4">
            <StrategyTab
              data={data}
              propFirmMode={propFirmMode}
              selected={selected}
              includeUnrealized={includeUnrealized}
            />
          </TabsContent>

          <TabsContent value="setup" className="mt-4">
            <SetupTab data={data} setupTab={setupTab} setSetupTab={setSetupTab} />
          </TabsContent>
        </Tabs>
      </PairLabWalkForwardProvider>
    </div>
  );
}
