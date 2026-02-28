ALTER TABLE queue_reviews
  ADD COLUMN answers JSONB NOT NULL DEFAULT '[]'::jsonb;
