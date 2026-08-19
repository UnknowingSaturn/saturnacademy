// ============================================================================
// Strategy presets for the Backtest Lab UI. The definitions live in
// `shared/quant/ict/configs/grid.json` so the UI and the backtest worker can
// never disagree about what a named strategy means.
// ============================================================================

import { NAMED_CONFIGS } from "../../../../shared/quant/ict/configs";
import type { UiConfig } from "./config";

export interface StrategyPreset {
  key: string;
  label: string;
  blurb: string;
  patch: Partial<UiConfig>;
}

export const STRATEGY_PRESETS: StrategyPreset[] = NAMED_CONFIGS.map((c) => ({
  key: c.key,
  label: c.label,
  blurb: c.blurb,
  patch: { ...(c.patch as Partial<UiConfig>), windowKeys: c.windowKeys },
}));

/** True when every field the preset pins still matches the live config. */
export function matchesPreset(cfg: UiConfig, preset: StrategyPreset): boolean {
  return (Object.keys(preset.patch) as (keyof UiConfig)[]).every((k) => {
    const a = cfg[k];
    const b = preset.patch[k];
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
  });
}

export function activePresetKey(cfg: UiConfig): string {
  return STRATEGY_PRESETS.find((p) => matchesPreset(cfg, p))?.key ?? "custom";
}
