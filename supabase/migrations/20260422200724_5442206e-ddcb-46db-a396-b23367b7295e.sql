-- Add planned-vs-actual tracking columns to trades
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS actual_playbook_id uuid REFERENCES public.playbooks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actual_profile text,
  ADD COLUMN IF NOT EXISTS actual_regime text;

CREATE INDEX IF NOT EXISTS idx_trades_actual_playbook_id ON public.trades(actual_playbook_id);