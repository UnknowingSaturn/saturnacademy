-- agent_state: one row per (user_id, install_id), holds latest telemetry from desktop agent
CREATE TABLE public.agent_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  install_id text NOT NULL,
  status text NOT NULL DEFAULT 'unknown',
  version text,
  last_heartbeat_at timestamptz,
  terminals jsonb NOT NULL DEFAULT '[]'::jsonb,
  receivers_status jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, install_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_state TO authenticated;
GRANT ALL ON public.agent_state TO service_role;

ALTER TABLE public.agent_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own agent state" ON public.agent_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own agent state" ON public.agent_state
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own agent state" ON public.agent_state
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own agent state" ON public.agent_state
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_agent_state_updated_at
  BEFORE UPDATE ON public.agent_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_agent_state_user ON public.agent_state(user_id);

-- agent_commands: queue of commands web app → desktop agent
CREATE TABLE public.agent_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  install_id text NOT NULL,
  command text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acked_at timestamptz,
  completed_at timestamptz,
  CHECK (status IN ('pending','acked','done','error'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_commands TO authenticated;
GRANT ALL ON public.agent_commands TO service_role;

ALTER TABLE public.agent_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own agent commands" ON public.agent_commands
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own agent commands" ON public.agent_commands
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own agent commands" ON public.agent_commands
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own agent commands" ON public.agent_commands
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_agent_commands_pending
  ON public.agent_commands(user_id, install_id, created_at)
  WHERE status = 'pending';

ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_state;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_commands;
ALTER TABLE public.agent_state REPLICA IDENTITY FULL;
ALTER TABLE public.agent_commands REPLICA IDENTITY FULL;