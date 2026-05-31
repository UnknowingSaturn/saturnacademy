// Command queue for the desktop agent.
//
// Desktop (x-api-key):
//   GET  ?install_id=...           → pending commands for this install
//   PATCH { id, status, result?, error_message? }
//
// Web (JWT auth, handled automatically by supabase.functions.invoke):
//   POST { install_id, command, payload? } → inserts a pending command

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { resolveUserFromApiKey } from "../_shared/apiKey.ts";

const VALID_COMMANDS = new Set([
  "pause_receiver",
  "resume_receiver",
  "sync_positions",
  "rescan_terminals",
  "reload_config",
]);

Deno.serve(async (req) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const apiKey = req.headers.get("x-api-key");
  const auth = req.headers.get("authorization");

  // Resolve user — desktop via x-api-key, web via JWT.
  let userId: string | null = null;
  if (apiKey) {
    const res = await resolveUserFromApiKey(service, apiKey);
    userId = res.userId;
  } else if (auth?.startsWith("Bearer ")) {
    const { data } = await service.auth.getUser(auth.slice(7));
    userId = data.user?.id ?? null;
  }
  if (!userId) return jsonResponse({ error: "unauthorized" }, 401);

  const url = new URL(req.url);

  if (req.method === "GET") {
    const installId = url.searchParams.get("install_id");
    if (!installId) return jsonResponse({ error: "install_id_required" }, 400);
    const { data, error } = await service
      .from("agent_commands")
      .select("*")
      .eq("user_id", userId)
      .eq("install_id", installId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ commands: data ?? [] });
  }

  if (req.method === "PATCH") {
    const body = await req.json().catch(() => null);
    if (!body?.id || !body?.status) {
      return jsonResponse({ error: "id_and_status_required" }, 400);
    }
    const patch: Record<string, unknown> = { status: body.status };
    if (body.status === "acked") patch.acked_at = new Date().toISOString();
    if (body.status === "done" || body.status === "error") {
      patch.completed_at = new Date().toISOString();
    }
    if (body.result !== undefined) patch.result = body.result;
    if (body.error_message !== undefined) patch.error_message = body.error_message;

    const { error } = await service
      .from("agent_commands")
      .update(patch)
      .eq("id", body.id)
      .eq("user_id", userId);
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ ok: true });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    const command = String(body?.command ?? "");
    const installId = String(body?.install_id ?? "");
    if (!installId) return jsonResponse({ error: "install_id_required" }, 400);
    if (!VALID_COMMANDS.has(command)) {
      return jsonResponse({ error: "invalid_command" }, 400);
    }
    const { data, error } = await service
      .from("agent_commands")
      .insert({
        user_id: userId,
        install_id: installId,
        command,
        payload: body.payload ?? {},
      })
      .select("id")
      .single();
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ id: data.id });
  }

  return jsonResponse({ error: "method_not_allowed" }, 405);
});
