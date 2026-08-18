CREATE TABLE public.bar_manifest (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL DEFAULT '1m',
  month text NOT NULL,
  source text NOT NULL DEFAULT 'dukascopy',
  object_path text NOT NULL,
  bar_count integer NOT NULL DEFAULT 0,
  first_ts timestamptz,
  last_ts timestamptz,
  byte_size integer NOT NULL DEFAULT 0,
  missing_minutes integer NOT NULL DEFAULT 0,
  duplicate_ts integer NOT NULL DEFAULT 0,
  zero_volume_bars integer NOT NULL DEFAULT 0,
  invalid_bars integer NOT NULL DEFAULT 0,
  missing_days jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, timeframe, month, source)
);

GRANT SELECT ON public.bar_manifest TO authenticated;
GRANT ALL ON public.bar_manifest TO service_role;
ALTER TABLE public.bar_manifest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read the bar manifest"
  ON public.bar_manifest FOR SELECT TO authenticated USING (true);

CREATE INDEX bar_manifest_symbol_month_idx ON public.bar_manifest (symbol, timeframe, month);

CREATE TABLE public.bar_ingest_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL DEFAULT '1m',
  month text NOT NULL,
  source text NOT NULL DEFAULT 'dukascopy',
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  last_error text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, timeframe, month, source)
);

GRANT SELECT, INSERT ON public.bar_ingest_jobs TO authenticated;
GRANT ALL ON public.bar_ingest_jobs TO service_role;
ALTER TABLE public.bar_ingest_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read ingest jobs"
  ON public.bar_ingest_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can queue ingest jobs"
  ON public.bar_ingest_jobs FOR INSERT TO authenticated WITH CHECK (requested_by = auth.uid());

CREATE INDEX bar_ingest_jobs_status_idx ON public.bar_ingest_jobs (status, created_at);

CREATE TABLE public.backtest_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  config jsonb NOT NULL,
  config_hash text NOT NULL,
  symbols text[] NOT NULL DEFAULT '{}',
  date_from date,
  date_to date,
  include_holdout boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  no_trade_log jsonb NOT NULL DEFAULT '{}'::jsonb,
  trade_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_runs TO authenticated;
GRANT ALL ON public.backtest_runs TO service_role;
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own backtest runs"
  ON public.backtest_runs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX backtest_runs_user_idx ON public.backtest_runs (user_id, created_at DESC);

CREATE TABLE public.backtest_trades (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  session_date date NOT NULL,
  window_key text NOT NULL,
  direction text NOT NULL,
  setup_ts timestamptz,
  entry_ts timestamptz NOT NULL,
  entry_price double precision NOT NULL,
  stop_price double precision NOT NULL,
  target_price double precision,
  exit_ts timestamptz,
  exit_price double precision,
  exit_reason text,
  bars_held integer,
  gross_pnl double precision,
  net_pnl double precision,
  r_multiple double precision,
  mae_points double precision,
  mfe_points double precision,
  ambiguous_bar boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backtest_trades TO authenticated;
GRANT ALL ON public.backtest_trades TO service_role;
ALTER TABLE public.backtest_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own backtest trades"
  ON public.backtest_trades FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX backtest_trades_run_idx ON public.backtest_trades (run_id, entry_ts);