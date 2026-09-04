CREATE INDEX IF NOT EXISTS idx_events_user_ticket_deal
  ON public.events (user_id, ticket, ((raw_payload->>'deal_id')));