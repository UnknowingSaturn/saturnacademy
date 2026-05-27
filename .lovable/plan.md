Your suspicion is right, but there are two separate things happening.

## What I found

- `70561` currently has **100 total trades**, **91 visible trades**.
- `70561` also shares **28 duplicate ticket IDs** with sibling accounts on the same MT5 install:
  - `70583` has 17 trades, and all 17 duplicate tickets also exist under `70561`.
  - `76034` has 11 trades, and all 11 duplicate tickets also exist under `70561`.
- That strongly indicates the old app logic previously tagged those trades to `70561` before per-login routing was fixed.
- But archiving/removing only those obvious duplicates would bring `70561` from **91 visible** down to about **64 visible**, not ~20.
- So there are likely more old `70561` rows that belong to other accounts whose history has not been fully re-synced yet, especially `76036` which currently has 0 trades.

## Minimal safe plan

1. **Do not delete anything.**
   - Only archive or reassign legacy duplicates after we can prove the target account has the same ticket.
   - This keeps everything reversible.

2. **First sync every account fully.**
   - Keep `force_resync=true` for `70583`, `76034`, `76036`, and `70561`.
   - Broaden `sync_history_from` for the affected accounts to `2020-01-01` so the EA is not limited to one year.
   - Login to each MT5 account one at a time with History → All History open.

3. **Then run a duplicate-ticket cleanup.**
   - For every trade ticket that exists in both `70561` and another sibling account, archive the `70561` copy and leave the sibling account copy visible.
   - This immediately fixes the confirmed wrongly-tagged rows without touching uncertain trades.

4. **Add a temporary admin-only cleanup button or one-off backend action.**
   - “Archive duplicate legacy trades from 70561”
   - It should only target duplicates proven by matching ticket IDs across sibling accounts.
   - No permanent production UI needed after this cleanup.

5. **Permanent production rule stays simple.**
   - New EA events already route by broker login.
   - Keep idempotency by `terminal_id + deal_id + event_type`.
   - Do not add complex ledger reconciliation yet.

## Expected outcome

- After duplicate cleanup, `70561` drops by at least 28 mis-tagged trades.
- After `76036` and any remaining accounts properly sync, more duplicate tickets may appear, and we can run the same reversible cleanup again.
- Once counts match MT5, click **Stop** on each resync banner.