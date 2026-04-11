ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS live_trade_questions jsonb 
DEFAULT '[
  {"id":"emotional_state","type":"select","label":"How are you feeling?","options":["Focused","Calm","Confident","Anxious","FOMO","Frustrated"]},
  {"id":"setup_confidence","type":"rating","label":"Setup confidence (1-5)"},
  {"id":"entry_reasoning","type":"text","label":"Why did you enter this trade?"},
  {"id":"market_context","type":"text","label":"Market context / regime"}
]'::jsonb;