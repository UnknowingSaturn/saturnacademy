import { describe, it, expect } from "vitest";
import {
  canonicalIdempotencyKey,
  utcFromServerTime,
  logicalEventType,
} from "../../../supabase/functions/_shared/dealIdentity.ts";
import { loginFromTerminalId } from "../../../supabase/functions/_shared/accountResolver.ts";

const base = {
  terminal_id: "MT5_138743_HolaPrime-",
  install_id: "3cf4b051225143bf",
  position_id: 11130801,
  deal_id: 10150340,
  order_id: 11130801,
  symbol: "EURUSD",
  direction: "buy",
  lot_size: 0.89,
  price: 1.1601,
  timestamp: "2026-09-04T12:50:52Z",
} as any;

describe("canonical deal identity", () => {
  it("collapses the live, open-position and history copies of one deal", () => {
    const live = canonicalIdempotencyKey(
      { ...base, idempotency_key: "MT5_138743_HolaPrime-_10150340_entry", event_type: "entry" },
      "138743",
    );
    const openpos = canonicalIdempotencyKey(
      { ...base, idempotency_key: "MT5_138743_HolaPrime-_openpos_11130801_entry", event_type: "open" },
      "138743",
    );
    const history = canonicalIdempotencyKey(
      {
        ...base,
        idempotency_key: "MT5_138743_HolaPrime-_history_10150340_entry",
        event_type: "history_sync",
        original_event_type: "entry",
      },
      "138743",
    );
    expect(live).toBe("3cf4b051225143bf:138743:d10150340:open");
    expect(openpos).toBe(live);
    expect(history).toBe(live);
  });

  it("keeps the two legs of one entry distinct", () => {
    const legA = canonicalIdempotencyKey({ ...base, event_type: "entry" }, "138743");
    const legB = canonicalIdempotencyKey(
      { ...base, deal_id: 10150341, position_id: 11130802, event_type: "entry" },
      "138743",
    );
    expect(legA).not.toBe(legB);
  });

  it("separates open from close on the same position", () => {
    const open = canonicalIdempotencyKey({ ...base, event_type: "entry" }, "138743");
    const close = canonicalIdempotencyKey(
      { ...base, deal_id: 10153596, event_type: "exit" },
      "138743",
    );
    expect(logicalEventType({ ...base, event_type: "exit" } as any)).toBe("close");
    expect(open).not.toBe(close);
  });

  it("leaves time-keyed events (modify, heartbeat) on their original key", () => {
    expect(canonicalIdempotencyKey({ ...base, event_type: "modify" }, "138743")).toBeNull();
    expect(canonicalIdempotencyKey({ ...base, event_type: "heartbeat" }, "138743")).toBeNull();
  });
});

describe("broker time normalisation", () => {
  it("uses the account offset, not the payload offset", () => {
    // Same server_time reported by live (offset 3) and history sync (offset 2).
    expect(utcFromServerTime("2026-09-04T15:50:52", 3)).toBe("2026-09-04T12:50:52.000Z");
    expect(utcFromServerTime("2026-09-04T15:50:52", 3)).toBe(
      utcFromServerTime("2026-09-04 15:50:52", 3),
    );
  });

  it("returns null when it cannot be trusted", () => {
    expect(utcFromServerTime(undefined, 3)).toBeNull();
    expect(utcFromServerTime("2026-09-04T15:50:52", null)).toBeNull();
    expect(utcFromServerTime("not-a-time", 3)).toBeNull();
  });
});

describe("login recovery from terminal id", () => {
  it("reads the login out of the terminal id when account_info is absent", () => {
    expect(loginFromTerminalId("MT5_138743_HolaPrime-")).toBe("138743");
    expect(loginFromTerminalId("MT5_540314890_FTMO-Serve")).toBe("540314890");
  });

  it("ignores placeholder and malformed terminal ids", () => {
    expect(loginFromTerminalId("MT5_0_")).toBeNull();
    expect(loginFromTerminalId("terminal-1")).toBeNull();
    expect(loginFromTerminalId(null)).toBeNull();
  });
});
