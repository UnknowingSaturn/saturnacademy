// ============================================================================
// Strategy tab — single 3-section page consuming the shared walk-forward
// context. Section 1 (Ranker) replays presets, section 2 (Lab) sweeps risk ×
// rotation, section 3 (Out-of-sample) splits chronologically.
//
// All three read the same `data.trades` slice (already filtered by profile,
// scope, lens, includeUnrealized in usePairLab), so there is exactly one
// results sample driving the page.
// ============================================================================

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Sparkles, GitBranch } from "lucide-react";
import { StrategyRanker } from "@/components/pair-lab/StrategyRanker";
import { StrategyLab } from "@/components/pair-lab/StrategyLab";
import { OutOfSamplePanel } from "@/components/pair-lab/OutOfSamplePanel";
import { normalizeSession } from "@/lib/pairLabMath";
import { usePairLabWalkForward } from "@/contexts/PairLabWalkForwardContext";
import type { usePairLab } from "@/hooks/usePairLab";
import type { Selected } from "./PairGridTab";

type PairLabData = ReturnType<typeof usePairLab>;

interface Props {
  data: PairLabData;
  propFirmMode: boolean;
  selected: Selected;
}

function SectionHeader({
  icon,
  title,
  blurb,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  badge?: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-3">
      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold">{title}</h2>
          {badge && (
            <Badge variant="outline" className="text-[10px]">
              {badge}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{blurb}</p>
      </div>
    </div>
  );
}

export function StrategyTab({ data, propFirmMode, selected }: Props) {
  const { dateFrom, dateTo } = usePairLabWalkForward();

  // When the user has a cell selected in Pair Grid, narrow the strategy
  // sample to that pair·session. Otherwise use the full in-scope window.
  const scopedTrades = useMemo(() => {
    if (!selected) return data.trades;
    return data.trades.filter((t) => {
      if (!t.symbol) return false;
      const canonical = data.symbolResolver(t.symbol);
      if (canonical !== selected.symbol) return false;
      if (selected.session !== "All sessions") {
        return normalizeSession(t.session) === selected.session;
      }
      return true;
    });
  }, [selected, data.trades, data.symbolResolver]);

  const scopeLabel = selected
    ? `${selected.symbol} · ${selected.session}`
    : "All trades in scope";

  if (data.simBalance <= 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground text-center">
        Set a notional balance in your simulator profile (Setup tab) to convert
        R into $ for the strategy sections.
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-xs text-muted-foreground">
        Sample: <span className="font-medium text-foreground">{scopeLabel}</span>{" "}
        · {scopedTrades.length} trades · window driven by Overview filters.
      </div>

      {/* Section 1 — Ranker */}
      <section>
        <SectionHeader
          icon={<Trophy className="w-4 h-4 text-primary" />}
          title="Strategy Ranker"
          blurb="Replays every preset over the sample. Only validated rows compete for the crown."
        />
        <StrategyRanker
          trades={scopedTrades}
          fieldKeys={data.fieldKeys}
          balance={data.simBalance}
          propFirm={propFirmMode ? data.propFirm : null}
          scopeLabel={scopeLabel}
          defaultRiskPct={data.defaultSimRiskPct}
          trailCapture={data.trailCapture}
          effectiveTrailCapture={data.effectiveTrailCapture}
        />
      </section>

      {/* Section 2 — Lab */}
      <section>
        <SectionHeader
          icon={<Sparkles className="w-4 h-4 text-primary" />}
          title="Risk × Rotation Lab"
          blurb="Joint Monte-Carlo sweep over risk % and rotation models. Surfaces interaction effects single-axis sweeps miss."
        />
        <StrategyLab
          trades={scopedTrades}
          defaultAccountSize={data.simBalance > 0 ? data.simBalance : 100_000}
          dailyLossDollars={
            propFirmMode ? (data.propFirm?.dailyLossDollars ?? null) : null
          }
          maxDrawdownDollars={
            propFirmMode ? (data.propFirm?.maxDrawdownDollars ?? null) : null
          }
          hasPropFirmProfile={
            propFirmMode &&
            data.propFirm != null &&
            data.propFirm.dailyLossDollars != null
          }
        />
      </section>

      {/* Section 3 — Out-of-sample */}
      {data.totalTrades >= 30 && (
        <section>
          <SectionHeader
            icon={<GitBranch className="w-4 h-4 text-primary" />}
            title="Out-of-Sample"
            blurb="Chronological train/test split within the active window. Flags cells profitable in train but negative in test."
          />
          <OutOfSamplePanel
            trades={data.trades}
            fieldKeys={data.fieldKeys}
            symbolResolver={data.symbolResolver}
            propFirm={propFirmMode ? data.propFirm : null}
            dateFrom={dateFrom}
            dateTo={dateTo}
          />
        </section>
      )}
    </div>
  );
}
