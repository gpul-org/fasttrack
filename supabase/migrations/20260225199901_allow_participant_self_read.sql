-- Allow participants to read their own participant/submission records using auth email

CREATE POLICY "Participants can read own participant row"
  ON participants FOR SELECT TO authenticated
  USING (
    lower(email) = lower((auth.jwt() ->> 'email'))
  );

CREATE POLICY "Participants can read own submission links"
  ON submission_participants FOR SELECT TO authenticated
  USING (
    participant_id IN (
      SELECT id FROM participants
      WHERE lower(email) = lower((auth.jwt() ->> 'email'))
    )
  );

CREATE POLICY "Participants can read own submissions"
  ON submissions FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT submission_id FROM submission_participants
      WHERE participant_id IN (
        SELECT id FROM participants
        WHERE lower(email) = lower((auth.jwt() ->> 'email'))
      )
    )
  );
