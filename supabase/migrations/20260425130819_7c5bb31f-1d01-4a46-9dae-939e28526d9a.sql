-- ============================================================
-- SHARED REPORTS
-- ============================================================
CREATE TABLE public.shared_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT 'Untitled report',
  intro text,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public_link','private')),
  period_start date,
  period_end date,
  author_display_name text,
  view_count integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shared_reports_user_id ON public.shared_reports(user_id);
CREATE INDEX idx_shared_reports_slug ON public.shared_reports(slug);

ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own shared reports"
  ON public.shared_reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Anonymous can view published public reports"
  ON public.shared_reports FOR SELECT
  TO anon
  USING (visibility = 'public_link' AND published_at IS NOT NULL);

CREATE POLICY "Authenticated can view published public reports"
  ON public.shared_reports FOR SELECT
  TO authenticated
  USING (visibility = 'public_link' AND published_at IS NOT NULL);

CREATE POLICY "Owners can insert own shared reports"
  ON public.shared_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can update own shared reports"
  ON public.shared_reports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Owners can delete own shared reports"
  ON public.shared_reports FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_shared_reports_updated_at
  BEFORE UPDATE ON public.shared_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- SHARED REPORT TRADES (junction)
-- ============================================================
CREATE TABLE public.shared_report_trades (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shared_report_id uuid NOT NULL REFERENCES public.shared_reports(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  caption_what_went_well text,
  caption_what_went_wrong text,
  caption_what_to_improve text,
  screenshot_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shared_report_id, trade_id)
);

CREATE INDEX idx_shared_report_trades_report ON public.shared_report_trades(shared_report_id);
CREATE INDEX idx_shared_report_trades_trade ON public.shared_report_trades(trade_id);

ALTER TABLE public.shared_report_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own report trades"
  ON public.shared_report_trades FOR SELECT
  USING (shared_report_id IN (SELECT id FROM public.shared_reports WHERE user_id = auth.uid()));

CREATE POLICY "Anonymous can view trades of published public reports"
  ON public.shared_report_trades FOR SELECT
  TO anon
  USING (shared_report_id IN (
    SELECT id FROM public.shared_reports
    WHERE visibility = 'public_link' AND published_at IS NOT NULL
  ));

CREATE POLICY "Authenticated can view trades of published public reports"
  ON public.shared_report_trades FOR SELECT
  TO authenticated
  USING (shared_report_id IN (
    SELECT id FROM public.shared_reports
    WHERE visibility = 'public_link' AND published_at IS NOT NULL
  ));

CREATE POLICY "Owners can insert own report trades"
  ON public.shared_report_trades FOR INSERT
  WITH CHECK (shared_report_id IN (SELECT id FROM public.shared_reports WHERE user_id = auth.uid()));

CREATE POLICY "Owners can update own report trades"
  ON public.shared_report_trades FOR UPDATE
  USING (shared_report_id IN (SELECT id FROM public.shared_reports WHERE user_id = auth.uid()));

CREATE POLICY "Owners can delete own report trades"
  ON public.shared_report_trades FOR DELETE
  USING (shared_report_id IN (SELECT id FROM public.shared_reports WHERE user_id = auth.uid()));

CREATE TRIGGER update_shared_report_trades_updated_at
  BEFORE UPDATE ON public.shared_report_trades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- KNOWLEDGE ENTRIES
-- ============================================================
CREATE TABLE public.knowledge_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  source_url text NOT NULL,
  source_title text,
  source_author text,
  source_published_at date,
  status text NOT NULL DEFAULT 'extracting' CHECK (status IN ('extracting','ready','failed')),
  error_message text,
  summary text,
  key_takeaways jsonb NOT NULL DEFAULT '[]'::jsonb,
  concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  screenshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_markdown text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_entries_user_id ON public.knowledge_entries(user_id);
CREATE INDEX idx_knowledge_entries_created_at ON public.knowledge_entries(created_at DESC);

ALTER TABLE public.knowledge_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own knowledge entries"
  ON public.knowledge_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own knowledge entries"
  ON public.knowledge_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own knowledge entries"
  ON public.knowledge_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own knowledge entries"
  ON public.knowledge_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_knowledge_entries_updated_at
  BEFORE UPDATE ON public.knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- KNOWLEDGE CHAT MESSAGES
-- ============================================================
CREATE TABLE public.knowledge_chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  knowledge_entry_id uuid NOT NULL REFERENCES public.knowledge_entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_chat_entry ON public.knowledge_chat_messages(knowledge_entry_id, created_at);
CREATE INDEX idx_knowledge_chat_user ON public.knowledge_chat_messages(user_id);

ALTER TABLE public.knowledge_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own knowledge chat"
  ON public.knowledge_chat_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own knowledge chat"
  ON public.knowledge_chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own knowledge chat"
  ON public.knowledge_chat_messages FOR DELETE
  USING (auth.uid() = user_id);
