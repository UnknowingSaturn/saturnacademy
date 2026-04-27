ALTER TABLE public.shared_report_trades
  ADD COLUMN IF NOT EXISTS symbol_override text,
  ADD COLUMN IF NOT EXISTS direction_override text,
  ADD COLUMN IF NOT EXISTS entry_time_override timestamptz,
  ADD COLUMN IF NOT EXISTS session_override text,
  ADD COLUMN IF NOT EXISTS playbook_name_override text;