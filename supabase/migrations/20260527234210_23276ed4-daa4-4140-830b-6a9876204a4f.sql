-- Production cleanup: drop dead tables, tighten policies, optimize RLS.

-- 1. Drop unused AI tables (zero runtime references; superseded by inline prompts in edge functions).
DROP TABLE IF EXISTS public.ai_feedback CASCADE;
DROP TABLE IF EXISTS public.ai_prompts CASCADE;

-- 2. Restrict prop_firm_rules to authenticated users (was world-readable to anon).
DROP POLICY IF EXISTS "Anyone can view prop firm rules" ON public.prop_firm_rules;
CREATE POLICY "Authenticated users can view prop firm rules"
  ON public.prop_firm_rules
  FOR SELECT
  TO authenticated
  USING (true);

-- 3. Optimize ai_reviews policies: use the direct user_id column instead of
--    a subquery against trades. Same security guarantee, far cheaper per request.
DROP POLICY IF EXISTS "Users can delete own AI reviews" ON public.ai_reviews;
DROP POLICY IF EXISTS "Users can insert own AI reviews" ON public.ai_reviews;
DROP POLICY IF EXISTS "Users can update own AI reviews" ON public.ai_reviews;
DROP POLICY IF EXISTS "Users can view own AI reviews"   ON public.ai_reviews;

CREATE POLICY "Users can view own AI reviews"
  ON public.ai_reviews FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own AI reviews"
  ON public.ai_reviews FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own AI reviews"
  ON public.ai_reviews FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own AI reviews"
  ON public.ai_reviews FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4. Add the missing UPDATE policy on setup_tokens so the consume (used = true)
--    flow can succeed under RLS instead of silently no-op'ing.
CREATE POLICY "Users can update own setup tokens"
  ON public.setup_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);