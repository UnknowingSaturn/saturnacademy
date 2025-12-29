-- Create user_settings table for column visibility, order, and filter presets
CREATE TABLE public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  visible_columns JSONB NOT NULL DEFAULT '["symbol", "direction", "entry_time", "exit_time", "net_pnl", "r_multiple_actual", "session"]'::jsonb,
  column_order JSONB NOT NULL DEFAULT '["symbol", "direction", "entry_time", "exit_time", "entry_price", "exit_price", "total_lots", "net_pnl", "r_multiple_actual", "session", "duration_seconds"]'::jsonb,
  default_filters JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS on user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_settings
CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own settings" ON public.user_settings FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create session_definitions table for custom trading sessions
CREATE TABLE public.session_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  start_hour INTEGER NOT NULL CHECK (start_hour >= 0 AND start_hour <= 23),
  start_minute INTEGER NOT NULL DEFAULT 0 CHECK (start_minute >= 0 AND start_minute <= 59),
  end_hour INTEGER NOT NULL CHECK (end_hour >= 0 AND end_hour <= 23),
  end_minute INTEGER NOT NULL DEFAULT 0 CHECK (end_minute >= 0 AND end_minute <= 59),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  color TEXT NOT NULL DEFAULT '#3B82F6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Enable RLS on session_definitions
ALTER TABLE public.session_definitions ENABLE ROW LEVEL SECURITY;

-- RLS policies for session_definitions
CREATE POLICY "Users can view own sessions" ON public.session_definitions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own sessions" ON public.session_definitions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.session_definitions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON public.session_definitions FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_session_definitions_updated_at
  BEFORE UPDATE ON public.session_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create property_options table for Notion-style property configuration
CREATE TABLE public.property_options (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  property_name TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, property_name, value)
);

-- Enable RLS on property_options
ALTER TABLE public.property_options ENABLE ROW LEVEL SECURITY;

-- RLS policies for property_options
CREATE POLICY "Users can view own property options" ON public.property_options FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own property options" ON public.property_options FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own property options" ON public.property_options FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own property options" ON public.property_options FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_property_options_updated_at
  BEFORE UPDATE ON public.property_options
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();