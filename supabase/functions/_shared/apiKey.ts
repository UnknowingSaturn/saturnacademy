// Shared API-key + setup-token resolution.
//
// EA traffic carries an `x-api-key` header. That key is either:
//   1) bound to an existing `accounts` row via `accounts.api_key`, OR
//   2) an unused `setup_tokens.token` (bootstrap flow).
//
// Both paths give us a user_id. Callers then route the event to the right
// account by (user_id, broker login) themselves.

export interface AccountForKey {
  id: string;
  user_id: string;
  terminal_id: string | null;
  account_number: string | null;
}

export interface SetupTokenRow {
  user_id: string;
  used: boolean;
  sync_history_enabled: boolean | null;
  sync_history_from: string | null;
  copier_role: string | null;
  master_account_id: string | null;
}

export interface ApiKeyResolution {
  userId: string | null;
  accountForKey: AccountForKey | null;
  setupToken: SetupTokenRow | null;
}

/**
 * Resolve an `x-api-key` header to a user_id.
 * Returns `userId: null` when the key is neither bound to an account nor a
 * valid, unused setup token — callers should treat that as 401.
 */
export async function resolveUserFromApiKey(
  supabase: any,
  apiKey: string,
): Promise<ApiKeyResolution> {
  const { data: accountForKey } = await supabase
    .from("accounts")
    .select("id, user_id, terminal_id, account_number")
    .eq("api_key", apiKey)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (accountForKey?.user_id) {
    return {
      userId: accountForKey.user_id,
      accountForKey: accountForKey as AccountForKey,
      setupToken: null,
    };
  }

  const { data: tok } = await supabase
    .from("setup_tokens")
    .select(
      "user_id, used, sync_history_enabled, sync_history_from, copier_role, master_account_id",
    )
    .eq("token", apiKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (tok && !tok.used) {
    return {
      userId: tok.user_id,
      accountForKey: null,
      setupToken: tok as SetupTokenRow,
    };
  }

  return { userId: null, accountForKey: null, setupToken: null };
}
