-- Migration: Add profile pictures and image messages support
-- Run this migration to add profile pictures and image messages

-- Add profile_picture_url to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Add image_url to messages table (for image messages)
-- Also add image_width and image_height for proper rendering
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_width INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_height INTEGER;

-- Create index for faster lookups on messages with images
CREATE INDEX IF NOT EXISTS idx_messages_has_image ON messages(conversation_id) WHERE image_url IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN users.profile_picture_url IS 'Base64 data URL or external URL for user profile picture';
COMMENT ON COLUMN messages.image_url IS 'Base64 data URL for image messages';
COMMENT ON COLUMN messages.image_width IS 'Original width of image in pixels';
COMMENT ON COLUMN messages.image_height IS 'Original height of image in pixels';
