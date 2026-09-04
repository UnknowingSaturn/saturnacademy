// Account resolution for the ingest pipeline.
// Extracted verbatim from ingest-events/index.ts during the A-tranche split.
//
// Strategy: the API key identifies the USER. The actual account is resolved
// per-event by (user_id, account_info.login) so one MT5 terminal switching
// between prop accounts routes each event to the correct journal account.
// Falls back to install-sibling, then to any-account-for-key, then auto-create.

import { resolveUserFromApiKey, touchInstall } from "./apiKey.ts";
import type { EventPayload, ResolvedAccount } from "./eventTypes.ts";

export interface ResolveResult {
  account: ResolvedAccount;
  brokerLogin: string | null;
  brokerUtcOffset: number | null;
}

/**
 * MT5 terminal ids are shaped `MT5_<login>_<brokerPrefix>`. Sync payloads
 * (history / open-position) omit `account_info`, so the terminal id is the only
 * carrier of the login. Without this the resolver used to fall back to an
 * arbitrary install sibling and scatter one position across several accounts.
 */
export function loginFromTerminalId(terminalId?: string | null): string | null {
  if (!terminalId) return null;
  const m = /^MT5_(\d+)_/.exec(terminalId);
  if (!m) return null;
  return m[1] === "0" ? null : m[1];
}

