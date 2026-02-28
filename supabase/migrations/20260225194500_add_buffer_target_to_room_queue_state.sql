ALTER TABLE room_queue_state
  ADD COLUMN IF NOT EXISTS buffer_target INTEGER NOT NULL DEFAULT 2 CHECK (buffer_target >= 0);
