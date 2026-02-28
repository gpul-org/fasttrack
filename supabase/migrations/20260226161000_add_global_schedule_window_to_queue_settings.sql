ALTER TABLE queue_settings
  ADD COLUMN IF NOT EXISTS schedule_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_end_at TIMESTAMPTZ;

ALTER TABLE queue_settings
  DROP CONSTRAINT IF EXISTS queue_settings_schedule_window_valid;

ALTER TABLE queue_settings
  ADD CONSTRAINT queue_settings_schedule_window_valid
  CHECK (
    schedule_start_at IS NULL
    OR schedule_end_at IS NULL
    OR schedule_end_at > schedule_start_at
  );
