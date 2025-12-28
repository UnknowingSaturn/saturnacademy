-- Create notebook_entries table for daily journaling
CREATE TABLE public.notebook_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  content TEXT,
  market_conditions TEXT,
  mood_rating INTEGER CHECK (mood_rating >= 1 AND mood_rating <= 5),
  energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 5),
  goals JSONB DEFAULT '[]'::jsonb,
  reflection TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, entry_date)
);

-- Enable RLS
ALTER TABLE public.notebook_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own notebook entries"
ON public.notebook_entries FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own notebook entries"
ON public.notebook_entries FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notebook entries"
ON public.notebook_entries FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notebook entries"
ON public.notebook_entries FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_notebook_entries_updated_at
BEFORE UPDATE ON public.notebook_entries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for trade screenshots
INSERT INTO storage.buckets (id, name, public) 
VALUES ('trade-screenshots', 'trade-screenshots', true);

-- Storage policies for trade screenshots
CREATE POLICY "Users can view own screenshots"
ON storage.objects FOR SELECT
USING (bucket_id = 'trade-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload own screenshots"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'trade-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own screenshots"
ON storage.objects FOR UPDATE
USING (bucket_id = 'trade-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own screenshots"
ON storage.objects FOR DELETE
USING (bucket_id = 'trade-screenshots' AND auth.uid()::text = (storage.foldername(name))[1]);