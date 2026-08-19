// ============================================================================
// Bar chunk loading, shared by the single-run backtest and the Layer-5 sweep.
//
// One month = one `.bin` chunk in the private `bars` bucket. Broker (MT5)
// uploads beat vendor months for the same period: they are the prices that
// actually filled the journalled trades.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { normalizeSymbol } from "../../../shared/quant/symbolAliasing";

const BUCKET = "bars";

const chunkCache = new Map<string, ArrayBuffer>();

export interface ManifestRow {
  month: string;
  object_path: string;
  source: string;
  missing_minutes: number | null;
  bar_count: number | null;
}

export function monthStartMs(month: string): number {
  return Date.parse(`${month}-01T00:00:00Z`);
}

export function monthEndMs(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return Date.parse(`${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00Z`) - 1;
}

export async function fetchManifest(
  symbol: string,
  fromMonth: string,
  toMonth: string,
): Promise<ManifestRow[]> {
  const canonical = normalizeSymbol(symbol.toUpperCase());
  const { data, error } = await supabase
    .from("bar_manifest")
    .select("month,object_path,bar_count,source,missing_minutes")
    .eq("symbol", canonical)
    .eq("timeframe", "1m")
    .gte("month", fromMonth)
    .lte("month", toMonth)
    .order("month", { ascending: true });
  if (error) throw new Error(error.message);

  const byMonth = new Map<string, ManifestRow>();
  for (const r of (data ?? []) as ManifestRow[]) {
    if ((r.bar_count ?? 0) <= 0) continue;
    const prev = byMonth.get(r.month);
    if (!prev || (prev.source !== "broker" && r.source === "broker")) byMonth.set(r.month, r);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export async function loadChunk(path: string): Promise<ArrayBuffer> {
  const cached = chunkCache.get(path);
  if (cached) return cached.slice(0); // workers transfer ⇒ hand out a copy
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Failed to download ${path}: ${error?.message ?? "no data"}`);
  const buf = await data.arrayBuffer();
  chunkCache.set(path, buf);
  return buf.slice(0);
}

/** All month chunks for a symbol/range, one copy per requested consumer. */
export async function loadChunks(
  symbol: string,
  fromMonth: string,
  toMonth: string,
  copies = 1,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ chunks: ArrayBuffer[][]; rows: ManifestRow[] }> {
  const rows = await fetchManifest(symbol, fromMonth, toMonth);
  if (!rows.length) {
    throw new Error(
      `No bars for ${normalizeSymbol(symbol)} between ${fromMonth} and ${toMonth}. Import the history in the Data step first.`,
    );
  }
  const sets: ArrayBuffer[][] = Array.from({ length: copies }, () => []);
  let loaded = 0;
  for (const row of rows) {
    const buf = await loadChunk(row.object_path);
    for (let c = 0; c < copies; c++) sets[c].push(c === 0 ? buf : buf.slice(0));
    onProgress?.(++loaded, rows.length);
  }
  return { chunks: sets, rows };
}
