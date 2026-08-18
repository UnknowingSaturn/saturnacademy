// ============================================================================
// MT5 import worker — parse a multi-year M1 CSV off the main thread.
//
// Two phases so the UI can show a preview before anything is written:
//   "analyze" → parse, detect the broker offset, report per-month coverage
//   "encode"  → apply the (possibly user-corrected) offset and emit binary
//               chunks ready for upload
// ============================================================================

import {
  parseMt5Csv,
  detectServerOffset,
  toMonthlySeries,
} from "../../shared/quant/mt5Csv";
import { assessBarQuality, encodeBarChunk, type BarQualityReport } from "../../shared/quant/bars";

export interface MonthPreview {
  month: string;
  barCount: number;
  missingMinutes: number;
  missingDays: number;
  invalidBars: number;
  duplicateTs: number;
}

export interface Mt5AnalyzeRequest {
  id: number;
  phase: "analyze";
  text: string;
  /** null = auto-detect. */
  offsetMinutes: number | null;
}

export interface Mt5EncodeRequest {
  id: number;
  phase: "encode";
  text: string;
  offsetMinutes: number;
}

export type Mt5ImportRequest = Mt5AnalyzeRequest | Mt5EncodeRequest;

export interface Mt5AnalyzeResponse {
  id: number;
  phase: "analyze";
  ok: boolean;
  error?: string;
  offsetMinutes?: number;
  offsetConfident?: boolean;
  offsetSamples?: number;
  delimiter?: string;
  hadHeader?: boolean;
  stepMs?: number | null;
  totalBars?: number;
  skipped?: number;
  issues?: Array<{ line: number; reason: string }>;
  duplicates?: number;
  months?: MonthPreview[];
}

export interface EncodedMonth {
  month: string;
  bytes: ArrayBuffer;
  quality: BarQualityReport;
}

export interface Mt5EncodeResponse {
  id: number;
  phase: "encode";
  ok: boolean;
  error?: string;
  months?: EncodedMonth[];
}

export type Mt5ImportResponse = Mt5AnalyzeResponse | Mt5EncodeResponse;

self.onmessage = (e: MessageEvent<Mt5ImportRequest>) => {
  const req = e.data;
  try {
    const parsed = parseMt5Csv(req.text);
    if (parsed.bars.length === 0) {
      throw new Error("No usable bars found — is this an MT5 bar export?");
    }

    if (req.phase === "analyze") {
      const detected = detectServerOffset(parsed.bars);
      const offsetMinutes = req.offsetMinutes ?? detected.offsetMinutes;
      const { months, duplicates } = toMonthlySeries(parsed.bars, offsetMinutes);
      const previews: MonthPreview[] = months.map((m) => {
        const q = assessBarQuality(m.series);
        return {
          month: m.month,
          barCount: q.barCount,
          missingMinutes: q.missingMinutes,
          missingDays: q.missingDays.length,
          invalidBars: q.invalidBars,
          duplicateTs: q.duplicateTs,
        };
      });
      const res: Mt5AnalyzeResponse = {
        id: req.id,
        phase: "analyze",
        ok: true,
        offsetMinutes,
        offsetConfident: detected.confident,
        offsetSamples: detected.samples,
        delimiter: parsed.delimiter,
        hadHeader: parsed.hadHeader,
        stepMs: parsed.stepMs,
        totalBars: parsed.bars.length,
        skipped: parsed.skipped,
        issues: parsed.issues,
        duplicates,
        months: previews,
      };
      (self as unknown as Worker).postMessage(res);
      return;
    }

    const { months } = toMonthlySeries(parsed.bars, req.offsetMinutes);
    const encoded: EncodedMonth[] = months.map((m) => {
      const bytes = encodeBarChunk(m.series);
      // Copy out of the (possibly larger) worker buffer so it transfers cleanly.
      const buf = bytes.slice().buffer as ArrayBuffer;
      return { month: m.month, bytes: buf, quality: assessBarQuality(m.series) };
    });
    const res: Mt5EncodeResponse = { id: req.id, phase: "encode", ok: true, months: encoded };
    (self as unknown as Worker).postMessage(res, encoded.map((m) => m.bytes));
  } catch (err) {
    const res = {
      id: req.id,
      phase: req.phase,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } as Mt5ImportResponse;
    (self as unknown as Worker).postMessage(res);
  }
};
