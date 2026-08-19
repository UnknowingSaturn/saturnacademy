// ============================================================================
// Shared UI config types for the Backtest Lab. Every field maps 1:1 to an
// `EngineConfig` field — the UI never invents a knob the engine can't execute.
// ============================================================================

import type { EngineConfig } from "../../../../shared/quant/ict/engine";

export { windowForKey, windowsForKeys } from "../../../../shared/quant/ict/configs";

/** Windows are chosen by key in the UI and resolved by `windowsForKeys`. */
export type UiConfig = Omit<EngineConfig, "windows"> & { windowKeys: string[] };

/** Labels quote the real ET windows defined in `shared/quant/sessions.ts`. */
export const WINDOW_OPTIONS = [
  { key: "tokyo", label: "Tokyo session (20:00–24:00 ET)" },
  { key: "london_early", label: "London continuation (02:00–03:00 ET)" },
  { key: "london", label: "London killzone (03:00–04:00 ET)" },
  { key: "london_range", label: "London range (03:00–05:00 ET)" },
  { key: "ny_open", label: "NY open (07:00–08:00 ET)" },
  { key: "ny_am", label: "NY AM / Silver Bullet (10:00–11:00 ET)" },
  { key: "ny_pm", label: "NY PM killzone (14:00–15:00 ET)" },
  { key: "rth", label: "Full RTH (09:30–16:00 ET)" },
];


export function windowLabel(key: string): string {
  return WINDOW_OPTIONS.find((w) => w.key === key)?.label ?? key;
}

export interface WfUi {
  enabled: boolean;
  trainMonths: number;
  testMonths: number;
  anchored: boolean;
  minTrainTrades: number;
  sweepTargetR: boolean;
  sweepEntry: boolean;
  sweepStopBuffer: boolean;
}

export const DEFAULT_WF: WfUi = {
  enabled: false,
  trainMonths: 6,
  testMonths: 2,
  anchored: false,
  minTrainTrades: 20,
  sweepTargetR: true,
  sweepEntry: true,
  sweepStopBuffer: false,
};
