// ============================================================================
// ingest-bars — Dukascopy 1-minute bar ingestion for the backtest lab.
//
// Actions (POST JSON):
//   { action: "enqueue", symbol, from: "YYYY-MM", to: "YYYY-MM" }
//       Queue one job per month. Idempotent — an existing job for the same
//       (symbol, timeframe, month, source) is left alone unless it failed,
//       in which case it is reset to pending.
//   { action: "drain", maxJobs?: number }
//       Lease and process up to `maxJobs` pending jobs (hard-capped), writing
//       a binary chunk per month to the private `bars` bucket and upserting
//       `bar_manifest`.
//   { action: "status", symbol? }
//       Coverage + queue snapshot for the UI.
//
// BOUNDED BY DESIGN (see ai-background-batch-jobs):
//   - `maxJobs` cap plus a wall-clock budget end each run with work remaining.
//   - A lease column (`lease_until`) is the single-flight lock; a second run
//     skips leased rows instead of double-fetching the same month.
//   - Progress is recorded per month, so a re-run resumes rather than redoes.
//   - Repeated upstream 5xx/429 park the job (status 'failed' + last_error)
//     instead of hot-looping; Dukascopy rate-limits aggressively.
// ============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { json, requireUser, AuthError } from "../_shared/edgeAuth.ts";
import { lzmaDecompress } from "../_shared/lzma/index.ts";
import {
  DUKASCOPY_INSTRUMENTS,
  instrumentForSymbol,
  dukascopyDayUrl,
  decodeDukascopyDay,
  monthDays,
  monthRange,
  type DecodedBar,
} from "../_shared/quant/vendor/dukascopy.ts";
import {
  makeSeries,
  encodeBarChunk,
  assessBarQuality,
  barChunkPath,
} from "../_shared/quant/vendor/bars.ts";

const BUCKET = "bars";
const TIMEFRAME = "1m";
const SOURCE = "dukascopy";
const MAX_JOBS_PER_RUN = 3;
const RUN_BUDGET_MS = 110_000;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 4;
const DAY_CONCURRENCY = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, admin } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "status");

    if (action === "enqueue") return await enqueue(admin, userId, body);
    if (action === "drain") return await drain(admin, Number(body.maxJobs) || MAX_JOBS_PER_RUN);
    if (action === "status") return await status(admin, body.symbol ? String(body.symbol) : null);

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.message }, err.status ?? 401);
    console.error("ingest-bars failed:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function enqueue(admin: any, userId: string, body: Record<string, unknown>) {
  const symbol = String(body.symbol ?? "").toUpperCase();
  const inst = instrumentForSymbol(symbol);
  if (!inst) {
    return json(
      { error: `Unsupported symbol "${symbol}"`, supported: DUKASCOPY_INSTRUMENTS.map((i) => i.symbol) },
      400,
    );
  }

  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return json({ error: "`from` and `to` must be YYYY-MM" }, 400);
  }
  const start = from < inst.since ? inst.since : from;
  const months = monthRange(start, to);
  if (months.length === 0) return json({ error: "Empty month range" }, 400);
  if (months.length > 120) return json({ error: "Range too large (max 120 months per request)" }, 400);

  const rows = months.map((month) => ({
    symbol: inst.symbol,
    timeframe: TIMEFRAME,
    month,
    source: SOURCE,
    status: "pending",
    attempts: 0,
    lease_until: null,
    last_error: null,
    requested_by: userId,
    updated_at: new Date().toISOString(),
  }));

  // Do not clobber months already done: insert new rows, and revive only the
  // ones that previously failed.
  const { data: existing } = await admin
    .from("bar_ingest_jobs")
    .select("month,status")
    .eq("symbol", inst.symbol)
    .eq("timeframe", TIMEFRAME)
    .eq("source", SOURCE)
    .in("month", months);

  const byMonth = new Map<string, string>((existing ?? []).map((r: { month: string; status: string }) => [r.month, r.status]));
  const fresh = rows.filter((r) => !byMonth.has(r.month));
  const revive = rows.filter((r) => byMonth.get(r.month) === "failed");

  if (fresh.length) {
    const { error } = await admin.from("bar_ingest_jobs").insert(fresh);
    if (error) throw new Error(`enqueue insert failed: ${error.message}`);
  }
  for (const r of revive) {
    await admin
      .from("bar_ingest_jobs")
      .update({ status: "pending", attempts: 0, lease_until: null, last_error: null, updated_at: r.updated_at })
      .eq("symbol", r.symbol).eq("timeframe", TIMEFRAME).eq("source", SOURCE).eq("month", r.month);
  }

  return json({
    symbol: inst.symbol,
    requested: months.length,
    queued: fresh.length,
    revived: revive.length,
    skipped: months.length - fresh.length - revive.length,
  });
}

