import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FlaskConical, Info } from "lucide-react";
import { PageIntroBanner } from "@/components/tutorial/PageIntroBanner";
import { usePairLab } from "@/hooks/usePairLab";
import { BucketGrid } from "@/components/pair-lab/BucketGrid";
import { RecommendationCard } from "@/components/pair-lab/RecommendationCard";

export default function PairLab() {
  const [profile, setProfile] = useState<string>("any");
  const [actualProfile, setActualProfile] = useState<string>("any");
  const [selected, setSelected] = useState<{ symbol: string; session: string } | null>(null);

  const data = usePairLab({
    profile: profile === "any" ? null : profile,
    actualProfile: actualProfile === "any" ? null : actualProfile,
  });

  const selectedBucket = useMemo(() => {
    if (!selected) return null;
    if (selected.session === "All sessions") {
      return data.perRow.find((r) => r.key.symbol === selected.symbol) ?? null;
    }
    return (
      data.perCell.find(
        (c) => c.key.symbol === selected.symbol && c.key.session === selected.session,
      ) ?? null
    );
  }, [selected, data.perRow, data.perCell]);

  if (data.isLoading) {
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
        body="Buckets your closed trades by symbol and session, then derives suggested stop, take-profit ladder, and risk size from the actual MFE / MAE / ideal-SL / TP-hit fields you record in the journal. Robust statistics (medians and quartiles) so it works at low sample sizes — but always check the sample badge."
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Pair Lab</h1>
            <p className="text-xs text-muted-foreground">
              {data.totalTrades} closed trades in scope · {data.perCell.length} cells · {data.perRow.length} pairs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={profile} onValueChange={setProfile}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Planned profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any planned profile</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="continuation">Continuation</SelectItem>
              <SelectItem value="range">Range</SelectItem>
              <SelectItem value="reversal">Reversal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={actualProfile} onValueChange={setActualProfile}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Actual profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any actual profile</SelectItem>
              <SelectItem value="continuation">Continuation</SelectItem>
              <SelectItem value="range">Range</SelectItem>
              <SelectItem value="reversal">Reversal</SelectItem>
              <SelectItem value="hindsight">Hindsight</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {data.missingFields && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
          <Info className="w-4 h-4 text-amber-500 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium mb-1">No excursion fields detected.</div>
            <div className="text-muted-foreground">
              Add custom fields named <span className="font-mono text-foreground">MFE (RR)</span>,{" "}
              <span className="font-mono text-foreground">MAE</span>,{" "}
              <span className="font-mono text-foreground">TP Reached</span>, and{" "}
              <span className="font-mono text-foreground">Ideal Stop-Loss</span> from
              the Journal settings, then fill them in on your closed trades to power this page.
            </div>
          </div>
        </Card>
      )}

      {/* Baseline summary */}
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Baseline</span>
          <span><span className="text-muted-foreground">N</span> <span className="font-mono-numbers font-semibold">{data.baseline.n}</span></span>
          <span><span className="text-muted-foreground">Win rate</span> <span className="font-mono-numbers font-semibold">{(data.baseline.winRate * 100).toFixed(1)}%</span></span>
          <span><span className="text-muted-foreground">Expected R</span> <span className="font-mono-numbers font-semibold">{(data.baseline.expectedR >= 0 ? "+" : "") + data.baseline.expectedR.toFixed(2)}R</span></span>
          <span><span className="text-muted-foreground">MFE p75</span> <span className="font-mono-numbers font-semibold">{data.baseline.mfeP75?.toFixed(2) ?? "—"}R</span></span>
          <span><span className="text-muted-foreground">MAE p75</span> <span className="font-mono-numbers font-semibold">{data.baseline.maeP75?.toFixed(1) ?? "—"}</span></span>
          {data.baseline.recommendation.suggestedRiskPct != null && (
            <Badge variant="outline">Baseline ¼-Kelly: {data.baseline.recommendation.suggestedRiskPct.toFixed(2)}%</Badge>
          )}
        </div>
      </Card>

      {/* Grid */}
      <BucketGrid
        symbols={data.symbols}
        sessions={data.sessions}
        perCell={data.perCell}
        perRow={data.perRow}
        selected={selected}
        onSelect={setSelected}
      />

      {/* Recommendation */}
      {selectedBucket ? (
        <RecommendationCard bucket={selectedBucket} baseline={data.baseline} />
      ) : (
        <Card className="p-6 text-sm text-muted-foreground text-center">
          Select a cell in the grid to see the recommended SL, TP ladder, and risk sizing for that bucket.
        </Card>
      )}
    </div>
  );
}
