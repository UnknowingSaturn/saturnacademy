UPDATE public.bar_ingest_jobs
SET status = 'failed',
    last_error = COALESCE(last_error, '') || ' [parked: vendor feed unavailable; import MT5 history instead]'
WHERE status = 'pending' AND attempts >= 2;