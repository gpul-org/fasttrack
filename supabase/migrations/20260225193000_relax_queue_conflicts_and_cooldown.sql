DROP INDEX IF EXISTS queue_entries_unique_active_submission_idx;

CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_unique_active_submission_per_room_idx
  ON queue_entries (room_id, submission_id)
  WHERE status IN ('waiting', 'called', 'in_progress');

CREATE OR REPLACE FUNCTION prevent_submission_overlap_in_queues()
RETURNS TRIGGER AS $$
DECLARE
  has_room_conflict BOOLEAN := FALSE;
BEGIN
  IF NEW.status IN ('waiting', 'called', 'in_progress') THEN
    SELECT EXISTS (
      SELECT 1
      FROM queue_entries qe
      WHERE qe.room_id = NEW.room_id
        AND qe.submission_id = NEW.submission_id
        AND qe.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND qe.status IN ('waiting', 'called', 'in_progress')
    ) INTO has_room_conflict;

    IF has_room_conflict THEN
      RAISE EXCEPTION 'This group is already active in this room queue';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
