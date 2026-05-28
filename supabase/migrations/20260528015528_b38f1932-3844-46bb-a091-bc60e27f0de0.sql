
-- 1. Add scope column
ALTER TABLE public.custom_field_definitions
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'user';

-- 2. Replace unique constraint to include scope
ALTER TABLE public.custom_field_definitions
  DROP CONSTRAINT IF EXISTS custom_field_definitions_user_id_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS custom_field_definitions_user_scope_key_uidx
  ON public.custom_field_definitions (user_id, scope, key);

-- 3. Backfill field_overrides → scope='system_override'
INSERT INTO public.custom_field_definitions
  (user_id, scope, key, label, type, options, default_value, is_active, sort_order, created_at, updated_at)
SELECT
  fo.user_id,
  'system_override',
  fo.field_key,
  fo.field_key,
  fo.type,
  COALESCE(fo.options, '[]'::jsonb),
  fo.default_value,
  true,
  0,
  fo.created_at,
  fo.updated_at
FROM public.field_overrides fo
ON CONFLICT (user_id, scope, key) DO NOTHING;

-- 4. Backfill property_options grouped → scope='system_options', one row per property_name
INSERT INTO public.custom_field_definitions
  (user_id, scope, key, label, type, options, default_value, is_active, sort_order, created_at, updated_at)
SELECT
  po.user_id,
  'system_options',
  po.property_name,
  po.property_name,
  'select',
  jsonb_agg(
    jsonb_build_object(
      'value', po.value,
      'label', po.label,
      'color', po.color,
      'is_active', po.is_active,
      'sort_order', po.sort_order
    )
    ORDER BY po.sort_order, po.value
  ),
  NULL,
  true,
  0,
  MIN(po.created_at),
  MAX(po.updated_at)
FROM public.property_options po
GROUP BY po.user_id, po.property_name
ON CONFLICT (user_id, scope, key) DO NOTHING;

-- 5. Drop legacy tables
DROP TABLE IF EXISTS public.property_options;
DROP TABLE IF EXISTS public.field_overrides;
