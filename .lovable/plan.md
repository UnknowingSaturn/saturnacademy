# Phase U Verification — Copier P0–P2

All 10 remediations from the Copier root-cause phase are present in source and behave as designed. No follow-up edits required.

## P0 — Critical

| ID | Fix | Evidence |
|----|-----|----------|
| U-1 | Synchronous IPC response polling | `copier-desktop/src-tauri/src/copier/trade_executor.rs:186-201` — `wait_for_response_sync` polls `resp_<timestamp>.json` |
| U-2 | Receiver no longer drops exits outside session | `mt5-bridge/TradeCopierReceiver.mq5:1037-1042` — only `entry` events gated; exit/partial_close/modify always run |
| U-3 | Collision-resistant terminal ID | `TradeCopierMaster.mq5:87-98` — login + server + FNV-1a hash of `TERMINAL_DATA_PATH` |
| U-4 | Atomic safety check (TOCTOU closed) | `safety.rs:361-478` — single `SAFETY_STATE.lock()` wrapping labeled `'check:` block |

## P1 — Math & Auth

| ID | Fix | Evidence |
|----|-----|----------|
| U-5 | Forex risk uses `sl_ticks * tick_value` (no 10× JPY/5-digit error) | `lot_calculator.rs:256-263` |
| U-6 | Risk modes block (return 0.0) on missing SL/account instead of mirroring master | `lot_calculator.rs:165-187`; `round_lots` floors at 0.01 |
| U-7 | Desktop forwards `x-install-id`; edge logs it | `sync/config.rs:12-17`, `sync/executions.rs:18-24`; `copier-config/index.ts:60`, `copier-executions/index.ts:47` |
| U-8 | Disabled accounts get HTTP 403 | `copier-config/index.ts:87-92`, `copier-executions/index.ts:80-85` |

## P2 — Idempotency & Sync Noise

| ID | Fix | Evidence |
|----|-----|----------|
| U-9 | Atomic `claim_event` + append-only persistence | `idempotency.rs:162-201`; consumer at `file_watcher.rs:340` |
| U-10 | `VolumeMismatch` only flags zero / >100× divergence | `position_sync.rs:179-191` |

## Conclusion

Phase U P0–P2 is fully closed. Nothing to implement this turn. Awaiting your go-ahead for **P3** (lower-severity items from the original Phase U plan) or any new scope.
