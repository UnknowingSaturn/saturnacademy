-- R5: session enum -> text
DROP VIEW IF EXISTS public.trade_view;

ALTER TABLE public.trades
  ALTER COLUMN session TYPE text USING session::text;

ALTER TABLE public.playbooks
  ALTER COLUMN session_filter TYPE text[] USING session_filter::text[];

DROP TYPE IF EXISTS public.session_type;

CREATE VIEW public.trade_view AS
SELECT id, user_id, account_id, terminal_id, ticket, symbol, direction,
       total_lots, entry_price, entry_time, exit_price, exit_time,
       sl_initial, tp_initial, sl_final, tp_final,
       gross_pnl, commission, swap, net_pnl,
       r_multiple_planned, r_multiple_actual, session,
       duration_seconds, is_open, created_at, updated_at,
       alignment, entry_timeframes, profile, place,
       trade_number, original_lots, balance_at_entry, equity_at_entry,
       playbook_id, is_archived, archived_at, trade_type, risk_percent,
       actual_playbook_id, actual_profile, actual_regime,
       custom_fields, install_id, broker_login, repair_state,
       COALESCE(( SELECT a.id
            FROM public.accounts a
           WHERE a.user_id = t.user_id
             AND a.account_number = t.broker_login
             AND a.mt5_install_id = t.install_id
             AND a.is_active = true
           LIMIT 1), account_id) AS resolved_account_id
  FROM public.trades t;

GRANT SELECT ON public.trade_view TO authenticated;
GRANT ALL ON public.trade_view TO service_role;