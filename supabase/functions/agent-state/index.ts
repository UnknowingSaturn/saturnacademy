// Receives telemetry from the desktop agent and upserts into agent_state.
// Auth: x-api-key resolves to a user_id via shared apiKey helper.
//
// Body:
// {
//   install_id: string;
//   status?: string;           // running | paused | error
//   version?: string;
//   terminals?: any[];         // discovered terminals + EA status
//   receivers_status?: any[];  // [{ account_id, paused, last_execution_at, ... }]
//   last_error?: string | null;
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { resolveUserFromApiKey } from "../_shared/apiKey.ts";

Deno.serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKey) return jsonResponse({ error: "missing_api_key" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { userId } = await resolveUserFromApiKey(supabase, apiKey);
  if (!userId) return jsonResponse({ error: "invalid_api_key" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const installId = String(body?.install_id ?? "").trim();
  if (!installId) return jsonResponse({ error: "install_id_required" }, 400);

  const row = {
    user_id: userId,
    install_id: installId,
    status: body.status ?? "running",
    version: body.version ?? null,
    last_heartbeat_at: new Date().toISOString(),
    terminals: Array.isArray(body.terminals) ? body.terminals : [],
    receivers_status: Array.isArray(body.receivers_status)
      ? body.receivers_status
      : [],
    last_error: body.last_error ?? null,
  };

  const { error } = await supabase
    .from("agent_state")
    .upsert(row, { onConflict: "user_id,install_id" });

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ ok: true });
});
