ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS call_attempts INTEGER NOT NULL DEFAULT 0 CHECK (call_attempts >= 0);

UPDATE queue_entries
SET call_attempts = 1
WHERE call_attempts = 0
  AND called_at IS NOT NULL;

INSERT INTO challenges (title, keyword, questions)
VALUES ('Main Challenge', 'GENERAL', '[]'::jsonb)
ON CONFLICT (keyword) DO NOTHING;
