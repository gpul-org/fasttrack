CREATE TABLE IF NOT EXISTS room_queue_state (
  room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  is_ready BOOLEAN NOT NULL DEFAULT false,
  is_paused BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO room_queue_state (room_id)
SELECT r.id
FROM rooms r
LEFT JOIN room_queue_state s ON s.room_id = r.id
WHERE s.room_id IS NULL;

CREATE OR REPLACE FUNCTION handle_room_queue_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_room_queue_state_updated_at ON room_queue_state;

CREATE TRIGGER set_room_queue_state_updated_at
  BEFORE UPDATE ON room_queue_state
  FOR EACH ROW
  EXECUTE FUNCTION handle_room_queue_state_updated_at();

CREATE OR REPLACE FUNCTION set_room_queue_state_started_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_ready = TRUE AND NEW.started_at IS NULL THEN
    NEW.started_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_room_queue_state_started_at_trigger ON room_queue_state;

CREATE TRIGGER set_room_queue_state_started_at_trigger
  BEFORE INSERT OR UPDATE ON room_queue_state
  FOR EACH ROW
  EXECUTE FUNCTION set_room_queue_state_started_at();

ALTER TABLE room_queue_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read room queue state" ON room_queue_state;
CREATE POLICY "Authenticated users can read room queue state"
  ON room_queue_state FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Judges and admins can update room queue state" ON room_queue_state;
CREATE POLICY "Judges and admins can update room queue state"
  ON room_queue_state FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('judge', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('judge', 'admin')
    )
  );

DROP POLICY IF EXISTS "Judges and admins can insert room queue state" ON room_queue_state;
CREATE POLICY "Judges and admins can insert room queue state"
  ON room_queue_state FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('judge', 'admin')
    )
  );
