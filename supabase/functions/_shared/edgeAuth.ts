// Shared auth + response helpers for edge functions.
//
// Before: every authenticated edge function (trade-repair, trade-rebuild,
// generate-report, knowledge-chat, extract-knowledge, get-shared-report,
// playbook-assistant, copier-setup-token) hand-rolled the same 8-12 lines
// of "read Authorization header → anon client → getUser() → service client".
// Bugs fixed in one copy never made it to the others. This module is the
// single source of truth.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

/** Standard JSON response with CORS. Replaces the 4+ private copies. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface AuthContext {
  /** Authenticated user id (from the JWT). */
  userId: string;
  /** Service-role client — bypasses RLS. Use for cross-row writes. */
  admin: SupabaseClient;
  /** User-scoped client — respects RLS. Use when you want safety nets. */
  userClient: SupabaseClient;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve the caller's user from the `Authorization: Bearer <jwt>` header
 * and return both an admin (service-role) and a user-scoped client.
 *
 * Throws `AuthError` (401) when the header is missing or the JWT is invalid.
 * Callers should catch and forward via `json({ error }, err.status)`.
 */
export async function requireUser(req: Request): Promise<AuthContext> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new AuthError("Server misconfigured: missing Supabase env vars", 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) throw new AuthError("Not authenticated", 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) throw new AuthError("Not authenticated", 401);

  const admin = createClient(supabaseUrl, serviceKey);
  return { userId: data.user.id, admin, userClient };
}

/**
 * Verify the given account belongs to `userId`. Returns the account row.
 * Throws `AuthError` (404 not found, 403 wrong owner) on mismatch.
 */
export async function requireOwnedAccount(
  admin: SupabaseClient,
  userId: string,
  accountId: string,
  columns = "*",
): Promise<Record<string, any>> {
  const { data: account, error } = await admin
    .from("accounts")
    .select(columns)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new AuthError(error.message, 500);
  if (!account) throw new AuthError("Account not found", 404);
  if ((account as any).user_id !== userId) throw new AuthError("Forbidden", 403);
  return account as Record<string, any>;
}
