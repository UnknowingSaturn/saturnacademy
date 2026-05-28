// Shared payload types for the ingest pipeline.
// Lifted out of ingest-events/index.ts so handlers can be split into modules.

export interface AccountInfo {
  login: number;
  broker: string;
  server: string;
  balance: number;
  equity: number;
  account_type: "demo" | "live" | "prop";
}

export interface EventPayload {
  idempotency_key: string;
  terminal_id: string;
  install_id?: string;            // v4: stable hash of MT5 install path
  active_login?: string;          // v4: currently active broker login on the install
  account_id?: string;
  ea_type?: "journal" | "master" | "receiver";
  event_type:
    | "entry"
    | "exit"
    | "history_sync"
    | "open"
    | "modify"
    | "partial_close"
    | "close"
    | "position_snapshot"
    | "heartbeat";
  open_position_tickets?: number[];
  original_event_type?: "entry" | "exit";
  position_id: number;
  deal_id: number;
  order_id: number;
  ticket?: number;
  symbol: string;
  direction: "buy" | "sell";
  lot_size: number;
  price: number;
  sl?: number;
  tp?: number;
  commission?: number;
  swap?: number;
  profit?: number;
  timestamp: string;
  server_time?: string;
  timezone_offset_seconds?: number;
  equity_at_entry?: number;
  entry_price?: number;
  entry_time?: string;
  spread?: number;
  // Heartbeat fields
  ea_version?: string;
  open_positions_count?: number;
  leverage?: number;
  margin_free?: number;
  margin_level?: number;
  broker_utc_offset?: number;
  account_info?: AccountInfo;
  raw_payload?: Record<string, unknown>;
}

export interface ResolvedAccount {
  id: string;
  user_id: string;
  terminal_id: string | null;
}
