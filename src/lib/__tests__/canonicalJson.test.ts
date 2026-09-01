import { describe, it, expect } from "vitest";
import { canonicalStringify, canonicalEqual } from "../canonicalJson";

// The journal autosave loop was caused by comparing a locally built review
// object against the same object after a Postgres jsonb round trip. jsonb does
// not preserve client key order, so raw JSON.stringify always reported a change
// and the panel re-saved forever.
describe("canonicalJson", () => {
  it("treats reordered object keys as equal", () => {
    const local = { id: "a", timeframe: "4H", url: "u", description: "d", created_at: "t" };
    const roundTripped = { created_at: "t", description: "d", id: "a", timeframe: "4H", url: "u" };
    expect(canonicalEqual(local, roundTripped)).toBe(true);
  });

  it("treats reordered keys inside arrays of objects as equal", () => {
    const local = { screenshots: [{ id: "1", url: "a" }, { id: "2", url: "b" }] };
    const server = { screenshots: [{ url: "a", id: "1" }, { url: "b", id: "2" }] };
    expect(canonicalEqual(local, server)).toBe(true);
  });

  it("treats empty string, undefined and null as the same absence", () => {
    expect(canonicalEqual({ notes: "" }, { notes: null })).toBe(true);
    expect(canonicalEqual({ notes: undefined }, { notes: null })).toBe(true);
  });

  it("still detects real changes", () => {
    expect(canonicalEqual({ notes: "a" }, { notes: "b" })).toBe(false);
    expect(canonicalEqual({ s: [{ id: "1" }] }, { s: [{ id: "1" }, { id: "2" }] })).toBe(false);
  });

  it("preserves array order (order is meaningful)", () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
  });
});
