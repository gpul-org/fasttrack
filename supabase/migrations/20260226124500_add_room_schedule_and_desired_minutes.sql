ALTER TABLE room_queue_state
  ADD COLUMN IF NOT EXISTS desired_minutes_per_team INTEGER NOT NULL DEFAULT 8 CHECK (desired_minutes_per_team > 0);
