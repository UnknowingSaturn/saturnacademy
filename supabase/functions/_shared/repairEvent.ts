import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export interface RepairEventInput {
  userId: string;
  tradeId: string;
  /** Must satisfy the CHECK constraint on trade_repair_events.action. */
  action:
    | "repaired_from_snapshot"
    | "snapshot_closed"
    | "snapshot_synced"
    | "manual_dismiss"
    | "duplicate_dismiss"
    | "auto_reopen"
    | "stale_dismiss";
  source: string;
  metadata?: Record<string, unknown>;
}

/**
 * Single source of truth for writing into `trade_repair_events`. Used by:
 *  - ingest-events (sibling auto-repair + 2 other inline sites)
 *  - sync-account-state (reaper)
 *  - repair-snapshot-closed (manual sweep)
 *
 * Always sets `applied_at = now()` and defaults `metadata` to `{}`.
 */
export async function insertRepairEvent(
  client: SupabaseClient,
  e: RepairEventInput,
) {
  return await client.from("trade_repair_events").insert({
    user_id: e.userId,
    trade_id: e.tradeId,
    action: e.action,
    source: e.source,
    metadata: e.metadata ?? {},
    applied_at: new Date().toISOString(),
  });
}
