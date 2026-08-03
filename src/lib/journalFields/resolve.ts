import { Trade, SessionType, EmotionalState, TimeframeAlignment, TradeProfile, RegimeType, TradeDirection } from "@/types/trading";
import { getDayNameET } from "@/lib/time";
import { getRealPartialCloses } from "@/lib/tradeMath";
import { FieldDef, FieldSource } from "./registry";

export interface ResolvedValue {
  display: string | null;
  sortable: string | number | null;
  raw: unknown;
}

export function getComputedValue(
  trade: Trade,
  source: Extract<FieldSource, { kind: "computed" }>,
  allTrades?: Trade[]
): unknown {
  switch (source.id) {
    case "day":
      return getDayNameET(trade.entry_time);
    case "account_pct": {
      // Prefer the trade's own account equity snapshots captured at entry time,
      // then fall back to the account's current equity, then starting balance.
      const equityBase =
        trade.equity_at_entry ??
        trade.balance_at_entry ??
        null;
      if (trade.net_pnl != null && equityBase && Number(equityBase) > 0) {
        return (Number(trade.net_pnl) / Number(equityBase)) * 100;
      }
      return null;
    }
    case "result": {
      const pnl = trade.net_pnl || 0;
      if (trade.is_open) return "open";
      if (trade.trade_type && trade.trade_type !== "executed") {
        if (pnl > 0) return "would_win";
        if (pnl < 0) return "would_lose";
        return "hypothetical";
      }
      const g = trade as any;
      if (g.outcome_mix === "mixed") return "mixed";
      if (pnl > 0) return "win";
      if (pnl < 0) return "loss";
      return "be";
    }
    case "status": {
      if (trade.is_open) return "open";
      const pnl = trade.net_pnl ?? 0;
      if (pnl > 0) return "win";
      if (pnl < 0) return "loss";
      return "be";
    }
    case "read_quality": {
      const fields: Array<[unknown, unknown]> = [
        [trade.playbook_id, trade.actual_playbook_id],
        [trade.profile, trade.actual_profile],
        [trade.review?.regime, trade.actual_regime],
      ];
      const graded = fields.filter(([p, a]) => p && a);
      if (graded.length === 0) return null;
      const matches = graded.filter(([p, a]) => p === a).length;
      if (matches === graded.length) return "match";
      if (matches === 0) return "mismatch";
      return "partial";
    }
    case "closes": {
      const partials = getRealPartialCloses(trade).length;
      return trade.is_open ? partials : partials + 1;
    }
    default:
      return null;
  }
}

export function readFieldValue(trade: Trade, field: FieldDef, allTrades?: Trade[]): unknown {
  switch (field.source.kind) {
    case "trades":
      return (trade as any)[field.source.column];
    case "trade_reviews":
      return trade.review ? (trade.review as any)[field.source.column] : null;
    case "computed":
      return getComputedValue(trade, field.source, allTrades);
    case "custom":
      return (trade as any).custom_fields?.[field.source.key] ?? null;
  }
}

export function resolveDisplay(
  trade: Trade,
  field: FieldDef,
  allTrades?: Trade[]
): ResolvedValue {
  const raw = readFieldValue(trade, field, allTrades);

  if (raw === null || raw === undefined || raw === "") {
    return { display: null, sortable: null, raw };
  }

  switch (field.valueType) {
    case "money": {
      const n = Number(raw);
      return {
        display: `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`,
        sortable: n,
        raw,
      };
    }
    case "percent": {
      const n = Number(raw);
      return {
        display: `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`,
        sortable: n,
        raw,
      };
    }
    case "number": {
      const n = Number(raw);
      return {
        display: Number.isFinite(n) ? n.toFixed(2) : String(raw),
        sortable: n,
        raw,
      };
    }
    case "duration": {
      const n = Number(raw);
      const hours = Math.floor(n / 3600);
      const minutes = Math.floor((n % 3600) / 60);
      return {
        display: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
        sortable: n,
        raw,
      };
    }
    case "date": {
      // TradeTable formats date separately; here we return a stable sortable string.
      const d = new Date(raw as string);
      return {
        display: d.toLocaleString(),
        sortable: d.getTime(),
        raw,
      };
    }
    case "badge":
    case "select":
    case "multi_select":
    case "text":
    default:
      return { display: String(raw), sortable: String(raw), raw };
  }
}

export interface FieldUpdate {
  trades?: Partial<Trade>;
  review?: Partial<import("@/types/trading").TradeReview>;
  customFields?: Record<string, unknown>;
}

export function writeFieldValue(
  field: FieldDef,
  value: unknown
): FieldUpdate {
  switch (field.source.kind) {
    case "trades": {
      const col = field.source.column;
      if (col === "session") {
        return { trades: { [col]: value as SessionType | null } };
      }
      if (col === "profile") {
        return { trades: { [col]: value as TradeProfile | null } };
      }
      if (col === "actual_profile") {
        return { trades: { [col]: value as TradeProfile | null } };
      }
      if (col === "actual_regime") {
        return { trades: { [col]: value as RegimeType | null } };
      }
      if (col === "alignment") {
        return { trades: { [col]: value as TimeframeAlignment[] } };
      }
      if (col === "entry_timeframes") {
        return { trades: { [col]: value as TimeframeAlignment[] } };
      }
      if (col === "place") {
        return { trades: { [col]: value as string | null } };
      }
      if (col === "playbook_id" || col === "actual_playbook_id" || col === "account_id") {
        return { trades: { [col]: value as string | null } };
      }
      return { trades: { [col]: value } };
    }
    case "trade_reviews": {
      const col = field.source.column;
      if (col === "emotional_state_before") {
        return { review: { [col]: value as EmotionalState | null } };
      }
      if (col === "regime") {
        return { review: { [col]: value as RegimeType | null } };
      }
      return { review: { [col]: value } };
    }
    case "custom": {
      const cf: Record<string, unknown> = {};
      if (value === null || value === undefined || value === "") {
        cf[field.source.key] = null;
      } else {
        cf[field.source.key] = value;
      }
      return { customFields: cf };
    }
    case "computed":
      return {};
  }
}