// deno-lint-ignore no-explicit-any
async function drain(admin: any, maxJobs: number) {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const limit = Math.max(1, Math.min(maxJobs, MAX_JOBS_PER_RUN));
  const processed: Array<Record<string, unknown>> = [];

  for (let i = 0; i < limit; i++) {
    if (Date.now() > deadline) break;
    const job = await leaseJob(admin);
    if (!job) break;

    try {
      const result = await ingestMonth(admin, job.symbol, job.month, deadline);
      await admin
        .from("bar_ingest_jobs")
        .update({ status: "done", lease_until: null, last_error: null, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      processed.push({ symbol: job.symbol, month: job.month, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = (job.attempts ?? 0) + 1;
      await admin
        .from("bar_ingest_jobs")
        .update({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts,
          lease_until: null,
          last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      processed.push({ symbol: job.symbol, month: job.month, error: message, attempts });
    }
  }

  const { count: remaining } = await admin
    .from("bar_ingest_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return json({ processed, remaining: remaining ?? 0 });
}

// deno-lint-ignore no-explicit-any
async function status(admin: any, symbol: string | null) {
  let manifestQuery = admin
    .from("bar_manifest")
    .select("symbol,month,bar_count,first_ts,last_ts,byte_size,missing_minutes,missing_days")
    .order("month", { ascending: true });
  if (symbol) manifestQuery = manifestQuery.eq("symbol", symbol.toUpperCase());

  const [{ data: manifest }, { data: jobs }] = await Promise.all([
    manifestQuery,
    admin.from("bar_ingest_jobs").select("symbol,month,status,attempts,last_error").order("month"),
  ]);

  const counts: Record<string, number> = {};
  for (const j of jobs ?? []) counts[j.status] = (counts[j.status] ?? 0) + 1;

  return json({
    instruments: DUKASCOPY_INSTRUMENTS,
    manifest: manifest ?? [],
    jobs: jobs ?? [],
    jobCounts: counts,
  });
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function leaseJob(admin: any) {
  const now = new Date();
  const { data: candidates } = await admin
    .from("bar_ingest_jobs")
    .select("id,symbol,month,attempts,lease_until")
    .eq("status", "pending")
    .order("month", { ascending: true })
    .limit(10);

  for (const c of candidates ?? []) {
    if (c.lease_until && new Date(c.lease_until) > now) continue;
    // Conditional update = the single-flight lock. Another concurrent run that
    // read the same row loses the race because status is no longer 'pending'.
    const { data: locked } = await admin
      .from("bar_ingest_jobs")
      .update({
        status: "running",
        lease_until: new Date(now.getTime() + LEASE_MS).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", c.id)
      .eq("status", "pending")
      .select("id,symbol,month,attempts")
      .maybeSingle();
    if (locked) return locked;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function ingestMonth(admin: any, symbol: string, month: string, deadline: number) {
  const inst = instrumentForSymbol(symbol);
  if (!inst) throw new Error(`Unsupported symbol ${symbol}`);

  const days = monthDays(month);
  const collected: DecodedBar[][] = new Array(days.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= days.length) return;
      if (Date.now() > deadline) throw new Error("Run budget exhausted mid-month; job stays pending");
      const d = days[i];
      const dow = new Date(d.dayStartMs).getUTCDay();
      if (dow === 6) { collected[i] = []; continue; } // Saturday: no feed at all.
      collected[i] = await fetchDay(inst.code, d, inst.priceDivisor);
    }
  }

  await Promise.all(Array.from({ length: Math.min(DAY_CONCURRENCY, days.length) }, worker));

  const bars = collected.flat().sort((a, b) => a.ts - b.ts);
  if (bars.length === 0) throw new Error(`No bars returned for ${symbol} ${month}`);

  const series = makeSeries(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    series.ts[i] = b.ts;
    series.open[i] = b.open;
    series.high[i] = b.high;
    series.low[i] = b.low;
    series.close[i] = b.close;
    series.volume[i] = b.volume;
  }

  const quality = assessBarQuality(series);
  const bytes = encodeBarChunk(series);
  const path = barChunkPath(SOURCE, inst.symbol, TIMEFRAME, month);

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/octet-stream",
    upsert: true,
  });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  const { error: manErr } = await admin.from("bar_manifest").upsert({
    symbol: inst.symbol,
    timeframe: TIMEFRAME,
    month,
    source: SOURCE,
    object_path: path,
    bar_count: quality.barCount,
    first_ts: quality.firstTs ? new Date(quality.firstTs).toISOString() : null,
    last_ts: quality.lastTs ? new Date(quality.lastTs).toISOString() : null,
    byte_size: bytes.byteLength,
    missing_minutes: quality.missingMinutes,
    duplicate_ts: quality.duplicateTs,
    zero_volume_bars: quality.zeroVolumeBars,
    invalid_bars: quality.invalidBars,
    missing_days: quality.missingDays,
    quality,
    ingested_at: new Date().toISOString(),
  }, { onConflict: "symbol,timeframe,month,source" });
  if (manErr) throw new Error(`manifest upsert failed: ${manErr.message}`);

  return { barCount: quality.barCount, bytes: bytes.byteLength, missingDays: quality.missingDays.length };
}

async function fetchDay(
  code: string,
  d: { year: number; month: number; day: number; dayStartMs: number },
  divisor: number,
): Promise<DecodedBar[]> {
  const url = dukascopyDayUrl(code, d.year, d.month, d.day);
  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** attempt + Math.random() * 250);
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (bar-ingest)" } });
    } catch (err) {
      lastError = `network: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    // 404 = the feed genuinely has no file for that day (holiday / pre-history).
    if (res.status === 404) return [];
    if (res.status === 429 || res.status >= 500) {
      lastError = `HTTP ${res.status}`;
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dukascopy ${res.status} for ${url}: ${text.slice(0, 200)}`);
    }
    const raw = new Uint8Array(await res.arrayBuffer());
    if (raw.byteLength === 0) return []; // Empty file = closed day.
    const inflated = lzmaDecompress(raw);
    return decodeDukascopyDay(inflated, d.dayStartMs, divisor);
  }

  throw new Error(`Dukascopy fetch failed for ${url}: ${lastError}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
