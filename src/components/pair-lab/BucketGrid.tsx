import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { BucketReport } from "@/lib/pairLabMath";

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

function CellInner({ b }: { b: BucketReport | null }) {
  if (!b || b.n === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const winRatePct = (b.winRate * 100).toFixed(0);
  const expR = (b.expectedR >= 0 ? "+" : "") + b.expectedR.toFixed(2) + "R";
  return (
    <div className="space-y-0.5 text-left">
      <div className="flex items-center gap-1 text-[11px]">
        <span>{confidenceDot(b.confidence)}</span>
        <span className="font-medium">N {b.n}</span>
        <span className="text-muted-foreground">· {winRatePct}%</span>
      </div>
      <div className={cn("text-sm font-mono-numbers font-semibold", b.expectedR >= 0 ? "text-profit" : "text-loss")}>
        {expR}
      </div>
      <div className="text-[10px] text-muted-foreground font-mono-numbers">
        MFE {b.mfeP75?.toFixed(1) ?? "–"} · MAE {b.maeP75?.toFixed(0) ?? "–"}
      </div>
    </div>
  );
}

export function BucketGrid({ symbols, sessions, perCell, perRow, selected, onSelect }: Props) {
  const cellLookup = new Map<string, BucketReport>();
  perCell.forEach((c) => cellLookup.set(`${c.key.symbol}__${c.key.session}`, c));
  const rowLookup = new Map<string, BucketReport>();
  perRow.forEach((r) => rowLookup.set(r.key.symbol, r));

  if (symbols.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground text-sm">
        No closed trades match the current filters.
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-x-auto">
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
                      <CellInner b={b} />
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
                  <CellInner b={rowLookup.get(symbol) ?? null} />
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
