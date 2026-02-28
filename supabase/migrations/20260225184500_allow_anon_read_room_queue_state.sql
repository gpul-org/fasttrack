DROP POLICY IF EXISTS "Anonymous users can read room queue state" ON room_queue_state;

CREATE POLICY "Anonymous users can read room queue state"
  ON room_queue_state FOR SELECT TO anon USING (true);
