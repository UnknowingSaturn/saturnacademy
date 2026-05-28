-- R10: terminal_accounts table -> view derived from accounts
DROP TABLE IF EXISTS public.terminal_accounts CASCADE;

CREATE VIEW public.terminal_accounts
WITH (security_invoker = true) AS
SELECT
  a.terminal_id,
  a.mt5_install_id AS install_id,
  a.id AS account_id,
  a.user_id,
  a.last_heartbeat_at AS last_active_at,
  (
    a.last_heartbeat_at IS NOT NULL
    AND a.last_heartbeat_at = (
      SELECT MAX(a2.last_heartbeat_at)
        FROM public.accounts a2
       WHERE a2.user_id = a.user_id
         AND a2.mt5_install_id IS NOT DISTINCT FROM a.mt5_install_id
         AND a2.is_active
    )
  ) AS is_currently_active,
  a.created_at,
  a.updated_at
FROM public.accounts a
WHERE a.is_active
  AND (a.terminal_id IS NOT NULL OR a.mt5_install_id IS NOT NULL);

GRANT SELECT ON public.terminal_accounts TO authenticated;
GRANT SELECT ON public.terminal_accounts TO service_role;