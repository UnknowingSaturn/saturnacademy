// Shared API-key + setup-token resolution.
//
// Identity is INSTALL-scoped, not account-scoped. An `x-api-key` header is,
// in priority order:
//   1) an active `mt5_installs.api_key`  — the canonical credential,
//   2) a legacy `accounts.api_key`       — accepted for one release, logged,
//   3) an unused, unexpired `setup_tokens.token` (bootstrap of a new install).
//
// All three give us a user_id. Callers route the event to the right account by
// (user_id, broker login) themselves. Account archival (`is_active = false`) is
// a DISPLAY decision and must never affect authentication.

export interface AccountForKey {
  id: string;
  user_id: string;
  terminal_id: string | null;
  account_number: string | null;
}

export interface InstallForKey {
  id: string;
  user_id: string;
  install_id: string;
  status: string;
}

export interface SetupTokenRow {
  user_id: string;
  used: boolean;
  sync_history_enabled: boolean | null;
  sync_history_from: string | null;
  copier_role: string | null;
  master_account_id: string | null;
}

export type ApiKeyReason =
  | "install"
  | "legacy_account_key"
  | "setup_token"
  | "revoked_install"
  | "unknown_key";

export interface ApiKeyResolution {
  userId: string | null;
  install: InstallForKey | null;
  accountForKey: AccountForKey | null;
  setupToken: SetupTokenRow | null;
  reason: ApiKeyReason;
}

/**
 * Resolve an `x-api-key` header to a user_id.
 * `userId: null` means the caller should 401 — `reason` says why.
 */
export async function resolveUserFromApiKey(
  supabase: any,
  apiKey: string,
): Promise<ApiKeyResolution> {
  // 1) Canonical: install-scoped credential.
  const { data: install } = await supabase
    .from("mt5_installs")
    .select("id, user_id, install_id, status")
    .eq("api_key", apiKey)
    .maybeSingle();

  if (install) {
    if (install.status !== "active") {
      return {
        userId: null,
        install: install as InstallForKey,
        accountForKey: null,
        setupToken: null,
        reason: "revoked_install",
      };
    }
    return {
      userId: install.user_id,
      install: install as InstallForKey,
      accountForKey: null,
      setupToken: null,
      reason: "install",
    };
  }

  // 2) Legacy: key still bound to an accounts row. Deliberately NOT filtered by
  //    is_active — archiving an account must not revoke a terminal.
  const { data: accountForKey } = await supabase
    .from("accounts")
    .select("id, user_id, terminal_id, account_number")
    .eq("api_key", apiKey)
    .limit(1)
    .maybeSingle();

  if (accountForKey?.user_id) {
    console.warn(
      "[apiKey] legacy account-scoped key in use for account",
      accountForKey.id,
      "— migrate this install to mt5_installs",
    );
    return {
      userId: accountForKey.user_id,
      install: null,
      accountForKey: accountForKey as AccountForKey,
      setupToken: null,
      reason: "legacy_account_key",
    };
  }

  // 3) Bootstrap: an unused, unexpired setup token.
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
      install: null,
      accountForKey: null,
      setupToken: tok as SetupTokenRow,
      reason: "setup_token",
    };
  }

  return {
    userId: null,
    install: null,
    accountForKey: null,
    setupToken: null,
    reason: "unknown_key",
  };
}

/**
 * Ensure an `mt5_installs` row exists for this (user, install_id) and stamp
 * last_seen_at. Called on every ingested event; cheap upsert, no-op on repeat.
 * Self-heals legacy installs onto the canonical credential model.
 */
export async function touchInstall(
  supabase: any,
  userId: string,
  installId: string | null | undefined,
  apiKey: string,
): Promise<void> {
  if (!installId) return;
  const { error } = await supabase
    .from("mt5_installs")
    .upsert(
      {
        user_id: userId,
        install_id: installId,
        api_key: apiKey,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,install_id", ignoreDuplicates: false },
    );
  if (error) {
    // A duplicate api_key across two installs is the only realistic failure;
    // never let bookkeeping break ingestion.
    console.warn("[apiKey] touchInstall failed (non-fatal):", error.message);
    await supabase
      .from("mt5_installs")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("install_id", installId);
  }
}
