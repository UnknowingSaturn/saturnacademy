-- Add broker_utc_offset column to accounts table
-- Default to 2 since most forex brokers run on UTC+2 (EET)
ALTER TABLE public.accounts 
ADD COLUMN broker_utc_offset integer DEFAULT 2;

-- Add comment for clarity
COMMENT ON COLUMN public.accounts.broker_utc_offset IS 'Broker server UTC offset in hours (e.g., 2 for UTC+2). Used to convert broker local time to UTC.';