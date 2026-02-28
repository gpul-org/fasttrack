CREATE OR REPLACE FUNCTION prevent_submission_overlap_in_queues()
RETURNS TRIGGER AS $$
DECLARE
  has_room_conflict BOOLEAN := FALSE;
  room_keywords TEXT[];
  submission_prizes TEXT[];
  is_eligible BOOLEAN := FALSE;
  has_cross_room_call_conflict BOOLEAN := FALSE;
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

    SELECT ARRAY(
      SELECT DISTINCT UPPER(TRIM(c.keyword))
      FROM room_challenges rc
      JOIN challenges c ON c.id = rc.challenge_id
      WHERE rc.room_id = NEW.room_id
    )
    INTO room_keywords;

    SELECT ARRAY(
      SELECT DISTINCT UPPER(TRIM(value))
      FROM submissions s
      CROSS JOIN UNNEST(COALESCE(s.prizes, ARRAY[]::TEXT[])) AS value
      WHERE s.id = NEW.submission_id
        AND TRIM(value) <> ''
    )
    INTO submission_prizes;

    IF room_keywords IS NULL OR CARDINALITY(room_keywords) = 0 THEN
      is_eligible := TRUE;
    ELSIF 'GENERAL' = ANY(room_keywords) THEN
      is_eligible := TRUE;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM UNNEST(room_keywords) AS room_keyword
        WHERE room_keyword = ANY(COALESCE(submission_prizes, ARRAY[]::TEXT[]))
      ) INTO is_eligible;
    END IF;

    IF NOT is_eligible THEN
      RAISE EXCEPTION 'This group is not eligible for the selected room challenge';
    END IF;
  END IF;

  IF NEW.status IN ('called', 'in_progress') THEN
    SELECT EXISTS (
      SELECT 1
      FROM queue_entries qe
      WHERE qe.submission_id = NEW.submission_id
        AND qe.room_id <> NEW.room_id
        AND qe.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
        AND qe.status IN ('called', 'in_progress')
    ) INTO has_cross_room_call_conflict;

    IF has_cross_room_call_conflict THEN
      RAISE EXCEPTION 'This group is already called or presenting in another room';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
