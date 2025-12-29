-- Add missing columns to ai_reviews table for complete AI analysis storage
ALTER TABLE ai_reviews 
ADD COLUMN IF NOT EXISTS thesis_evaluation jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS visual_analysis jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS strategy_refinement jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS screenshots_analyzed boolean DEFAULT false;