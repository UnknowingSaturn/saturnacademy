// Canonical constants and helpers for the snapshot_closed repair flow.
// Before Phase 2 these strings were duplicated in 4 places with subtly
// different sets, which is what allowed phase_a_one_shot trades to be
// silently re-repaired by the sibling path.

export const REPAIR_ACTION_SNAPSHOT_CLOSED = "snapshot_closed" as const;

/**
 * Actions that mean "this trade's exit data has already been resolved".
 * Any code deciding whether a snapshot_closed trade is still pending repair
 * MUST consult this list — do not hardcode subsets inline.
 */
export const REPAIRED_ACTIONS = [
  "repaired_from_snapshot",
  "repaired_reopened",
  "phase_a_one_shot",
] as const;

export type RepairAction =
  | typeof REPAIR_ACTION_SNAPSHOT_CLOSED
  | (typeof REPAIRED_ACTIONS)[number];

export interface RepairEventRow {
  action: string;
}

export function hasSnapshotClosed(events: RepairEventRow[] | null | undefined): boolean {
  return (events || []).some((e) => e.action === REPAIR_ACTION_SNAPSHOT_CLOSED);
}

export function isAlreadyRepaired(events: RepairEventRow[] | null | undefined): boolean {
  return (events || []).some((e) => (REPAIRED_ACTIONS as readonly string[]).includes(e.action));
}

/** A snapshot_closed trade still awaiting real exit data. */
export function isPendingRepair(events: RepairEventRow[] | null | undefined): boolean {
  return hasSnapshotClosed(events) && !isAlreadyRepaired(events);
}