export class ResolveError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function resolveAccount(
  supabase: any,
  apiKey: string,
  payload: EventPayload,
): Promise<ResolveResult> {
  // Step 1: API key → user (install-scoped credential first, legacy fallbacks)
  const keyRes = await resolveUserFromApiKey(supabase, apiKey);
  const anyAccountForKey = keyRes.accountForKey;
  const setupTokenRow: any = keyRes.setupToken;
  const userIdForKey: string | null = keyRes.userId;

  if (!userIdForKey) {
    if (keyRes.reason === "revoked_install") {
      throw new ResolveError(
        "Revoked install: this MT5 installation's access was revoked",
        401,
      );
    }
    throw new ResolveError("Unknown API key: no install, account or setup token matches", 401);
  }

  // Keep the install registry current (and self-heal legacy installs onto it).
  await touchInstall(supabase, userIdForKey, payload.install_id, apiKey);

  // Step 2: target account by broker login.
  // NOTE: deliberately not filtered by is_active — archiving an account is a
  // display decision; its trades must keep landing on the same row.
  // Login sources, in order of trust: account_info (live events) →
  // active_login (v4 EA) → the login embedded in the terminal id (sync events).
  const brokerLogin = payload.account_info?.login != null
    ? String(payload.account_info.login)
    : payload.active_login
    ? String(payload.active_login)
    : loginFromTerminalId(payload.terminal_id);

  let account: ResolvedAccount | null = null;
  let brokerUtcOffset: number | null = null;

  if (brokerLogin) {
    const { data: byLogin } = await supabase
      .from("accounts")
      .select("id, user_id, terminal_id, broker_utc_offset")
      .eq("user_id", userIdForKey)
      .eq("account_number", brokerLogin)
      .order("is_active", { ascending: false })
      .order("last_heartbeat_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (byLogin) {
      account = byLogin;
      brokerUtcOffset = typeof byLogin.broker_utc_offset === "number"
        ? byLogin.broker_utc_offset
        : null;
    }
  }

  // Sibling on same MT5 install — template for auto-create. Archived siblings
  // are still valid templates (broker, DST, copier + sync settings).
  // Ordered by created_at so the template is STABLE: ordering by
  // last_heartbeat_at rotated between siblings on every event.
  let installSibling: any = null;
  if (!account && payload.install_id) {
    const { data: byInstall } = await supabase
      .from("accounts")
      .select(
        "id, user_id, terminal_id, api_key, copier_role, master_account_id, sync_history_enabled, sync_history_from, account_type, prop_firm, broker, broker_utc_offset, broker_dst_profile, is_active",
      )
      .eq("user_id", userIdForKey)
      .eq("mt5_install_id", payload.install_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    installSibling = byInstall ?? null;
    // A sibling is a SETTINGS TEMPLATE only. It may own the event solely when
    // the payload carries no login at all (legacy EA, no terminal id pattern).
    if (installSibling && !brokerLogin) {
      account = {
        id: installSibling.id,
        user_id: installSibling.user_id,
        terminal_id: installSibling.terminal_id,
      };
      brokerUtcOffset = typeof installSibling.broker_utc_offset === "number"
        ? installSibling.broker_utc_offset
        : null;
    }
  }

  // Fallback for older EA that sends no login of any kind
  if (!account && !brokerLogin && anyAccountForKey) {
    account = {
      id: anyAccountForKey.id,
      user_id: anyAccountForKey.user_id,
      terminal_id: anyAccountForKey.terminal_id,
    };
  }

  // Auto-create when we know the login but have no matching account row.
  // account_info may be absent (history / open-position sync) — the sibling
  // template plus the login is enough to open the correct row.
  if (!account && brokerLogin) {
    console.log("No account found for login", brokerLogin, "— auto-creating");

    // A known install (or any account bound to the key, or a fresh setup token)
    // is sufficient authority to onboard a new login automatically.
    const allowAutoCreate = !!keyRes.install || !!installSibling ||
      !!anyAccountForKey || (setupTokenRow && !setupTokenRow.used);
    if (!allowAutoCreate) {
      throw new ResolveError(
        "Unknown install: cannot onboard a new login without a known MT5 install or setup token",
        401,
      );
    }

    const info = payload.account_info;

    const setupToken = setupTokenRow ?? {
      user_id: userIdForKey,
      used: false,
      sync_history_enabled: true,
      sync_history_from: null,
      copier_role: "independent",
      master_account_id: null,
    };

    const shouldConsumeToken = setupTokenRow && !setupTokenRow.used &&
      !anyAccountForKey && !keyRes.install;

    let propFirm: string | null = installSibling?.prop_firm ?? null;
    if (!propFirm) {
      const serverLower = (info?.server || "").toLowerCase();
      if (serverLower.includes("ftmo")) propFirm = "ftmo";
      else if (serverLower.includes("fundednext")) propFirm = "fundednext";
    }

    const copierRole = installSibling?.copier_role ?? (setupToken.copier_role || "independent");
    const isCopierAccount = copierRole !== "independent";

    const brokerName = installSibling?.broker ?? info?.broker ?? "MT5";
    const accountName = `${brokerName} - ${brokerLogin}`;
    const insertPayload: Record<string, unknown> = {
      user_id: setupToken.user_id,
      name: accountName,
      broker: brokerName,
      account_number: brokerLogin,
      account_type: installSibling?.account_type ?? info?.account_type ?? "prop",
      balance_start: info?.balance ?? null,
      equity_current: info?.equity ?? null,
      terminal_id: payload.terminal_id,
      mt5_install_id: payload.install_id || null,
      last_sync_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      live_state: "live",
      api_key: installSibling?.api_key ?? apiKey,
      prop_firm: propFirm,
      is_active: true,
      sync_history_enabled: installSibling?.sync_history_enabled ?? (setupToken.sync_history_enabled ?? true),
      sync_history_from: installSibling?.sync_history_from ?? setupToken.sync_history_from,
      copier_role: copierRole,
      copier_enabled: isCopierAccount,
      master_account_id: installSibling?.master_account_id ?? (setupToken.master_account_id || null),
    };
    if (typeof installSibling?.broker_utc_offset === "number") {
      insertPayload.broker_utc_offset = installSibling.broker_utc_offset;
    }
    if (installSibling?.broker_dst_profile) {
      insertPayload.broker_dst_profile = installSibling.broker_dst_profile;
    }

    let { data: newAccount, error: createError } = await supabase
      .from("accounts")
      .insert(insertPayload)
      .select("id, user_id, terminal_id, broker_utc_offset")
      .single();

    // Race: concurrent event already created this (user_id, install_id, login)
    if (createError && (createError.code === "23505" || /duplicate key/i.test(createError.message || ""))) {
      const { data: existing } = await supabase
        .from("accounts")
        .select("id, user_id, terminal_id, broker_utc_offset")
        .eq("user_id", setupToken.user_id)
        .eq("account_number", brokerLogin)
        .maybeSingle();
      if (existing) {
        newAccount = existing;
        createError = null as any;
      }
    }

    if (createError) {
      console.error("Failed to create account:", createError);
      throw new ResolveError("Failed to create account: " + createError.message, 500);
    }

    if (shouldConsumeToken) {
      await supabase
        .from("setup_tokens")
        .update({ used: true, used_at: new Date().toISOString() })
        .eq("token", apiKey);
    }

    account = newAccount;
    if (typeof (newAccount as any)?.broker_utc_offset === "number") {
      brokerUtcOffset = (newAccount as any).broker_utc_offset;
    }
    console.log(
      "Auto-created account:",
      account!.id,
      accountName,
      "login:",
      brokerLogin,
      "from_sibling:",
      !!installSibling,
    );
  }

  if (!account) {
    throw new ResolveError("No matching account for broker login", 401);
  }

  // Backfill terminal_id and install_id on the account row
  const accountBackfill: Record<string, unknown> = {};
  if (!account.terminal_id && payload.terminal_id) accountBackfill.terminal_id = payload.terminal_id;
  if (payload.install_id) accountBackfill.mt5_install_id = payload.install_id;
  if (Object.keys(accountBackfill).length > 0) {
    await supabase.from("accounts").update(accountBackfill).eq("id", account.id);
  }

  return { account, brokerLogin, brokerUtcOffset };
}

/**
 * Per-event side effects that fire on EVERY event type:
 *  - bump last_heartbeat_at + flip live_state back to 'live'
 *  - opportunistic equity_current refresh
 *  - per-minute balance snapshot for the multi-account equity curve
 */
export async function applyPerEventSideEffects(
  supabase: any,
  account: ResolvedAccount,
  payload: EventPayload,
): Promise<void> {
  const liveBump: Record<string, unknown> = {
    last_heartbeat_at: new Date().toISOString(),
    live_state: "live",
  };
  if (payload.account_info?.equity) liveBump.equity_current = payload.account_info.equity;
  await supabase.from("accounts").update(liveBump).eq("id", account.id);

  if (payload.account_info?.balance != null) {
    const nowMs = Date.now();
    const recordedMinute = Math.floor(nowMs / 60000);
    const { error: snapErr } = await supabase
      .from("account_balance_snapshots")
      .insert({
        account_id: account.id,
        user_id: account.user_id,
        balance: payload.account_info.balance,
        equity: payload.account_info.equity ?? null,
        free_margin: payload.margin_free ?? null,
        recorded_at: new Date(nowMs).toISOString(),
        recorded_minute: recordedMinute,
      });
    if (snapErr && snapErr.code !== "23505") {
      console.error("Failed to insert balance snapshot (non-fatal):", snapErr.message);
    }
  }
}
