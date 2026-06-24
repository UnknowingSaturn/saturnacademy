// ============================================================================
// Pair Grid tab — BucketGrid + per-cell selection drill-down (QuantNotePanel).
// Selection state stays in URL so deep links survive.
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { BucketGrid } from "@/components/pair-lab/BucketGrid";
import { QuantNotePanel } from "@/components/pair-lab/QuantNotePanel";
import { normalizeSession } from "@/lib/pairLabMath";
import type { usePairLab } from "@/hooks/usePairLab";

type PairLabData = ReturnType<typeof usePairLab>;
export type Selected = { symbol: string; session: string } | null;

interface Props {
  data: PairLabData;
  propFirmMode: boolean;
  selected: Selected;
  setSelected: (cell: Selected) => void;
}

export function PairGridTab({
  data,
  propFirmMode,
  selected,
  setSelected,
}: Props) {
  const headerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selected) return;
    requestAnimationFrame(() => {
      headerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [selected?.symbol, selected?.session]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.symbol, selected?.session]);

  const selectedBucket = useMemo(() => {
    if (!selected) return null;
    if (selected.session === "All sessions") {
      return data.perRow.find((r) => r.key.symbol === selected.symbol) ?? null;
    }
    return (
      data.perCell.find(
        (c) =>
          c.key.symbol === selected.symbol &&
          c.key.session === selected.session,
      ) ?? null
    );
  }, [selected, data.perRow, data.perCell]);

  const scopeLabel = selected
    ? `${selected.symbol} · ${selected.session}`
    : "All trades in scope";

  return (
    <div className="space-y-6">
      <BucketGrid
        symbols={data.symbols}
        sessions={data.sessions}
        perCell={data.perCell}
        perRow={data.perRow}
        selected={selected}
        onSelect={(cell) => setSelected(cell)}
      />

      <div
        ref={headerRef}
        className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-y border-border/60 scroll-mt-4"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Selection
            </span>
            <span className="font-medium">{scopeLabel}</span>
            {selected && (
              <span className="text-[10px] text-muted-foreground/70 ml-1">
                (Esc to clear)
              </span>
            )}
          </div>
          {selected && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              <X className="w-3 h-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {selectedBucket && (
        <QuantNotePanel
          bucket={selectedBucket}
          baseline={data.baseline}
          propFirm={propFirmMode ? data.propFirm : null}
        />
      )}

      {!selected && (
        <div className="text-xs text-muted-foreground text-center py-6">
          Click a cell above to inspect its quant note — SL / TP ladder / risk
          recommendation derived from MFE · MAE · ideal-SL.
        </div>
      )}
    </div>
  );
}
