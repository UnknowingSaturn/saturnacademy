// Account resolution for the ingest pipeline.
// Extracted verbatim from ingest-events/index.ts during the A-tranche split.
//
// Strategy: the API key identifies the USER. The actual account is resolved
// per-event by (user_id, account_info.login) so one MT5 terminal switching
// between prop accounts routes each event to the correct journal account.
// Falls back to install-sibling, then to any-account-for-key, then auto-create.

import { resolveUserFromApiKey } from "./apiKey.ts";
import type { EventPayload, ResolvedAccount } from "./eventTypes.ts";

export interface ResolveResult {
  account: ResolvedAccount;
  brokerLogin: string | null;
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
  // Step 1: API key → user
  const keyRes = await resolveUserFromApiKey(supabase, apiKey);
  const anyAccountForKey = keyRes.accountForKey;
  const setupTokenRow: any = keyRes.setupToken;
  const userIdForKey: string | null = keyRes.userId;

  if (!userIdForKey) {
    throw new ResolveError("Invalid API key", 401);
  }

  // Step 2: target account by broker login
  const brokerLogin = payload.account_info?.login != null
    ? String(payload.account_info.login)
    : null;

  let account: ResolvedAccount | null = null;

  if (brokerLogin) {
    const { data: byLogin } = await supabase
      .from("accounts")
      .select("id, user_id, terminal_id")
      .eq("user_id", userIdForKey)
      .eq("account_number", brokerLogin)
      .eq("is_active", true)
      .maybeSingle();
    account = byLogin ?? null;
  }

  // Sibling on same MT5 install — template for auto-create.
  let installSibling: any = null;
  if (!account && payload.install_id) {
    const { data: byInstall } = await supabase
      .from("accounts")
      .select(
        "id, user_id, terminal_id, api_key, copier_role, master_account_id, sync_history_enabled, sync_history_from, account_type, prop_firm, broker, broker_utc_offset, broker_dst_profile",
      )
      .eq("user_id", userIdForKey)
      .eq("mt5_install_id", payload.install_id)
      .eq("is_active", true)
      .order("last_heartbeat_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    installSibling = byInstall ?? null;
    // Adopt sibling as-is only when this event carries NO broker login
    // (legacy EA without account_info).
    if (installSibling && !brokerLogin) {
      account = {
        id: installSibling.id,
        user_id: installSibling.user_id,
        terminal_id: installSibling.terminal_id,
      };
    }
  }

  // Fallback for older EA without account_info
  if (!account && anyAccountForKey) {
    account = {
      id: anyAccountForKey.id,
      user_id: anyAccountForKey.user_id,
      terminal_id: anyAccountForKey.terminal_id,
    };
  }

  // Auto-create when we have account_info but no matching account row
  if (!account && payload.account_info) {
    console.log("No account found for login", brokerLogin, "— auto-creating");

    const allowAutoCreate = !!anyAccountForKey || (setupTokenRow && !setupTokenRow.used);
    if (!allowAutoCreate) {
      throw new ResolveError("Invalid API key", 401);
    }

    const setupToken = setupTokenRow ?? {
      user_id: userIdForKey,
      used: false,
      sync_history_enabled: true,
      sync_history_from: null,
      copier_role: "independent",
      master_account_id: null,
    };

    const shouldConsumeToken = setupTokenRow && !setupTokenRow.used && !anyAccountForKey;

    let propFirm: string | null = installSibling?.prop_firm ?? null;
    if (!propFirm) {
      const serverLower = (payload.account_info.server || "").toLowerCase();
      if (serverLower.includes("ftmo")) propFirm = "ftmo";
      else if (serverLower.includes("fundednext")) propFirm = "fundednext";
    }

    const copierRole = installSibling?.copier_role ?? (setupToken.copier_role || "independent");
    const isCopierAccount = copierRole !== "independent";

    const accountName = `${payload.account_info.broker} - ${payload.account_info.login}`;
    const insertPayload: Record<string, unknown> = {
      user_id: setupToken.user_id,
      name: accountName,
      broker: installSibling?.broker ?? payload.account_info.broker,
      account_number: String(payload.account_info.login),
      account_type: installSibling?.account_type ?? payload.account_info.account_type,
      balance_start: payload.account_info.balance,
      equity_current: payload.account_info.equity,
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
      .select("id, user_id, terminal_id")
      .single();

    // Race: concurrent event already created this (user_id, install_id, login)
    if (createError && (createError.code === "23505" || /duplicate key/i.test(createError.message || ""))) {
      const { data: existing } = await supabase
        .from("accounts")
        .select("id, user_id, terminal_id")
        .eq("user_id", setupToken.user_id)
        .eq("mt5_install_id", payload.install_id || "")
        .eq("account_number", String(payload.account_info.login))
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

  return { account, brokerLogin };
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
