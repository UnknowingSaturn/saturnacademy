import type { Strategy } from "@/lib/pairLabSimulator";

/** Default strategy presets surfaced in the Simulator picker. */
export const STRATEGY_PRESETS: Strategy[] = [
  {
    id: "current",
    label: "Your current behavior",
    description:
      "Replay using each trade's recorded R-outcome at this simulator risk % — normalized P&L baseline, not actual dollars booked.",
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
    description: "Two partials, last third trailed to MFE (capture % estimated from your history).",
    riskPct: 1,
    slRule: "original",
    exitRule: {
      partials: [{ atR: 1, fraction: 0.33 }, { atR: 2, fraction: 0.33 }],
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
    id: "all-out-3r",
    label: "All-out @3R",
    description:
      "No partials. Single TP at 3R. Tests whether you are closing the right tail too early.",
    riskPct: 1,
    slRule: "original",
    exitRule: { partials: [{ atR: 3, fraction: 1 }], runner: "all_out_at_last_partial" },
  },
  {
    id: "pure-trail",
    label: "Pure trail · no partials",
    description:
      "No partials. Trail from entry to MFE (capture % estimated from your history). Isolates trail value vs fixed TP caps.",
    riskPct: 1,
    slRule: "original",
    exitRule: { partials: [], runner: "trail_to_mfe" },
  },
  {
    id: "tighten-scale",
    label: "Tighten SL → ideal · scale-out 50%@1R + 50%@2R",
    description: "Tighten stop to recorded ideal-SL, then scale out 50/50 at 1R and 2R.",
    riskPct: 1,
    slRule: "tighten_to_ideal",
    exitRule: {
      partials: [{ atR: 1, fraction: 0.5 }, { atR: 2, fraction: 0.5 }],
      runner: "be_after_first_tp",
    },
  },
  {
    id: "tighten-runner",
    label: "Tighten SL → ideal · runner 33%@1R + 33%@2R + trail",
    description: "Tighten stop to recorded ideal-SL, runner with trail on last third.",
    riskPct: 1,
    slRule: "tighten_to_ideal",
    exitRule: {
      partials: [{ atR: 1, fraction: 0.33 }, { atR: 2, fraction: 0.33 }],
      runner: "trail_to_mfe",
    },
  },
  {
    id: "tighten-2r",
    label: "Tighten SL → ideal · all-out @2R",
    description: "Tighten stop to your recorded ideal-SL, take all off at 2R.",
    riskPct: 1,
    slRule: "tighten_to_ideal",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" },
  },
  {
    id: "widen-2r",
    label: "Widen SL → MAE-p75 × 1.15 · all-out @2R",
    description:
      "Widen stop to bucket MAE 75th-percentile × 1.15 to absorb noise, then all out at 2R of the new (wider) stop.",
    riskPct: 1,
    slRule: "widen_to_mae_p75_x_1_15",
    exitRule: { partials: [{ atR: 2, fraction: 1 }], runner: "all_out_at_last_partial" },
  },
  {
    id: "adaptive-mfe-p60",
    label: "Adaptive TP @ MFE p60 of bucket",
    description:
      "Data-driven exit. Single TP set to the 60th-percentile MFE (in R) of trades in this bucket.",
    riskPct: 1,
    slRule: "original",
    exitRule: {
      partials: [{ atR: 1, fraction: 1, atRSource: "bucket_mfe_p60" }],
      runner: "all_out_at_last_partial",
    },
  },
];

