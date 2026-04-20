// Hourly scheduler. For each user, decides whether a weekly (Saturday) or monthly
// (1st-of-month) report should be generated in their broker timezone, then invokes
// generate-report. Idempotent via report_schedule_runs.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function shiftHours(d: Date, hours: number) { return new Date(d.getTime() + hours * 3600 * 1000); }

function lastSaturdayBoundary(nowUtc: Date, offsetHours: number): { start: Date; end: Date } | null {
  const local = shiftHours(nowUtc, offsetHours);
  // Trigger window: Saturday 09:00–10:00 local
  if (local.getUTCDay() !== 6 || local.getUTCHours() !== 9) return null;
  // The "just-ended week" = previous Mon 00:00 → Sat 00:00 local
  const satMidnightLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0));
  const monMidnightLocal = new Date(satMidnightLocal.getTime() - 5 * 86400000);
  // convert local→utc by subtracting offset
  const start = shiftHours(monMidnightLocal, -offsetHours);
  const end = shiftHours(satMidnightLocal, -offsetHours);
  return { start, end };
}

function lastMonthBoundary(nowUtc: Date, offsetHours: number): { start: Date; end: Date } | null {
  const local = shiftHours(nowUtc, offsetHours);
  // Trigger window: 1st of month, 09:00–10:00 local
  if (local.getUTCDate() !== 1 || local.getUTCHours() !== 9) return null;
  const firstOfThis = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 0, 0, 0));
  const firstOfPrev = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1, 0, 0, 0));
  const start = shiftHours(firstOfPrev, -offsetHours);
  const end = shiftHours(firstOfThis, -offsetHours);
  return { start, end };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    // Distinct user_ids that have at least one account
    const { data: accounts, error: accErr } = await admin
      .from('accounts')
      .select('user_id, broker_utc_offset')
      .eq('is_active', true);
    if (accErr) throw accErr;

    const offsetByUser = new Map<string, number>();
    for (const a of accounts || []) {
      // Use most recent (or simply average) — pick max so we err on later trigger
      const cur = offsetByUser.get(a.user_id);
      const off = a.broker_utc_offset ?? 2;
      if (cur === undefined || off > cur) offsetByUser.set(a.user_id, off);
    }

    const results: any[] = [];

    for (const [user_id, offset] of offsetByUser) {
      const tasks: Array<{ type: 'weekly' | 'monthly'; start: Date; end: Date }> = [];
      const wk = lastSaturdayBoundary(now, offset);
      if (wk) tasks.push({ type: 'weekly', start: wk.start, end: wk.end });
      const mo = lastMonthBoundary(now, offset);
      if (mo) tasks.push({ type: 'monthly', start: mo.start, end: mo.end });

      for (const task of tasks) {
        const period_start = task.start.toISOString();
        const period_end = task.end.toISOString();

        // Idempotency check
        const { data: existingRun } = await admin
          .from('report_schedule_runs')
          .select('id')
          .eq('user_id', user_id)
          .eq('report_type', task.type)
          .eq('period_start', period_start)
          .maybeSingle();
        if (existingRun) { results.push({ user_id, type: task.type, skipped: 'already_attempted' }); continue; }

        // Check for trades
        const { count } = await admin
          .from('trades')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user_id)
          .eq('trade_type', 'executed')
          .gte('entry_time', period_start)
          .lt('entry_time', period_end);

        if (!count || count === 0) {
          await admin.from('report_schedule_runs').insert({
            user_id, report_type: task.type, period_start, status: 'skipped_no_trades',
          });
          results.push({ user_id, type: task.type, skipped: 'no_trades' });
          continue;
        }

        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/generate-report`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ user_id, period_start, period_end, report_type: task.type }),
          });
          const json = await resp.json();
          await admin.from('report_schedule_runs').insert({
            user_id, report_type: task.type, period_start,
            status: resp.ok ? 'success' : 'failed',
            report_id: json?.report?.id || null,
            error_message: resp.ok ? null : (json?.error || `HTTP ${resp.status}`),
          });
          results.push({ user_id, type: task.type, status: resp.ok ? 'success' : 'failed' });
        } catch (e) {
          await admin.from('report_schedule_runs').insert({
            user_id, report_type: task.type, period_start,
            status: 'failed', error_message: e instanceof Error ? e.message : String(e),
          });
          results.push({ user_id, type: task.type, status: 'failed' });
        }
      }
    }

    return new Response(JSON.stringify({ ran_at: now.toISOString(), results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("schedule-reports error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
