-- Add new session types to the enum
ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'new_york_am';
ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'new_york_pm';