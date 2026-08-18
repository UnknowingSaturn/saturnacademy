import { describe, it, expect } from "vitest";
import {
  parseMt5Csv,
  detectServerOffset,
  toMonthlySeries,
  modalStep,
} from "../../../shared/quant/mt5Csv";
import { assessBarQuality } from "../../../shared/quant/bars";

const MIN = 60_000;

/** Synthetic M1 export in broker time (UTC+offsetHours), Mon–Fri 00:00–23:59. */
function buildCsv(
  opts: { offsetHours: number; delim: string; header: boolean; days: number; startUtc: number },
): { text: string; utcStamps: number[] } {
  const lines: string[] = [];
  const utcStamps: number[] = [];
  if (opts.header) lines.push(["<DATE>", "<TIME>", "<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>", "<TICKVOL>"].join(opts.delim));
  let price = 100;
  for (let d = 0; d < opts.days; d++) {
    const dayStart = opts.startUtc + d * 86_400_000;
    const dow = new Date(dayStart).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    // FX week: Friday closes 21:00 UTC.
    const minutes = dow === 5 ? 21 * 60 : 24 * 60;
    for (let m = 0; m < minutes; m++) {
      const utc = dayStart + m * MIN;
      utcStamps.push(utc);
      const server = new Date(utc + opts.offsetHours * 3600_000);
      const date = `${server.getUTCFullYear()}.${String(server.getUTCMonth() + 1).padStart(2, "0")}.${String(server.getUTCDate()).padStart(2, "0")}`;
      const time = `${String(server.getUTCHours()).padStart(2, "0")}:${String(server.getUTCMinutes()).padStart(2, "0")}`;
      price += 0.1;
      const o = price, h = price + 0.5, l = price - 0.5, c = price + 0.2;
      lines.push([date, time, o.toFixed(2), h.toFixed(2), l.toFixed(2), c.toFixed(2), "10"].join(opts.delim));
    }
  }
  return { text: lines.join("\n"), utcStamps };
}

// A Monday 00:00 UTC start.
const MONDAY = Date.UTC(2024, 0, 1);

describe("parseMt5Csv", () => {
  it("parses a tab-separated MT5 export with a header", () => {
    const { text } = buildCsv({ offsetHours: 0, delim: "\t", header: true, days: 5, startUtc: MONDAY });
    const p = parseMt5Csv(text);
    expect(p.hadHeader).toBe(true);
    expect(p.delimiter).toBe("\t");
    expect(p.skipped).toBe(0);
    expect(p.stepMs).toBe(MIN);
    expect(p.bars.length).toBeGreaterThan(5000);
  });

  it("parses comma and semicolon variants identically", () => {
    const a = parseMt5Csv(buildCsv({ offsetHours: 0, delim: ",", header: false, days: 3, startUtc: MONDAY }).text);
    const b = parseMt5Csv(buildCsv({ offsetHours: 0, delim: ";", header: false, days: 3, startUtc: MONDAY }).text);
    expect(a.bars.length).toBe(b.bars.length);
    expect(a.bars[0].ts).toBe(b.bars[0].ts);
  });

  it("parses a single ISO datetime column", () => {
    const p = parseMt5Csv("2024-01-02 09:30:00,1.1041,1.1043,1.1040,1.1042,88");
    expect(p.bars).toHaveLength(1);
    expect(p.bars[0].ts).toBe(Date.UTC(2024, 0, 2, 9, 30));
    expect(p.bars[0].close).toBeCloseTo(1.1042, 6);
  });

  it("drops malformed and inconsistent rows instead of poisoning the series", () => {
    const p = parseMt5Csv(
      [
        "2024.01.02,00:00,10,11,9,10.5,5",
        "2024.01.02,00:01,x,11,9,10.5,5", // non-numeric
        "2024.01.02,00:02,10,9,11,10.5,5", // high < low
        "2024.01.02,00:03,10", // truncated
        "2024.01.02,00:04,10,11,9,10.5,5",
      ].join("\n"),
    );
    expect(p.bars).toHaveLength(2);
    expect(p.skipped).toBe(3);
    expect(p.issues.map((i) => i.reason)).toContain("non-numeric OHLC");
  });

  it("detects a non-M1 timeframe via the modal step", () => {
    const rows = Array.from({ length: 20 }, (_, i) => {
      const t = new Date(Date.UTC(2024, 0, 2, 0, 0) + i * 5 * MIN);
      return `2024.01.02,${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")},10,11,9,10.5,5`;
    });
    expect(parseMt5Csv(rows.join("\n")).stepMs).toBe(5 * MIN);
    expect(modalStep([])).toBeNull();
  });
});

describe("detectServerOffset", () => {
  for (const offset of [0, 2, 3, -5]) {
    it(`recovers a UTC${offset >= 0 ? "+" : ""}${offset} broker clock`, () => {
      const { text } = buildCsv({ offsetHours: offset, delim: ",", header: false, days: 26, startUtc: MONDAY });
      const p = parseMt5Csv(text);
      const d = detectServerOffset(p.bars);
      expect(d.offsetMinutes).toBe(offset * 60);
      expect(d.samples).toBeGreaterThanOrEqual(3);
      expect(d.confident).toBe(true);
    });
  }

  it("reports no confidence when there is no weekly gap to measure", () => {
    const p = parseMt5Csv(buildCsv({ offsetHours: 2, delim: ",", header: false, days: 3, startUtc: MONDAY }).text);
    expect(detectServerOffset(p.bars).confident).toBe(false);
  });
});

describe("toMonthlySeries", () => {
  it("shifts to UTC, splits by month and preserves ordering", () => {
    const { text, utcStamps } = buildCsv({
      offsetHours: 3,
      delim: ",",
      header: true,
      days: 45,
      startUtc: MONDAY,
    });
    const p = parseMt5Csv(text);
    const { months, duplicates } = toMonthlySeries(p.bars, 3 * 60);
    expect(duplicates).toBe(0);
    expect(months.map((m) => m.month)).toEqual(["2024-01", "2024-02"]);

    const all = months.flatMap((m) => [...m.series.ts]);
    expect(all.length).toBe(utcStamps.length);
    expect(all).toEqual([...utcStamps].sort((a, b) => a - b));
    for (const m of months) {
      for (const t of m.series.ts) expect(new Date(t).toISOString().slice(0, 7)).toBe(m.month);
    }
  });

  it("collapses duplicate minute stamps", () => {
    const p = parseMt5Csv(
      ["2024.01.02,00:00,10,11,9,10.5,5", "2024.01.02,00:00,10,12,9,10.5,7"].join("\n"),
    );
    const { months, duplicates } = toMonthlySeries(p.bars, 0);
    expect(duplicates).toBe(1);
    expect(months[0].series.length).toBe(1);
  });

  it("produces a series the quality assessor reads as clean weekday coverage", () => {
    const { text } = buildCsv({ offsetHours: 2, delim: "\t", header: true, days: 12, startUtc: MONDAY });
    const p = parseMt5Csv(text);
    const { months } = toMonthlySeries(p.bars, 2 * 60);
    const q = assessBarQuality(months[0].series);
    expect(q.invalidBars).toBe(0);
    expect(q.duplicateTs).toBe(0);
    expect(q.missingDays).toEqual([]);
    expect(q.missingMinutes).toBe(0);
  });
});
