-- Drop duplicate EURUSD months ingested under a raw MT5 filename.
DELETE FROM public.bar_manifest
WHERE symbol = 'EURUSD+_M1_202605140';

-- Repoint the GBPUSD history stored under its raw MT5 filename to the
-- canonical symbol so the engine prices it with the real GBPUSD spec.
UPDATE public.bar_manifest
SET symbol = 'GBPUSD'
WHERE symbol = 'GBPUSD+_M1_202401020'
  AND NOT EXISTS (
    SELECT 1 FROM public.bar_manifest b2
    WHERE b2.symbol = 'GBPUSD'
      AND b2.timeframe = bar_manifest.timeframe
      AND b2.month = bar_manifest.month
      AND b2.source = bar_manifest.source
  );

DELETE FROM public.bar_ingest_jobs
WHERE symbol IN ('GBPUSD+_M1_202401020', 'EURUSD+_M1_202605140');