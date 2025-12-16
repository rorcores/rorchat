-- Migration: Add username change tracking
-- Limits username changes to 3 per day

-- Add columns to track username changes
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changes_today INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_change_date DATE;

-- Comments for documentation
COMMENT ON COLUMN users.username_changes_today IS 'Number of username changes made on username_change_date';
COMMENT ON COLUMN users.username_change_date IS 'Date of last username change (used to reset daily counter)';
