// Canonical identity for an MT5 deal event.
//
// The EA emits the SAME broker deal from three sources — the live event, the
// open-position sync and the history sync — and each historically carried its
// own `idempotency_key` prefix (`_openpos_`, `_history_`, none). Those keys are
// distinct strings, so the unique index on `events.idempotency_key` never
// collapsed them and one entry became three trades.
//
// The canonical key drops the source entirely and identifies the deal by what
// the broker actually guarantees to be stable: install (or terminal), login,
// deal id (falling back to the position id) and the logical event type.

import type { EventPayload } from "./eventTypes.ts";

/** Logical event type, with history_sync unwrapped to what it replays. */
export function logicalEventType(payload: EventPayload): string {
  const t = payload.event_type === "history_sync"
    ? (payload.original_event_type || "entry")
    : payload.event_type;
  if (t === "entry") return "open";
  if (t === "exit") return "close";
  return t;
}

const DEDUPABLE = new Set(["open", "close", "partial_close"]);

/**
 * Returns the source-independent key for a deal event, or null when the event
 * is not deal-shaped (heartbeat, snapshot, modify — those stay time-keyed).
 */
export function canonicalIdempotencyKey(
  payload: EventPayload,
  brokerLogin: string | null,
): string | null {
  const type = logicalEventType(payload);
  if (!DEDUPABLE.has(type)) return null;

  const scope = payload.install_id || payload.terminal_id;
  if (!scope) return null;

  const deal = payload.deal_id && Number(payload.deal_id) !== 0
    ? `d${payload.deal_id}`
    : null;
  const position = payload.position_id || payload.ticket;
  const subject = deal ?? (position ? `p${position}` : null);
  if (!subject) return null;

  return `${scope}:${brokerLogin ?? "-"}:${subject}:${type}`;
}

/**
 * Broker server time is wall-clock in the broker's timezone. Convert it with
 * the offset stored on the ACCOUNT — payload-embedded offsets disagree between
 * live and history-sync events and produced 1-hour-shifted duplicates.
 */
export function utcFromServerTime(
  serverTime: string | undefined | null,
  offsetHours: number | null | undefined,
): string | null {
  if (!serverTime || typeof offsetHours !== "number") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(serverTime);
  if (!m) return null;
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  ) - offsetHours * 3_600_000;
  return new Date(ms).toISOString();
}
