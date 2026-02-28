-- Prevent duplicate non-cancelled queue entries for the same submission in the same room
-- Keep the oldest non-cancelled entry and cancel newer duplicates before enforcing the index.
WITH duplicated AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY room_id, submission_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM queue_entries
  WHERE status <> 'cancelled'
)
UPDATE queue_entries qe
SET status = 'cancelled'
FROM duplicated d
WHERE qe.id = d.id
  AND d.rn > 1
  AND qe.status <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_unique_room_submission_active_idx
  ON queue_entries (room_id, submission_id)
  WHERE status <> 'cancelled';
