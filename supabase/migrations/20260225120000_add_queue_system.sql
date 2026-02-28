-- Queue status lifecycle
CREATE TYPE queue_status AS ENUM (
  'waiting',
  'called',
  'in_progress',
  'completed',
  'skipped',
  'cancelled'
);

-- Global queue settings (single-row table)
CREATE TABLE queue_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  handoff_buffer_minutes INTEGER NOT NULL DEFAULT 5 CHECK (handoff_buffer_minutes >= 0)
);

INSERT INTO queue_settings (id, handoff_buffer_minutes)
VALUES (TRUE, 5)
ON CONFLICT (id) DO NOTHING;

-- Queue entries per room
CREATE TABLE queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number BIGSERIAL NOT NULL UNIQUE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  status queue_status NOT NULL DEFAULT 'waiting',
  priority INTEGER NOT NULL DEFAULT 0,
  called_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX queue_entries_room_status_idx
  ON queue_entries (room_id, status, priority DESC, created_at ASC);

CREATE INDEX queue_entries_submission_status_idx
  ON queue_entries (submission_id, status, updated_at DESC);

-- One active queue entry per submission across all rooms
CREATE UNIQUE INDEX queue_entries_unique_active_submission_idx
  ON queue_entries (submission_id)
  WHERE status IN ('waiting', 'called', 'in_progress');

-- Judge/admin reviews per queue entry
CREATE TABLE queue_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_entry_id UUID NOT NULL UNIQUE REFERENCES queue_entries(id) ON DELETE CASCADE,
  judge_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score SMALLINT NOT NULL CHECK (score >= 0 AND score <= 10),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX queue_reviews_judge_idx ON queue_reviews (judge_id, updated_at DESC);

-- Timestamp triggers
CREATE OR REPLACE FUNCTION handle_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_queue_entries_updated_at
  BEFORE UPDATE ON queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION handle_queue_updated_at();

CREATE TRIGGER set_queue_reviews_updated_at
  BEFORE UPDATE ON queue_reviews
  FOR EACH ROW
  EXECUTE FUNCTION handle_queue_updated_at();

-- Transition timestamps
CREATE OR REPLACE FUNCTION set_queue_transition_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'called' AND NEW.called_at IS NULL THEN
      NEW.called_at = NOW();
    END IF;

    IF NEW.status = 'in_progress' AND NEW.started_at IS NULL THEN
      NEW.started_at = NOW();
      IF NEW.called_at IS NULL THEN
        NEW.called_at = NOW();
      END IF;
    END IF;

    IF NEW.status IN ('completed', 'skipped', 'cancelled') AND NEW.completed_at IS NULL THEN
      NEW.completed_at = NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER queue_entries_set_transition_timestamps
  BEFORE UPDATE ON queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION set_queue_transition_timestamps();

-- Guard against cross-room conflicts + cooldown/buffer
CREATE OR REPLACE FUNCTION prevent_submission_overlap_in_queues()
RETURNS TRIGGER AS $$
DECLARE
  buffer_minutes INTEGER := 0;
  has_active_conflict BOOLEAN := FALSE;
  has_recent_conflict BOOLEAN := FALSE;
BEGIN
  SELECT handoff_buffer_minutes
  INTO buffer_minutes
  FROM queue_settings
  WHERE id = TRUE;

  IF buffer_minutes IS NULL THEN
    buffer_minutes := 0;
  END IF;

  -- Enforce only for statuses that represent being in flow
  IF NEW.status IN ('waiting', 'called', 'in_progress') THEN
    SELECT EXISTS (
      SELECT 1
      FROM queue_entries qe
      WHERE qe.submission_id = NEW.submission_id
        AND qe.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND qe.status IN ('waiting', 'called', 'in_progress')
    ) INTO has_active_conflict;

    IF has_active_conflict THEN
      RAISE EXCEPTION 'This group is already active in another room queue';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM queue_entries qe
      WHERE qe.submission_id = NEW.submission_id
        AND qe.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND qe.status IN ('completed', 'skipped', 'cancelled')
        AND qe.completed_at IS NOT NULL
        AND qe.completed_at > NOW() - (buffer_minutes || ' minutes')::INTERVAL
    ) INTO has_recent_conflict;

    IF has_recent_conflict THEN
      RAISE EXCEPTION 'This group is in cooldown buffer and cannot be queued yet';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER queue_entries_prevent_overlap
  BEFORE INSERT OR UPDATE ON queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION prevent_submission_overlap_in_queues();

ALTER TABLE queue_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_reviews ENABLE ROW LEVEL SECURITY;

-- queue_settings
CREATE POLICY "Authenticated users can read queue settings"
  ON queue_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can update queue settings"
  ON queue_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- queue_entries
CREATE POLICY "Authenticated users can read queue entries"
  ON queue_entries FOR SELECT TO authenticated USING (true);

CREATE POLICY "Anonymous users can read queue entries"
  ON queue_entries FOR SELECT TO anon USING (true);

CREATE POLICY "Judges and admins can insert queue entries"
  ON queue_entries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('judge', 'admin')
    )
  );

CREATE POLICY "Judges and admins can update queue entries"
  ON queue_entries FOR UPDATE TO authenticated
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

-- queue_reviews
CREATE POLICY "Authenticated users can read queue reviews"
  ON queue_reviews FOR SELECT TO authenticated USING (true);

CREATE POLICY "Judges and admins can insert queue reviews"
  ON queue_reviews FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('judge', 'admin')
    )
  );

CREATE POLICY "Judges and admins can update queue reviews"
  ON queue_reviews FOR UPDATE TO authenticated
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

-- Public TV needs read-only access to room/challenge/submission/participant context
CREATE POLICY "Anonymous users can read rooms"
  ON rooms FOR SELECT TO anon USING (true);

CREATE POLICY "Anonymous users can read room_challenges"
  ON room_challenges FOR SELECT TO anon USING (true);

CREATE POLICY "Anonymous users can read room_judges"
  ON room_judges FOR SELECT TO anon USING (true);

CREATE POLICY "Anonymous users can read challenges"
  ON challenges FOR SELECT TO anon USING (true);

CREATE POLICY "Anonymous users can read submissions"
  ON submissions FOR SELECT TO anon USING (true);

CREATE POLICY "Anonymous users can read submission_participants"
  ON submission_participants FOR SELECT TO anon USING (true);

CREATE POLICY "Anonymous users can read participants"
  ON participants FOR SELECT TO anon USING (true);