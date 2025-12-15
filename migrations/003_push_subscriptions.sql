-- Push notification subscriptions table
-- Run this migration after generating VAPID keys

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who owns this subscription
  -- For admin: user_id is NULL, is_admin is TRUE
  -- For users: user_id is set, is_admin is FALSE
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- The push subscription object from browser
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,  -- Public key for encryption
  auth TEXT NOT NULL,    -- Auth secret
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure either user_id is set OR is_admin is true, not both
  CONSTRAINT valid_subscription CHECK (
    (user_id IS NOT NULL AND is_admin = FALSE) OR
    (user_id IS NULL AND is_admin = TRUE)
  )
);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Index for admin subscriptions
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_admin ON push_subscriptions(is_admin) WHERE is_admin = TRUE;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS push_subscriptions_updated_at ON push_subscriptions;
CREATE TRIGGER push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_push_subscriptions_updated_at();
