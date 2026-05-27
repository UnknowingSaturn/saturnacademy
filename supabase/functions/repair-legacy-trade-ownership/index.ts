import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Mode = "preview" | "apply";

type AccountRow = {
  id: string;
  user_id?: string;
  name?: string | null;
  broker?: string | null;
  account_number: string | null;
  mt5_install_id: string | null;
  terminal_id?: string | null;
  api_key?: string | null;
  copier_role?: string | null;
  copier_enabled?: boolean | null;
  master_account_id?: string | null;
  sync_history_enabled?: boolean | null;
  sync_history_from?: string | null;
  account_type?: string | null;
  prop_firm?: string | null;
  broker_utc_offset?: number | null;
  broker_dst_profile?: string | null;
  ea_type?: string | null;
};

type TradeRow = {
  id: string;
  account_id: string;
  ticket: number | null;
  terminal_id: string | null;
  broker_login: string | null;
  is_archived: boolean | null;
};

type PlannedAction = {
  trade: TradeRow;
  source: AccountRow;
  target: AccountRow;
  terminalLogin: string;
  action: "reassign" | "archive_duplicate";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Not authenticated" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const accountId = typeof body.account_id === "string" ? body.account_id : null;
    const mode: Mode = body.mode === "apply" ? "apply" : "preview";

    if (!accountId) {
      return json({ error: "account_id is required" }, 400);
    }

    const { data: selectedAccount, error: selectedError } = await admin
      .from("accounts")
      .select("id, account_number, mt5_install_id")
      .eq("id", accountId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (selectedError) throw selectedError;
    if (!selectedAccount) return json({ error: "Account not found" }, 404);
    if (!selectedAccount.mt5_install_id) {
      return json({ error: "Selected account is not linked to an MT5 install" }, 400);
    }

    const { data: accounts, error: accountsError } = await admin
      .from("accounts")
      .select("id, user_id, name, broker, account_number, mt5_install_id, terminal_id, api_key, copier_role, copier_enabled, master_account_id, sync_history_enabled, sync_history_from, account_type, prop_firm, broker_utc_offset, broker_dst_profile, ea_type")
      .eq("user_id", user.id)
      .eq("mt5_install_id", selectedAccount.mt5_install_id)
      .eq("is_active", true);

    if (accountsError) throw accountsError;

    let installAccounts = (accounts || []) as AccountRow[];
    const accountIds = installAccounts.map((account) => account.id);
    const accountById = new Map(installAccounts.map((account) => [account.id, account]));
    const accountByLogin = new Map(
      installAccounts
        .filter((account) => account.account_number)
        .map((account) => [String(account.account_number), account]),
    );

    if (accountIds.length === 0) {
      return json({ error: "No accounts found for this MT5 install" }, 404);
    }

    const trades = await fetchAllTrades(admin, accountIds);
    const tradeByAccountTicket = new Map<string, TradeRow[]>();

    for (const trade of trades) {
      if (trade.ticket == null) continue;
      const key = `${trade.account_id}:${Number(trade.ticket)}`;
      const rows = tradeByAccountTicket.get(key) || [];
      rows.push(trade);
      tradeByAccountTicket.set(key, rows);
    }

    const missingTargetLogins = new Set<string>();
    if (mode === "apply") {
      const createdAccounts = await createMissingAccounts(admin, user.id, installAccounts, trades, accountByLogin);
      if (createdAccounts.length > 0) {
        installAccounts = [...installAccounts, ...createdAccounts];
        for (const account of createdAccounts) {
          accountIds.push(account.id);
          accountById.set(account.id, account);
          if (account.account_number) accountByLogin.set(account.account_number, account);
        }
      }
    }

    const actions: PlannedAction[] = [];
    let skippedNoTerminalLogin = 0;
    let alreadyCorrect = 0;

    for (const trade of trades) {
      const source = accountById.get(trade.account_id);
      if (!source) continue;

      const terminalLogin = parseTerminalLogin(trade.terminal_id);
      if (!terminalLogin) {
        skippedNoTerminalLogin++;
        continue;
      }

      if (String(source.account_number) === terminalLogin) {
        alreadyCorrect++;
        continue;
      }

      const target = accountByLogin.get(terminalLogin);
      if (!target) {
        missingTargetLogins.add(terminalLogin);
        if (mode === "preview") {
          actions.push({
            trade,
            source,
            target: {
              id: `preview-${terminalLogin}`,
              account_number: terminalLogin,
              mt5_install_id: selectedAccount.mt5_install_id,
            },
            terminalLogin,
            action: "reassign",
          });
        }
        continue;
      }

      const duplicateRows = trade.ticket == null
        ? []
        : (tradeByAccountTicket.get(`${target.id}:${Number(trade.ticket)}`) || [])
          .filter((candidate) => candidate.id !== trade.id);

      if (trade.is_archived && duplicateRows.length > 0) continue;

      actions.push({
        trade,
        source,
        target,
        terminalLogin,
        action: duplicateRows.length > 0 ? "archive_duplicate" : "reassign",
      });
    }

    const summary = summarize(actions);

    if (mode === "apply") {
      const now = new Date().toISOString();
      let reassigned = 0;
      let archivedDuplicates = 0;

      for (const action of actions) {
        if (action.action === "reassign") {
          const { error } = await admin
            .from("trades")
            .update({
              account_id: action.target.id,
              broker_login: action.terminalLogin,
            })
            .eq("id", action.trade.id);
          if (error) throw error;
          reassigned++;
        } else {
          const { error } = await admin
            .from("trades")
            .update({
              is_archived: true,
              archived_at: now,
            })
            .eq("id", action.trade.id);
          if (error) throw error;
          archivedDuplicates++;
        }
      }

      return json({
        status: "ok",
        mode,
        install_id: selectedAccount.mt5_install_id,
        scanned_trades: trades.length,
        already_correct: alreadyCorrect,
        skipped_no_terminal_login: skippedNoTerminalLogin,
        missing_target_logins: Array.from(missingTargetLogins).sort(),
        planned: actions.length,
        reassigned,
        archived_duplicates: archivedDuplicates,
        summary,
        message: `Reassigned ${reassigned} trade${reassigned === 1 ? "" : "s"} and archived ${archivedDuplicates} duplicate cop${archivedDuplicates === 1 ? "y" : "ies"}.`,
      });
    }

    return json({
      status: "ok",
      mode,
      install_id: selectedAccount.mt5_install_id,
      scanned_trades: trades.length,
      already_correct: alreadyCorrect,
      skipped_no_terminal_login: skippedNoTerminalLogin,
      missing_target_logins: Array.from(missingTargetLogins).sort(),
      planned: actions.length,
      reassignable: actions.filter((action) => action.action === "reassign").length,
      archive_duplicates: actions.filter((action) => action.action === "archive_duplicate").length,
      summary,
      message: actions.length === 0
        ? "No provable legacy ownership repairs found for this MT5 install."
        : `Found ${actions.length} provable legacy ownership repair${actions.length === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("repair-legacy-trade-ownership error:", message);
    return json({ error: message }, 500);
  }
});

async function fetchAllTrades(admin: ReturnType<typeof createClient>, accountIds: string[]) {
  const pageSize = 1000;
  const rows: TradeRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await admin
      .from("trades")
      .select("id, account_id, ticket, terminal_id, broker_login, is_archived")
      .in("account_id", accountIds)
      .range(from, to);

    if (error) throw error;
    rows.push(...((data || []) as TradeRow[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function createMissingAccounts(
  admin: ReturnType<typeof createClient>,
  userId: string,
  installAccounts: AccountRow[],
  trades: TradeRow[],
  accountByLogin: Map<string, AccountRow>,
) {
  const template = installAccounts[0];
  if (!template) return [];

  const missingLogins = Array.from(new Set(
    trades
      .map((trade) => parseTerminalLogin(trade.terminal_id))
      .filter((login): login is string => !!login && !accountByLogin.has(login)),
  )).sort();

  const createdAccounts: AccountRow[] = [];
  for (const login of missingLogins) {
    const terminalId = trades.find((trade) => parseTerminalLogin(trade.terminal_id) === login)?.terminal_id ?? null;
    const { data, error } = await admin
      .from("accounts")
      .insert({
        user_id: userId,
        name: `${template.broker || "MT5"} - ${login}`,
        broker: template.broker,
        account_number: login,
        mt5_install_id: template.mt5_install_id,
        terminal_id: terminalId,
        api_key: template.api_key,
        copier_role: template.copier_role,
        copier_enabled: template.copier_enabled,
        master_account_id: template.master_account_id,
        sync_history_enabled: template.sync_history_enabled,
        sync_history_from: template.sync_history_from,
        account_type: template.account_type,
        prop_firm: template.prop_firm,
        broker_utc_offset: template.broker_utc_offset,
        broker_dst_profile: template.broker_dst_profile,
        ea_type: template.ea_type,
        is_active: true,
        live_state: "dormant",
      })
      .select("id, user_id, name, broker, account_number, mt5_install_id, terminal_id, api_key, copier_role, copier_enabled, master_account_id, sync_history_enabled, sync_history_from, account_type, prop_firm, broker_utc_offset, broker_dst_profile, ea_type")
      .single();

    if (error && (error.code === "23505" || /duplicate key/i.test(error.message || ""))) {
      const { data: existing, error: existingError } = await admin
        .from("accounts")
        .select("id, user_id, name, broker, account_number, mt5_install_id, terminal_id, api_key, copier_role, copier_enabled, master_account_id, sync_history_enabled, sync_history_from, account_type, prop_firm, broker_utc_offset, broker_dst_profile, ea_type")
        .eq("user_id", userId)
        .eq("mt5_install_id", template.mt5_install_id)
        .eq("account_number", login)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) createdAccounts.push(existing as AccountRow);
      continue;
    }

    if (error) throw error;
    if (data) createdAccounts.push(data as AccountRow);
  }

  return createdAccounts;
}

function parseTerminalLogin(terminalId: string | null) {
  if (!terminalId) return null;
  return terminalId.match(/^MT5_(\d+)_/)?.[1] ?? null;
}

function summarize(actions: PlannedAction[]) {
  const grouped = new Map<string, {
    action: PlannedAction["action"];
    from_account_number: string | null;
    to_account_number: string | null;
    count: number;
  }>();

  for (const action of actions) {
    const key = `${action.action}:${action.source.account_number ?? "unknown"}:${action.target.account_number ?? "unknown"}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, {
        action: action.action,
        from_account_number: action.source.account_number,
        to_account_number: action.target.account_number,
        count: 1,
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.action !== b.action) return a.action.localeCompare(b.action);
    return String(a.from_account_number).localeCompare(String(b.from_account_number))
      || String(a.to_account_number).localeCompare(String(b.to_account_number));
  });
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}