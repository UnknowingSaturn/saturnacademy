
-- 1. Allow 'rating' type in custom_field_definitions
ALTER TABLE public.custom_field_definitions
  DROP CONSTRAINT IF EXISTS custom_field_definitions_type_check;
ALTER TABLE public.custom_field_definitions
  ADD CONSTRAINT custom_field_definitions_type_check
  CHECK (type = ANY (ARRAY['text','number','select','multi_select','date','checkbox','url','rating']));

-- 2. Backfill live trade questions into custom_field_definitions
INSERT INTO public.custom_field_definitions
  (user_id, key, label, type, options, sort_order, is_active, scope)
SELECT
  us.user_id,
  COALESCE(q->>'id', 'q_' || ord::text)                                AS key,
  COALESCE(q->>'label', q->>'id', 'Question')                          AS label,
  CASE WHEN q->>'type' IN ('text','select','rating')
       THEN q->>'type' ELSE 'text' END                                 AS type,
  COALESCE(q->'options', '[]'::jsonb)                                  AS options,
  (ord - 1)::int                                                       AS sort_order,
  true                                                                 AS is_active,
  'live_question'                                                      AS scope
FROM public.user_settings us
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(us.live_trade_questions, '[]'::jsonb))
  WITH ORDINALITY AS arr(q, ord)
WHERE us.live_trade_questions IS NOT NULL
  AND jsonb_array_length(us.live_trade_questions) > 0
ON CONFLICT (user_id, scope, key) DO NOTHING;

-- 3. Drop the migrated column
ALTER TABLE public.user_settings DROP COLUMN IF EXISTS live_trade_questions;
