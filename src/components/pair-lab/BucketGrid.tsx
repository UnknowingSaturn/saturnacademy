import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { bhSignificant, type BucketReport } from "@/lib/pairLabMath";

interface Props {
  symbols: string[];
  sessions: string[];
  perCell: BucketReport[];
  perRow: BucketReport[];
  selected: { symbol: string; session: string } | null;
  onSelect: (cell: { symbol: string; session: string } | null) => void;
}

function confidenceDot(level: BucketReport["confidence"]) {
  return level === "high" ? "🟢" : level === "medium" ? "🟡" : "🔴";
}

function coverageColor(logged: number, total: number) {
  if (total === 0) return "text-muted-foreground";
  const pct = logged / total;
  if (logged < 10 || pct < 0.3) return "text-destructive";
  if (pct < 0.7) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function CellInner({ b, fdr }: { b: BucketReport | null; fdr?: "sig" | "ns" | null }) {
  if (!b || b.n === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const winRatePct = (b.winRate * 100).toFixed(0);
  const expR = (b.expectedR >= 0 ? "+" : "") + b.expectedR.toFixed(2) + "R";
  const mfeCovColor = coverageColor(b.loggedMfeCount, b.n);
  const maeCovColor = coverageColor(b.loggedMaeCount, b.n);
  return (
    <div className="space-y-0.5 text-left">
      <div className="flex items-center gap-1 text-[11px]">
        <span>{confidenceDot(b.confidence)}</span>
        <span className="font-medium">N {b.n}</span>
        <span className="text-muted-foreground">· {winRatePct}%</span>
        {fdr === "sig" && (
          <span
            className="ml-auto text-[9px] px-1 rounded bg-emerald-500/15 text-emerald-500 font-semibold"
            title="FDR-significant (Benjamini–Hochberg, α=0.05) — expectancy > 0 survives multiple-testing correction across all displayed buckets."
          >
            FDR✓
          </span>
        )}
        {fdr === "ns" && (
          <span
            className="ml-auto text-[9px] px-1 rounded bg-muted text-muted-foreground"
            title="Not significant after Benjamini–Hochberg FDR correction across all displayed buckets — guard against cherry-picking."
          >
            ns
          </span>
        )}
      </div>
      <div className={cn("text-sm font-mono-numbers font-semibold", b.expectedR >= 0 ? "text-profit" : "text-loss")}>
        {expR}
      </div>
      <div className="text-[10px] text-muted-foreground font-mono-numbers">
        MFE {b.mfeP75 != null ? `${b.mfeP75.toFixed(2)}R` : "–"} · MAE {b.maeP75Ticks != null ? `${b.maeP75Ticks.toFixed(0)}t` : "–"}
      </div>
      {b.n >= 10 && b.recommendation.suggestedTpR != null && (
        <div
          className={cn(
            "text-[10px] font-mono-numbers",
            b.recommendation.recommendationConfidence === "validated"
              ? "text-profit"
              : b.recommendation.recommendationConfidence === "low"
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
          )}
          title={`Suggested TP ${b.recommendation.suggestedTpR.toFixed(2)}R · SL ${b.recommendation.suggestedSlPips?.toFixed(0) ?? "–"} pips · confidence ${b.recommendation.recommendationConfidence}`}
        >
          → TP {b.recommendation.suggestedTpR.toFixed(2)}R
        </div>
      )}
      <div
        className={cn("text-[10px] font-mono-numbers", mfeCovColor)}
        title={`${b.loggedMfeCount} of ${b.n} trades have an MFE value recorded. Preset simulations need ≥10 logged trades to be meaningful.`}
      >
        {b.loggedMfeCount}/{b.n} MFE
      </div>
      <div
        className={cn("text-[10px] font-mono-numbers", maeCovColor)}
        title={`${b.loggedMaeCount} of ${b.n} trades have an MAE value AND initial-SL + entry-price recorded (needed to convert ticks → R).`}
      >
        {b.loggedMaeCount}/{b.n} MAE
      </div>
    </div>
  );
}

export function BucketGrid({ symbols, sessions, perCell, perRow, selected, onSelect }: Props) {
  const cellLookup = new Map<string, BucketReport>();
  perCell.forEach((c) => cellLookup.set(`${c.key.symbol}__${c.key.session}`, c));
  const rowLookup = new Map<string, BucketReport>();
  perRow.forEach((r) => rowLookup.set(r.key.symbol, r));

  // BH FDR across per-cell buckets ONLY. Row totals aggregate the same trades
  // contained in their constituent cells (non-independent tests); mixing them
  // into the BH pool inflates `m` and over-corrects, hiding real edges.
  // Only buckets with n ≥ 10 and a positive expectancy enter the test —
  // others can't be significant by construction and would just inflate `m`.
  const fdrEligible = perCell
    .map((b, idx) => ({ b, idx }))
    .filter(({ b }) => b.n >= 10 && b.expectedR > 0 && b.expectancyPValue != null);
  const sig = bhSignificant(fdrEligible.map(({ b }) => b.expectancyPValue), 0.05);
  const fdrByKey = new Map<string, "sig" | "ns">();
  fdrEligible.forEach(({ b }, i) => {
    const k = `${b.key.symbol}__${b.key.session}`;
    fdrByKey.set(k, sig[i] ? "sig" : "ns");
  });
  const fdrFor = (b: BucketReport | null): "sig" | "ns" | null => {
    if (!b || b.n < 10 || !(b.expectedR > 0) || b.expectancyPValue == null) return null;
    return fdrByKey.get(`${b.key.symbol}__${b.key.session}`) ?? null;
  };

  if (symbols.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground text-sm">
        No closed trades match the current filters.
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-x-auto">
      <div className="flex items-center justify-end gap-3 px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/60 bg-muted/10">
        <span className="uppercase tracking-wider">MFE/MAE coverage</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> ≥70%</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> 30–69%</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" /> &lt;30% or &lt;10 trades</span>
      </div>
      <table className="w-full text-sm">

        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 sticky left-0 bg-muted/30 z-10">
              Pair
            </th>
            {sessions.map((s) => (
              <th key={s} className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 min-w-[120px]">
                {s}
              </th>
            ))}
            <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 min-w-[120px] border-l border-border">
              All sessions
            </th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((symbol) => {
            const row = rowLookup.get(symbol);
            const raws = row?.rawSymbols ?? [];
            const showRaws = raws.length > 1 || (raws.length === 1 && raws[0] !== symbol);
            return (
            <tr key={symbol} className="border-b border-border/50 hover:bg-muted/10">
              <td className="px-3 py-2 font-medium sticky left-0 bg-background z-10">
                <div>{symbol}</div>
                {showRaws && (
                  <div className="text-[10px] text-muted-foreground font-mono-numbers font-normal">
                    {raws.join(" · ")}
                  </div>
                )}
              </td>
              {sessions.map((session) => {
                const b = cellLookup.get(`${symbol}__${session}`) ?? null;
                const isSelected = selected?.symbol === symbol && selected?.session === session;
                return (
                  <td key={session} className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => onSelect(isSelected ? null : { symbol, session })}
                      disabled={!b || b.n === 0}
                      className={cn(
                        "w-full text-left rounded-md px-2 py-1.5 transition-colors",
                        isSelected
                          ? "bg-primary/20 ring-1 ring-primary"
                          : b && b.n > 0
                            ? "hover:bg-muted/40"
                            : "cursor-default",
                      )}
                    >
                      <CellInner b={b} fdr={fdrFor(b)} />
                    </button>
                  </td>
                );
              })}
              <td className="px-1 py-1 border-l border-border">
                <button
                  type="button"
                  onClick={() => {
                    const isSel = selected?.symbol === symbol && selected?.session === "All sessions";
                    onSelect(isSel ? null : { symbol, session: "All sessions" });
                  }}
                  className={cn(
                    "w-full text-left rounded-md px-2 py-1.5 transition-colors",
                    selected?.symbol === symbol && selected?.session === "All sessions"
                      ? "bg-primary/20 ring-1 ring-primary"
                      : "hover:bg-muted/40",
                  )}
                >
                  <CellInner b={rowLookup.get(symbol) ?? null} fdr={fdrFor(rowLookup.get(symbol) ?? null)} />
                </button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
