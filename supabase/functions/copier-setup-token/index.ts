import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface TokenRequest {
  role: "master" | "receiver" | "independent";
  master_account_id?: string;
  sync_history_enabled?: boolean;
  sync_history_from?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with user's token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: TokenRequest = await req.json();
    const { role = "independent", master_account_id, sync_history_enabled = true, sync_history_from } = body;

    // Validate role
    if (!["master", "receiver", "independent"].includes(role)) {
      return new Response(
        JSON.stringify({ error: "Invalid role. Must be 'master', 'receiver', or 'independent'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If role is receiver, master_account_id should be provided
    if (role === "receiver" && !master_account_id) {
      console.warn("Creating receiver token without master_account_id - will need to be linked later");
    }

    // If master_account_id provided, verify it belongs to user and is a master account
    if (master_account_id) {
      const { data: masterAccount, error: masterError } = await supabase
        .from("accounts")
        .select("id, copier_role, user_id")
        .eq("id", master_account_id)
        .single();

      if (masterError || !masterAccount) {
        return new Response(
          JSON.stringify({ error: "Master account not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (masterAccount.copier_role !== "master") {
        return new Response(
          JSON.stringify({ error: "Specified account is not a master account" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Generate token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

    // Create setup token with copier role
    const { data: setupToken, error: insertError } = await supabase
      .from("setup_tokens")
      .insert({
        user_id: user.id,
        token,
        expires_at: expiresAt.toISOString(),
        copier_role: role,
        master_account_id: master_account_id || null,
        sync_history_enabled,
        sync_history_from: sync_history_from || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create setup token:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create setup token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Created setup token:", token, "role:", role, "master:", master_account_id);

    return new Response(
      JSON.stringify({
        token,
        expires_at: expiresAt.toISOString(),
        role,
        master_account_id: master_account_id || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
