// Public-facing shared report fetcher.
// Returns ONLY educational fields — strips $ amounts, R-multiples, lots, balances, etc.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface PublicTradeCard {
  id: string;
  symbol: string;
  direction: string;
  entry_time: string;
  session: string | null;
  playbook_name: string | null;
  screenshots: Array<{ url: string; timeframe: string; description: string | null }>;
  caption_what_went_well: string | null;
  caption_what_went_wrong: string | null;
  caption_what_to_improve: string | null;
  added_at: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug") || (await req.json().catch(() => ({}))).slug;
    if (!slug || typeof slug !== "string") {
      return json({ error: "slug required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Fetch report
    const { data: report, error: rErr } = await admin
      .from("shared_reports")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (rErr || !report) return json({ error: "Not found" }, 404);

    // Authorization: public+published OR owner via JWT
    const isPublished = report.visibility === "public_link" && report.published_at;
    let isOwner = false;
    const auth = req.headers.get("Authorization");
    if (auth?.startsWith("Bearer ")) {
      const token = auth.slice(7);
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user && user.id === report.user_id) isOwner = true;
    }

    if (!isPublished && !isOwner) return json({ error: "Not found" }, 404);

    // Fetch trades selected
    const { data: links } = await admin
      .from("shared_report_trades")
      .select("*")
      .eq("shared_report_id", report.id)
      .order("sort_order", { ascending: true });

    const tradeIds = (links || []).map(l => l.trade_id);
    let trades: any[] = [];
    if (tradeIds.length) {
      const { data: tradesData } = await admin
        .from("trades")
        .select("id,symbol,direction,entry_time,session,playbook_id,actual_playbook_id")
        .in("id", tradeIds);
      trades = tradesData || [];
    }

    // Fetch latest review per trade for screenshots
    let reviewsByTrade = new Map<string, any>();
    if (tradeIds.length) {
      const { data: reviewsData } = await admin
        .from("trade_reviews")
        .select("trade_id,screenshots,updated_at")
        .in("trade_id", tradeIds)
        .order("updated_at", { ascending: false });
      for (const r of (reviewsData || [])) {
        if (!reviewsByTrade.has(r.trade_id)) reviewsByTrade.set(r.trade_id, r);
      }
    }

    // Fetch playbook names
    const playbookIds = Array.from(new Set(
      trades.flatMap(t => [t.actual_playbook_id, t.playbook_id]).filter(Boolean)
    ));
    let playbookNames = new Map<string, string>();
    if (playbookIds.length) {
      const { data: pbs } = await admin.from("playbooks").select("id,name").in("id", playbookIds);
      for (const p of (pbs || [])) playbookNames.set(p.id, p.name);
    }

    // Build public cards (whitelist only) — apply per-trade overrides on top of live data
    const cards: PublicTradeCard[] = (links || []).map(link => {
      const t = trades.find(x => x.id === link.trade_id);
      if (!t) return null;
      const review = reviewsByTrade.get(t.id);
      const rawShots: any[] = Array.isArray(review?.screenshots) ? review.screenshots : [];
      const overrides: any[] = Array.isArray(link.screenshot_overrides) ? link.screenshot_overrides : [];

      // Apply per-screenshot overrides (description/timeframe/hidden/sort_index)
      const screenshots = rawShots
        .filter(s => s && typeof s === "object" && s.url)
        .map((s, idx) => {
          const ov = overrides.find((o: any) => o.id === s.id) || {};
          return {
            url: s.url,
            timeframe: String(ov.timeframe ?? s.timeframe ?? ""),
            description: ov.description ?? s.description ?? null,
            _hidden: !!ov.hidden,
            _sortIndex: typeof ov.sort_index === "number" ? ov.sort_index : 1000 + idx,
          };
        })
        .filter(s => !s._hidden)
        .sort((a, b) => a._sortIndex - b._sortIndex)
        .map(s => ({ url: s.url, timeframe: s.timeframe, description: s.description }));

      const pbId = t.actual_playbook_id || t.playbook_id;
      const livePlaybookName = pbId ? (playbookNames.get(pbId) || null) : null;

      // Apply header overrides (null override = fall back to live value)
      return {
        id: t.id,
        symbol: link.symbol_override ?? t.symbol,
        direction: link.direction_override ?? t.direction,
        entry_time: link.entry_time_override ?? t.entry_time,
        session: link.session_override ?? t.session,
        playbook_name: link.playbook_name_override ?? livePlaybookName,
        screenshots,
        caption_what_went_well: link.caption_what_went_well,
        caption_what_went_wrong: link.caption_what_went_wrong,
        caption_what_to_improve: link.caption_what_to_improve,
        added_at: link.created_at,
      };
    }).filter(Boolean) as PublicTradeCard[];

    // Increment view count when not the owner viewing
    if (!isOwner && isPublished) {
      await admin
        .from("shared_reports")
        .update({ view_count: (report.view_count || 0) + 1 })
        .eq("id", report.id);
    }

    return json({
      report: {
        id: report.id,
        slug: report.slug,
        title: report.title,
        intro: report.intro,
        period_start: report.period_start,
        period_end: report.period_end,
        author_display_name: report.author_display_name,
        published_at: report.published_at,
        view_count: report.view_count,
        live_mode: !!report.live_mode,
        live_started_at: report.live_started_at ?? null,
        updated_at: report.updated_at,
      },
      trades: cards,
      is_owner: isOwner,
    });
  } catch (e) {
    console.error("get-shared-report error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
