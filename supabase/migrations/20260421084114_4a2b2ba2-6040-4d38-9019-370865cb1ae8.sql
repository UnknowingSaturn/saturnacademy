-- Add broker_dst_profile enum and column to accounts
DO $$ BEGIN
  CREATE TYPE public.broker_dst_profile AS ENUM (
    'EET_DST',
    'GMT_DST',
    'FIXED_PLUS_3',
    'FIXED_PLUS_2',
    'FIXED_PLUS_0',
    'MANUAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS broker_dst_profile public.broker_dst_profile NOT NULL DEFAULT 'MANUAL';

-- Add display_timezone to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS display_timezone text NOT NULL DEFAULT 'America/New_York';