CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE OR REPLACE FUNCTION public.prune_monitoring_snapshots()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.terminal_snapshots WHERE received_at < now() - interval '90 days';
  DELETE FROM public.account_balance_snapshots WHERE recorded_at < now() - interval '90 days';
$$;
REVOKE ALL ON FUNCTION public.prune_monitoring_snapshots() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_monitoring_snapshots() TO service_role;

-- Unschedule any prior version then schedule daily at 03:00 UTC
DO $$
BEGIN
  PERFORM cron.unschedule('prune-monitoring-snapshots');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'prune-monitoring-snapshots',
  '0 3 * * *',
  $$SELECT public.prune_monitoring_snapshots();$$
);

COMMENT ON TABLE public.events IS 'Immutable append-only event log. Do not add UPDATE or DELETE policies.';
COMMENT ON TABLE public.terminal_snapshots IS 'Append-only heartbeats; pruned to 90 days by pg_cron.';
COMMENT ON TABLE public.account_balance_snapshots IS 'Append-only minute-buckets; pruned to 90 days by pg_cron.';
COMMENT ON TABLE public.trade_repair_events IS 'Append-only audit log; do not add UPDATE/DELETE policies.';