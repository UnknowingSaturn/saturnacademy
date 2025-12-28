-- Create setup_tokens table for temporary connection keys
CREATE TABLE public.setup_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  used BOOLEAN DEFAULT false,
  used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.setup_tokens ENABLE ROW LEVEL SECURITY;

-- Users can view their own tokens
CREATE POLICY "Users can view own setup tokens"
ON public.setup_tokens
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own tokens
CREATE POLICY "Users can create own setup tokens"
ON public.setup_tokens
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own tokens
CREATE POLICY "Users can delete own setup tokens"
ON public.setup_tokens
FOR DELETE
USING (auth.uid() = user_id);

-- Index for fast token lookup
CREATE INDEX idx_setup_tokens_token ON public.setup_tokens(token);
CREATE INDEX idx_setup_tokens_user_id ON public.setup_tokens(user_id);