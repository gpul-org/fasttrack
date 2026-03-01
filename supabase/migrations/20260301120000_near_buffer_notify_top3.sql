-- Remove web-push DB trigger. Discord notifications (sent from the frontend) are the only channel used.
DROP TRIGGER IF EXISTS queue_entries_buffer_call_trigger ON public.queue_entries;
DROP FUNCTION IF EXISTS public.notify_buffer_call_trigger();

