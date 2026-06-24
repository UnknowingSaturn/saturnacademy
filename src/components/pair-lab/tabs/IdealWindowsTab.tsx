// ============================================================================
// Ideal Windows tab — pair × hour × half heatmap. Walk-forward window comes
// from the shared context.
// ============================================================================

import { IdealWindowHeatmap } from "@/components/pair-lab/IdealWindowHeatmap";
import type { usePairLab } from "@/hooks/usePairLab";

interface Props {
  data: ReturnType<typeof usePairLab>;
}

export function IdealWindowsTab({ data }: Props) {
  return (
    <IdealWindowHeatmap
      trades={data.trades}
      symbolResolver={data.symbolResolver}
      allSymbols={data.symbols}
    />
  );
}
