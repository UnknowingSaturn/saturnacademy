// Regression coverage for the two most fragile new pure-math helpers:
// `pathProbTpFirst` (Brownian-bridge first-passage probability used by the
// counterfactual replay) and `bootstrapKellyCiBCa` (BCa CI on quarter-Kelly).
//
// These live in `shared/quant/stats.ts`; both are pure and node-only.

import { describe, it, expect } from "vitest";
import {
  pathProbTpFirst,
  resolveTpFirstProb,
  bootstrapKellyCiBCa,
} from "../../../shared/quant/stats";

describe("pathProbTpFirst — barrier ordering", () => {
  it("returns 1.0 when only MFE breached (SL never touched)", () => {
    // TP=1, SL=2, MFE=1.2 ≥ TP, MAE=0.4 < SL → TP is the only fill possible.
    expect(pathProbTpFirst(1, 2, 1.2, 0.4)).toBe(1);
  });

  it("returns 0 when only MAE breached (TP never touched)", () => {
    // TP=1, SL=1, MFE=0.5 < TP, MAE=1.3 ≥ SL → stopped out before TP.
    expect(pathProbTpFirst(1, 1, 0.5, 1.3)).toBe(0);
  });

  it("symmetric barriers with both breached ⇒ ~0.5", () => {
    // TP=1, SL=1, both breached — gambler's ruin gives p = SL/(TP+SL) = 0.5.
    expect(pathProbTpFirst(1, 1, 1.5, 1.5)).toBeCloseTo(0.5, 2);
  });

  it("closer TP than SL ⇒ TP-first probability > 0.5", () => {
    // TP=1, SL=2 both breached → p = 2/(1+2) = 0.667.
    const p = pathProbTpFirst(1, 2, 1.2, 2.3);
    expect(p).toBeGreaterThan(0.6);
    expect(p).toBeLessThan(0.7);
  });

  it("degenerate inputs collapse to max-entropy 0.5", () => {
    expect(pathProbTpFirst(0, 1, 1, 1)).toBe(0.5);
    expect(pathProbTpFirst(1, 0, 1, 1)).toBe(0.5);
  });
});

describe("resolveTpFirstProb — replay-mode collapse", () => {
  it("optimistic ⇒ 1 (legacy TP-first)", () => {
    expect(resolveTpFirstProb(0.3, "optimistic")).toBe(1);
  });
  it("pessimistic ⇒ 0 (safety floor)", () => {
    expect(resolveTpFirstProb(0.7, "pessimistic")).toBe(0);
  });
  it("expected ⇒ passes through the raw bridge probability", () => {
    expect(resolveTpFirstProb(0.42, "expected")).toBe(0.42);
  });
});

describe("bootstrapKellyCiBCa — sanity", () => {
  it("returns null below the n<10 threshold", () => {
    expect(bootstrapKellyCiBCa([1, 2, 3], [1])).toBeNull();
  });

  it("returns null when either side is empty", () => {
    const wins = Array.from({ length: 20 }, () => 1);
    expect(bootstrapKellyCiBCa(wins, [])).toBeNull();
    expect(bootstrapKellyCiBCa([], wins)).toBeNull();
  });

  it("lower ≤ upper on a positive-edge sample", () => {
    const wins = Array.from({ length: 30 }, () => 1.5);
    const losses = Array.from({ length: 20 }, () => 1);
    const ci = bootstrapKellyCiBCa(wins, losses);
    expect(ci).not.toBeNull();
    if (!ci) return;
    expect(ci[0]).toBeLessThanOrEqual(ci[1]);
  });

  it("stronger edge shifts the CI upward", () => {
    const modestWins = Array.from({ length: 30 }, () => 1.2);
    const bigWins = Array.from({ length: 30 }, () => 3.0);
    const losses = Array.from({ length: 20 }, () => 1);
    const ciModest = bootstrapKellyCiBCa(modestWins, losses);
    const ciBig = bootstrapKellyCiBCa(bigWins, losses);
    expect(ciModest).not.toBeNull();
    expect(ciBig).not.toBeNull();
    if (!ciModest || !ciBig) return;
    // Upper CI on the bigger edge should exceed the upper CI on the smaller one.
    expect(ciBig[1]).toBeGreaterThan(ciModest[1]);
  });
});
