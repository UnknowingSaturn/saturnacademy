import { describe, it, expect } from "vitest";
import { buildJournalReport, eligibleTrades, groupLegs, ReportTradeRow } from "../export/journalReport";

const t = (o: Partial<ReportTradeRow>): ReportTradeRow => ({
  id: o.id ?? Math.random().toString(),
  symbol: "EURUSD",
  direction: "buy",
  entry_time: "2026-01-01T08:00:00Z",
  trade_type: "executed",
  ...o,
});

describe("journal report", () => {
  it("merges legs sharing a group_key into one trade", () => {
    const g = groupLegs([t({ id: "a", group_key: "g" }), t({ id: "b", group_key: "g" }), t({ id: "c" })]);
    expect(g.length).toBe(2);
    expect(g.find((x) => x.legs.length === 2)).toBeTruthy();
  });

  it("excludes idea/paper/missed and archived trades", () => {
    const rows = eligibleTrades([
      t({ id: "1" }),
      t({ id: "2", trade_type: "idea" }),
      t({ id: "3", trade_type: "paper" }),
      t({ id: "4", trade_type: "missed" }),
      t({ id: "5", is_archived: true }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["1"]);
  });

  it("shows custom field keys as their labels", () => {
    const md = buildJournalReport({
      trades: [t({ id: "x", custom_fields: { cf_mae_rpvr: 0.4 } })],
      reviews: [],
      playbooks: [],
      fieldDefs: [{ key: "cf_mae_rpvr", label: "MAE" }],
    });
    expect(md).toContain("MAE = 0.4");
    expect(md).not.toContain("cf_mae_rpvr =");
  });
});
