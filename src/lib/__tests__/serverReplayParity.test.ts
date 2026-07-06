// PR-3 P0 parity test: the Deno server twin of the strategy simulator
// (`supabase/functions/_shared/quant/pairLabSimulator.ts`) MUST produce the
// same per-preset expectancy and eligibility as the client
// (`src/lib/pairLabSimulator.ts`). The AI-generated quant note is built from
// server output; drift = user sees inflated stats.
//
// Prior to PR-3 the server was missing two fixes present on the client:
//   P0-A — survivorship-bias early return for unfilled partials
//   P0-B — Brownian-bridge ordering mixture (pathProbTpFirst)
// Both caused early-TP / multi-TP presets to look ~10–40% better on the
// server than on the client. This test would have caught it.

import { describe, it, expect } from "vitest";
import { replayAllPresets as clientReplay } from "../pairLabSimulator";
import { replayAllPresets as serverReplay } from "../../../supabase/functions/_shared/quant/pairLabSimulator";
import type { Trade } from "@/types/trading";
import type { PairLabFieldKeys } from "../pairLabMath";

const keys: PairLabFieldKeys = {
  mfe: "cf_mfe_r",
  mae: "cf_mae_r",
  idealStopLoss: "cf_ideal_stop_loss_ticks",
  idealEntryWindowFirstHalf: "cf_ideal_entry_window_first_half",
  idealEntryWindowSecondHalf: "cf_ideal_entry_window_second_half",
};

/** Build a synthetic Trade with the fields the simulator actually reads. */
function mk(
  id: string,
  args: {
    mfeR: number | null;
    maeR: number | null;
    rActual: number | null;
    entry?: number;
    sl?: number;
    symbol?: string;
  },
): Trade {
  const entry = args.entry ?? 1.1000;
  const sl = args.sl ?? 1.0980;
  return {
    id,
    user_id: "u",
    account_id: "a",
    symbol: args.symbol ?? "EURUSD",
    entry_price: entry,
    sl_initial: sl,
    entry_time: `2024-01-${(1 + Number(id) % 28).toString().padStart(2, "0")}T09:30:00Z`,
    is_open: false,
    is_archived: false,
    net_pnl: args.rActual != null ? args.rActual * 100 : 0,
    r_multiple_actual: args.rActual,
    cf_mfe_r: args.mfeR,
    cf_mae_r: args.maeR != null ? -args.maeR : null,
    trade_type: "executed",
    session: "london",
    partial_closes: [],
    partial_fills: [],
    // Unused but required by the Trade type — cast covers the rest.
  } as unknown as Trade;
}

function buildFixture(): Trade[] {
  const rows: Trade[] = [];
  // Mix of outcomes: clean winners, clean losers, ambiguous (both breached),
  // conservative winners (didn't reach every rung), and unrecorded MFE/MAE.
  for (let i = 0; i < 40; i++) rows.push(mk(String(i), { mfeR: 2.5, maeR: 0.4, rActual: 1.8 })); // full ladder
  for (let i = 40; i < 70; i++) rows.push(mk(String(i), { mfeR: 1.4, maeR: 0.5, rActual: 1.1 })); // hit TP1 only
  for (let i = 70; i < 100; i++) rows.push(mk(String(i), { mfeR: 0.6, maeR: 1.05, rActual: -1 })); // clean loss
  for (let i = 100; i < 130; i++) rows.push(mk(String(i), { mfeR: 1.3, maeR: 1.2, rActual: -0.6 })); // ambiguous both-breached
  for (let i = 130; i < 160; i++) rows.push(mk(String(i), { mfeR: 0.9, maeR: 0.7, rActual: 0.2 })); // conservative winner, no TP hit
  return rows;
}

describe("PR-3 · server/client replayAllPresets parity", () => {
  const trades = buildFixture();
  const clientRows = clientReplay(trades, keys);
  // Server accepts extra opts (replayMode); default "expected" matches client default.
  const serverRows = serverReplay(trades as unknown as any[], keys);

  it("returns the same preset set", () => {
    expect(serverRows.map((r) => r.presetId).sort()).toEqual(
      clientRows.map((r) => r.presetId).sort(),
    );
  });

  for (const presetId of [
    "quick-flip",
    "scale-out",
    "runner",
    "all-out-2r",
    "all-out-3r",
    "pure-trail",
  ]) {
    it(`preset ${presetId} — expectancyR and nEligible match`, () => {
      const c = clientRows.find((r) => r.presetId === presetId)!;
      const s = serverRows.find((r) => r.presetId === presetId)!;
      // nEligible parity is the P0-A guard: server used to drop winners that
      // didn't reach every rung.
      expect(s.nEligible).toBe(c.nEligible);
      // expectancyR parity is the combined P0-A + P0-B guard.
      expect(s.expectancyR).toBeCloseTo(c.expectancyR, 6);
    });
  }
});
