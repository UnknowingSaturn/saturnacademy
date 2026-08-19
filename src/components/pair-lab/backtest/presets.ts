// ============================================================================
// Named strategies. A preset is a plain `Partial<UiConfig>` patch applied on
// top of the engine defaults — nothing here bypasses the engine's own config.
// ============================================================================

import type { UiConfig } from "./config";

export interface StrategyPreset {
  key: string;
  label: string;
  blurb: string;
  patch: Partial<UiConfig>;
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    key: "silver_bullet",
    label: "Silver Bullet",
    blurb: "10:00–11:00 ET, sweep + structure shift, first setup only, 2R.",
    patch: {
      windowKey: "ny_am",
      biasMode: "prior_close",
      requireSweep: true,
      sweepLookbackBars: 30,
      requireMss: true,
      mssLookbackBars: 15,
      requireDisplacement: false,
      entry: "proximal",
      entryExpiryBars: 20,
      stopMode: "gap",
      stopBufferTicks: 2,
      targetMode: "r",
      targetR: 2,
      maxTradesPerWindow: 1,
      hardExitAtWindowEnd: true,
    },
  },
  {
    key: "london_killzone",
    label: "London killzone",
    blurb: "03:00–04:00 ET, sweep of Asia liquidity, protected-swing stop, 3R.",
    patch: {
      windowKey: "london",
      biasMode: "prior_close",
      requireSweep: true,
      sweepLookbackBars: 45,
      requireMss: true,
      mssLookbackBars: 20,
      requireDisplacement: true,
      displacementMode: "atr",
      displacementAtrMultiple: 1.5,
      entry: "mid",
      entryExpiryBars: 25,
      stopMode: "swing",
      stopBufferTicks: 2,
      targetMode: "r",
      targetR: 3,
      maxTradesPerWindow: 1,
      hardExitAtWindowEnd: true,
    },
  },
  {
    key: "ny_am_continuation",
    label: "NY AM continuation",
    blurb: "Multi-day trend bias, no sweep required, target opposing liquidity.",
    patch: {
      windowKey: "ny_am",
      biasMode: "trend",
      biasTrendDays: 3,
      requireSweep: false,
      requireMss: true,
      mssLookbackBars: 15,
      requireDisplacement: true,
      displacementMode: "percentile",
      entry: "proximal",
      entryExpiryBars: 20,
      stopMode: "gap",
      stopBufferTicks: 2,
      targetMode: "liquidity",
      maxTradesPerWindow: 2,
      hardExitAtWindowEnd: false,
      hardExitAtRthEnd: true,
    },
  },
];

/** True when every field the preset pins still matches the live config. */
export function matchesPreset(cfg: UiConfig, preset: StrategyPreset): boolean {
  return (Object.keys(preset.patch) as (keyof UiConfig)[]).every(
    (k) => cfg[k] === preset.patch[k],
  );
}

export function activePresetKey(cfg: UiConfig): string {
  return STRATEGY_PRESETS.find((p) => matchesPreset(cfg, p))?.key ?? "custom";
}
