# Roadmap

## Done
- [x] Install-scoped MT5 credentials (`mt5_installs`) — ingestion authenticates per installation, not per account row.
- [x] Archiving an account is display-only; it never stops a data feed. Archived accounts are listed and restorable.
- [x] Auto-onboard a new broker login on a known install, inheriting broker/DST/copier/sync settings.
- [x] Distinguishable ingest errors (`unknown key`, `revoked install`, `no account for login`) + connection health strip on Accounts and Journal.
- [x] Backfill resync from 2026-07-27 for the affected install.

## Next
- [ ] Retire the legacy `accounts.api_key` fallback once every install has migrated (currently logged as deprecated).
- [ ] Install management UI: rename/label installs, rotate or revoke keys from the Accounts page (hooks exist in `useMt5Installs`).
