
-- Create strategy_conversations table
CREATE TABLE public.strategy_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  playbook_id UUID REFERENCES public.playbooks(id) ON DELETE SET NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT NOT NULL DEFAULT 'google/gemini-2.5-pro',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.strategy_conversations ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own strategy conversations"
  ON public.strategy_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own strategy conversations"
  ON public.strategy_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strategy conversations"
  ON public.strategy_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own strategy conversations"
  ON public.strategy_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_strategy_conversations_updated_at
  BEFORE UPDATE ON public.strategy_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_strategy_conversations_user_id ON public.strategy_conversations(user_id);
CREATE INDEX idx_strategy_conversations_playbook_id ON public.strategy_conversations(playbook_id);
