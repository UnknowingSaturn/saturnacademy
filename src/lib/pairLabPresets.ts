import type { Strategy } from "@/lib/pairLabSimulator";

/** Default strategy presets surfaced in the Simulator picker. */
export const STRATEGY_PRESETS: Strategy[] = [
  {
    id: "current",
    label: "Your current behavior",
    description: "Replay using the trade's actual recorded R outcome. Baseline to beat.",
    riskPct: 1,
    slRule: "original",
    exitRule: { partials: [{ atR: 1, fraction: 1 }], runner: "be_after_first_tp" },
    useActualOutcome: true,
  },
  {
    id: "quick-flip",
    label: "Quick-flip · 100% @1R",
    description: "Take the whole position off at 1R. Maximises win rate at the cost of upside.",
    riskPct: 1,
    slRule: "original",
    exitRule: { partials: [{ atR: 1, fraction: 1 }], runner: "all_out_at_last_partial" },
  },
  {
    id: "scale-out",
    label: "Scale-out · 50% @1R + 50% @2R",
    description: "Book half at 1R, move to BE, second half at 2R.",
    riskPct: 1,
    slRule: "original",
    exitRule: {
      partials: [{ atR: 1, fraction: 0.5 }, { atR: 2, fraction: 0.5 }],
      runner: "be_after_first_tp",
    },
  },
  {
    id: "runner",
    label: "Runner · 33% @1R + 33% @2R + trail",
    description: "Two partials, last third trailed to MFE (≈80% capture).",
    riskPct: 1,
    slRule: "original",
    exitRule: {
      partials: [{ atR: 1, fraction: 0.34 }, { atR: 2, fraction: 0.33 }],
      runner: "trail_to_mfe",
    },
  },
  {
    id: "all-out-2r",
    label: "All-out @2R",
    description: "No partials. Single TP at 2R. Higher per-trade expectancy, lower win rate.",
    riskPct: 1,
    slRule: "original",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" },
  },
  {
    id: "tighten-2r",
    label: "Tighten SL → ideal · all-out @2R",
    description: "Tighten stop to your recorded ideal-SL, take all off at 2R.",
    riskPct: 1,
    slRule: "tighten_to_ideal",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" },
  },
];

export function getPreset(id: string): Strategy | undefined {
  return STRATEGY_PRESETS.find((p) => p.id === id);
}
