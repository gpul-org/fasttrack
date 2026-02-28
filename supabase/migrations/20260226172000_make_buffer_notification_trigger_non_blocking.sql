-- Keep queue flow resilient: notification failures must not block moving teams to buffer.
CREATE OR REPLACE FUNCTION public.notify_buffer_call_trigger()
RETURNS TRIGGER AS $$
DECLARE
  near_entry RECORD;
  supabase_url TEXT := current_setting('app.settings.supabase_url', true);
  service_role_key TEXT := current_setting('app.settings.supabase_service_role_key', true);
BEGIN
  IF NOT (NEW.status = 'called' AND OLD.status IS DISTINCT FROM 'called') THEN
    RETURN NEW;
  END IF;

  IF supabase_url IS NULL OR supabase_url = '' OR service_role_key IS NULL OR service_role_key = '' THEN
    RAISE NOTICE 'Skipping notify-buffer-call: missing app.settings.supabase_url or app.settings.supabase_service_role_key';
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := concat(supabase_url, '/functions/v1/notify-buffer-call'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', concat('Bearer ', service_role_key)
      ),
      body := jsonb_build_object(
        'notification_type', 'called',
        'type', 'UPDATE',
        'table', 'queue_entries',
        'record', jsonb_build_object(
          'id', NEW.id,
          'submission_id', NEW.submission_id,
          'status', NEW.status,
          'called_at', NEW.called_at,
          'room_id', NEW.room_id
        ),
        'old_record', jsonb_build_object(
          'status', OLD.status
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify-buffer-call (called) failed for queue entry %: %', NEW.id, SQLERRM;
  END;

  SELECT qe.id, qe.submission_id, qe.status, qe.called_at, qe.room_id
  INTO near_entry
  FROM public.queue_entries qe
  WHERE qe.room_id = NEW.room_id
    AND qe.status = 'waiting'
  ORDER BY qe.priority DESC, qe.created_at ASC
  LIMIT 1;

  IF near_entry.id IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := concat(supabase_url, '/functions/v1/notify-buffer-call'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', concat('Bearer ', service_role_key)
        ),
        body := jsonb_build_object(
          'notification_type', 'near_buffer',
          'type', 'UPDATE',
          'table', 'queue_entries',
          'record', jsonb_build_object(
            'id', near_entry.id,
            'submission_id', near_entry.submission_id,
            'status', near_entry.status,
            'called_at', near_entry.called_at,
            'room_id', near_entry.room_id
          ),
          'old_record', jsonb_build_object(
            'status', near_entry.status
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify-buffer-call (near_buffer) failed for queue entry %: %', near_entry.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS queue_entries_buffer_call_trigger ON public.queue_entries;

CREATE TRIGGER queue_entries_buffer_call_trigger
  AFTER UPDATE ON public.queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_buffer_call_trigger();
