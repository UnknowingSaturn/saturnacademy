import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Normalize symbol by removing broker-specific suffixes
function normalizeSymbol(symbol: string): string {
  // Remove common broker suffixes like +, ., m, micro, mini, etc.
  return symbol
    .replace(/[+\.]+$/g, '')           // Trailing + or .
    .replace(/[_\\-]?(m|micro|mini)$/i, '') // _m, -m, micro, mini
    .replace(/\.a|\.b|\.c$/i, '')        // .a, .b, .c suffixes
    .toUpperCase();
}

// Check if two trades should be grouped
// Same normalized symbol, same direction, entry times within windowSeconds
function shouldGroup(trade1: any, trade2: any, windowSeconds: number = 60): boolean {
  const sym1 = normalizeSymbol(trade1.symbol);
  const sym2 = normalizeSymbol(trade2.symbol);
  
  if (sym1 !== sym2) return false;
  if (trade1.direction !== trade2.direction) return false;
  
  const time1 = new Date(trade1.entry_time).getTime();
  const time2 = new Date(trade2.entry_time).getTime();
  const diffSeconds = Math.abs(time1 - time2) / 1000;
  
  return diffSeconds <= windowSeconds;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { user_id, trade_id, window_seconds = 60 } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ status: "error", message: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Auto-grouping trades for user:", user_id, "trade_id:", trade_id || "all");

    // If a specific trade_id is provided, just group that trade
    // Otherwise, process all ungrouped trades
    let tradesToProcess;
    
    if (trade_id) {
      // Get the specific trade
      const { data: specificTrade, error: tradeError } = await supabase
        .from("trades")
        .select("*")
        .eq("id", trade_id)
        .eq("user_id", user_id)
        .single();

      if (tradeError || !specificTrade) {
        console.error("Trade not found:", tradeError);
        return new Response(
          JSON.stringify({ status: "error", message: "Trade not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      tradesToProcess = [specificTrade];
    } else {
      // Get all ungrouped, non-archived trades for this user
      const { data: ungroupedTrades, error: fetchError } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", user_id)
        .is("trade_group_id", null)
        .eq("is_archived", false)
        .order("entry_time", { ascending: true });

      if (fetchError) {
        console.error("Error fetching trades:", fetchError);
        return new Response(
          JSON.stringify({ status: "error", message: fetchError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      tradesToProcess = ungroupedTrades || [];
    }

    console.log("Trades to process:", tradesToProcess.length);

    let groupsCreated = 0;
    let tradesGrouped = 0;

    // For each trade, find matching trades and create/assign groups
    const processedTradeIds = new Set<string>();

    for (const trade of tradesToProcess) {
      if (processedTradeIds.has(trade.id)) continue;

      // Find all trades that should be grouped with this one
      // Check both ungrouped trades and trades in existing groups
      const { data: potentialMatches } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", user_id)
        .eq("direction", trade.direction)
        .eq("is_archived", false)
        .neq("id", trade.id)
        .gte("entry_time", new Date(new Date(trade.entry_time).getTime() - window_seconds * 1000).toISOString())
        .lte("entry_time", new Date(new Date(trade.entry_time).getTime() + window_seconds * 1000).toISOString());

      const matchingTrades = (potentialMatches || []).filter(
        (t: any) => shouldGroup(trade, t, window_seconds)
      );

      if (matchingTrades.length === 0) {
        // No matches, skip this trade (it remains ungrouped as a solo trade)
        processedTradeIds.add(trade.id);
        continue;
      }

      // Check if any matching trade already has a group
      const existingGroupId = matchingTrades.find((t: any) => t.trade_group_id)?.trade_group_id;

      let groupId: string;

      if (existingGroupId) {
        // Add to existing group
        groupId = existingGroupId;
        console.log("Adding trade to existing group:", groupId);
      } else if (trade.trade_group_id) {
        // This trade already has a group, add matches to it
        groupId = trade.trade_group_id;
        console.log("Adding matches to trade's existing group:", groupId);
      } else {
        // Create new group
        const firstEntryTime = [trade, ...matchingTrades]
          .map(t => new Date(t.entry_time).getTime())
          .reduce((a, b) => Math.min(a, b), Infinity);

        const { data: newGroup, error: groupError } = await supabase
          .from("trade_groups")
          .insert({
            user_id: user_id,
            symbol: normalizeSymbol(trade.symbol),
            direction: trade.direction,
            first_entry_time: new Date(firstEntryTime).toISOString(),
            playbook_id: trade.playbook_id,
          })
          .select()
          .single();

        if (groupError) {
          console.error("Error creating group:", groupError);
          continue;
        }

        groupId = newGroup.id;
        groupsCreated++;
        console.log("Created new group:", groupId, "for symbol:", trade.symbol);
      }

      // Update all matching trades to belong to this group
      const tradeIdsToUpdate = [trade.id, ...matchingTrades.map((t: any) => t.id)];
      
      const { error: updateError } = await supabase
        .from("trades")
        .update({ trade_group_id: groupId })
        .in("id", tradeIdsToUpdate);

      if (updateError) {
        console.error("Error updating trades with group:", updateError);
      } else {
        tradesGrouped += tradeIdsToUpdate.length;
        tradeIdsToUpdate.forEach(id => processedTradeIds.add(id));
        console.log("Grouped trades:", tradeIdsToUpdate.length, "in group:", groupId);
      }
    }

    console.log("Auto-grouping complete. Groups created:", groupsCreated, "Trades grouped:", tradesGrouped);

    return new Response(
      JSON.stringify({
        status: "success",
        groups_created: groupsCreated,
        trades_grouped: tradesGrouped,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in auto-group-trades:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ status: "error", message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
