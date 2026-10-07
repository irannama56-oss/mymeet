-- ============================================================================
-- 003_auto_close_empty_rooms.sql
-- Auto-close rooms that have been empty (no active participants) for 30+ minutes
-- ============================================================================
-- Run this in Supabase SQL Editor after the core schema (001).
-- This creates a server-side function that closes stale empty rooms.
-- Schedule it via Supabase Dashboard → Database → Extensions → pg_cron
-- or call it manually / from an Edge Function.
-- ============================================================================

-- Function: Close rooms that have no active participants for 30+ minutes
CREATE OR REPLACE FUNCTION public.auto_close_empty_rooms()
RETURNS JSONB AS $$
DECLARE
    v_closed_count INT := 0;
    v_room RECORD;
BEGIN
    -- Find active rooms where ALL participants are inactive
    -- AND the room hasn't been updated in the last 30 minutes
    FOR v_room IN
        SELECT r.code, r.id
        FROM public.rooms r
        WHERE r.status = 'active'
          AND r.updated_at < (timezone('utc'::text, now()) - interval '30 minutes')
          AND NOT EXISTS (
              SELECT 1 FROM public.room_participants rp
              WHERE rp.room_code = r.code AND rp.is_active = true
          )
    LOOP
        UPDATE public.rooms
        SET status = 'closed',
            ended_at = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now())
        WHERE code = v_room.code AND status = 'active';

        v_closed_count := v_closed_count + 1;
    END LOOP;

    -- Also mark stale participants (no heartbeat for 2+ minutes) as inactive
    UPDATE public.room_participants
    SET is_active = false,
        left_at = timezone('utc'::text, now())
    WHERE is_active = true
      AND last_seen_at < (timezone('utc'::text, now()) - interval '2 minutes');

    RETURN jsonb_build_object(
        'success', true,
        'rooms_closed', v_closed_count,
        'executed_at', timezone('utc'::text, now())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- OPTIONAL: If pg_cron extension is enabled, schedule auto-cleanup every 5 min:
--
--   SELECT cron.schedule(
--     'auto-close-empty-rooms',
--     '*/5 * * * *',
--     $$SELECT public.auto_close_empty_rooms()$$
--   );
--
-- To enable pg_cron: Supabase Dashboard → Database → Extensions → Search "pg_cron" → Enable
-- ============================================================================
