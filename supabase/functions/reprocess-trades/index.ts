import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeRMultiple } from "../_shared/rMultiple.ts";
import { classifySession, DEFAULT_SESSIONS, SessionDefinition } from "../_shared/session.ts";
import { corsHeaders } from "../_shared/cors.ts";

interface ReprocessRequest {
  account_id: string;
  use_custom_sessions?: boolean;
}

// computeRMultiple + pip helpers in ../_shared/rMultiple.ts
// session classifier + DEFAULT_SESSIONS in ../_shared/session.ts

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate caller and enforce account ownership
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const callerId = userData.user.id;

    const { account_id, use_custom_sessions = true }: ReprocessRequest = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: "account_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get account data
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: "Account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (account.user_id !== callerId) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`Recalculating trade data for account ${account_id}`);

    // Fetch user's custom session definitions if enabled
    let sessions: SessionDefinition[] = DEFAULT_SESSIONS;
    
    if (use_custom_sessions) {
      const { data: customSessions, error: sessionsError } = await supabase
        .from("session_definitions")
        .select("*")
        .eq("user_id", account.user_id)
        .eq("is_active", true)
        .order("sort_order");

      if (!sessionsError && customSessions && customSessions.length > 0) {
        sessions = customSessions as SessionDefinition[];
        console.log(`Using ${sessions.length} custom session definitions`);
      } else {
        console.log("Using default session definitions");
      }
    }

    // Fetch all trades for this account with their typed partial fills.
    const { data: trades, error: tradesError } = await supabase
      .from("trades")
      .select("*, trade_partial_fills(occurred_at, lots, price, profit, commission, swap)")
      .eq("account_id", account_id)
      .order("entry_time", { ascending: true });

    if (tradesError) {
      console.error("Error fetching trades:", tradesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch trades" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!trades || trades.length === 0) {
      return new Response(
        JSON.stringify({ message: "No trades to recalculate", trades_updated: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${trades.length} trades to recalculate`);

    let updatedCount = 0;
    let runningBalance = account.balance_start || 0;

    // Sort closed trades by entry_time for proper equity tracking
    const closedTrades = trades.filter(t => !t.is_open).sort(
      (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
    );
    const openTrades = trades.filter(t => t.is_open);

    // Process closed trades first to build equity history
    for (const trade of closedTrades) {
      try {
        // Use entry_time directly - it's already in UTC from ingestion
        const entryTime = new Date(trade.entry_time);

        // Calculate session from entry time using custom or default sessions
        const session = classifySession(entryTime, sessions);

        // Calculate R-multiple, preferring derivation from realized PnL
        const rMultiple = computeRMultiple({
          entryPrice: trade.entry_price,
          exitPrice: trade.exit_price,
          slPrice: trade.sl_initial || trade.sl_final,
          lots: trade.original_lots || trade.total_lots,
          grossPnl: trade.gross_pnl,
          netPnl: trade.net_pnl,
          symbol: trade.symbol,
          equityAtEntry: trade.equity_at_entry || runningBalance,
          direction: trade.direction,
          fills: Array.isArray(trade.trade_partial_fills) && trade.trade_partial_fills.length > 0
            ? trade.trade_partial_fills.map((f: any) => ({
                time: f.occurred_at,
                lots: Number(f.lots),
                price: Number(f.price),
                pnl: (Number(f.profit) || 0) - (Number(f.commission) || 0) - Math.abs(Number(f.swap) || 0),
              }))
            : null,
        });

        // Update the trade - only session, balance, and R%
        const { error: updateError } = await supabase
          .from("trades")
          .update({
            session: session,
            balance_at_entry: runningBalance,
            r_multiple_actual: rMultiple,
          })
          .eq("id", trade.id);

        if (updateError) {
          console.error(`Error updating trade ${trade.id}:`, updateError);
        } else {
          updatedCount++;
          // Update running balance for next trade
          if (trade.net_pnl !== null) {
            runningBalance += trade.net_pnl;
          }
        }
      } catch (err) {
        console.error(`Error processing trade ${trade.id}:`, err);
      }
    }

    // Process open trades
    for (const trade of openTrades) {
      try {
        const entryTime = new Date(trade.entry_time);
        const session = classifySession(entryTime, sessions);

        const { error: updateError } = await supabase
          .from("trades")
          .update({
            session: session,
            balance_at_entry: runningBalance,
          })
          .eq("id", trade.id);

        if (updateError) {
          console.error(`Error updating open trade ${trade.id}:`, updateError);
        } else {
          updatedCount++;
        }
      } catch (err) {
        console.error(`Error processing open trade ${trade.id}:`, err);
      }
    }

    console.log(`Recalculation complete. Updated ${updatedCount} trades.`);

    return new Response(
      JSON.stringify({
        message: "Trade data recalculated successfully",
        trades_updated: updatedCount,
        sessions_used: sessions.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in reprocess-trades:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Session classifier moved to ../_shared/session.ts (classifySession honors each
// session's own .timezone field — does NOT hardcode America/New_York).
