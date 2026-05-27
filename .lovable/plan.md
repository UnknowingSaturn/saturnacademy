## What’s happening

The issue is not just duplicate tickets anymore. The old sync logic stored trades under account `70561`, but many rows still carry a `terminal_id` like `MT5_76036_HolaPrime-`, `MT5_76034_HolaPrime-`, etc. That means the correct account can be recovered for a lot of legacy rows.

Current signal:
- `70561` has 64 visible trades.
- Of those, only 20 visible trades have `terminal_id = MT5_70561_HolaPrime-`.
- The other visible rows are assigned to `70561` but their terminal login points to `70581`, `70573`, `76036`, `76034`, `70583`, or `86021`.
- Existing ingestion now resolves by broker login, so new events should route correctly.

## Plan

1. **Add a temporary repair action for all accounts on the same MT5 install**
   - Replace the hardcoded “Archive duplicate legacy 70561 trades” button with a more general maintenance action.
   - It will scan trades on the selected MT5 install and parse the intended login from `terminal_id` (`MT5_<login>_...`).

2. **Reassign provable legacy mis-tagged trades**
   - If a trade is assigned to account A, but `terminal_id` says it belongs to login B, and account B exists, update that trade’s `account_id` to account B.
   - Also normalize `broker_login` to B when it was incorrectly stored as A.
   - This should move the wrongly tagged visible rows out of `70561`, bringing it close to the ~20 actual trades you see in MT5.

3. **Archive only when reassigning is impossible or duplicate-conflicting**
   - If the target account doesn’t exist yet, leave the row untouched and report it.
   - If the target account already has the same ticket, archive the wrong source copy instead of creating two visible copies.
   - No deletion. Everything stays reversible through archived trades or database history.

4. **Add a dry-run/preview result before changing data**
   - Show a summary like: “70561 → 76036: 7 trades”, “70561 → 76034: 5 trades”, etc.
   - Then a confirmation button applies the repair.

5. **Keep production simple**
   - Do not add a complex reconciliation system yet.
   - Keep the permanent rule: every new EA event routes by `account_info.login` / broker login.
   - Temporary repair tooling can be removed later once the ledger is clean.

## Expected result

After repair:
- `70561` should show around 20 visible trades.
- `76034`, `76036`, `70583`, and `86021` should receive the trades whose `terminal_id` proves they belong there.
- Any uncertain rows remain untouched rather than guessed.

## Implementation details

- Frontend: update the Accounts maintenance section to run a general legacy ownership repair instead of the hardcoded `70561` duplicate cleanup.
- Backend/data: use a controlled data update, not schema changes.
- Safety: no trade deletion; reassign only when the target account exists and the terminal login is provable.