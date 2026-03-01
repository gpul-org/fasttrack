-- Add Discord handle to participant profile
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS discord_username TEXT;
