-- ============================================================================
-- 004_race_safe_join_or_create.sql
-- Makes join_or_create_room() race-safe and honest about who the host is.
-- ============================================================================
-- Run this in Supabase SQL Editor AFTER 001_core_schema.sql.
-- Safe to run on a live project: it only replaces one function.
--
-- Why:
--  1. The old version did "SELECT ... then INSERT". Two concurrent creates (a
--     double click, or a client retry after its own timeout) both saw "no room"
--     and both INSERTed, so one of them raised a unique violation on rooms.code
--     and PostgREST answered HTTP 409. The client then fell back to its own
--     upsert, which sometimes left the room uncreated and guests saw
--     "Meeting not found".
--  2. The create branch always returned 'is_host': true, even when the room
--     already belonged to another active host, so two hosts could appear.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.join_or_create_room(
    p_code TEXT,
    p_user_id TEXT,
    p_user_name TEXT,
    p_avatar_color TEXT DEFAULT NULL,
    p_is_create BOOLEAN DEFAULT false,
    p_require_approval BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
    v_room RECORD;
    v_active_count INT;
BEGIN
    p_code := lower(trim(p_code));

    IF p_is_create THEN
        -- Single race-free statement. When the row already exists we only take it
        -- over if we already own it, if the previous session ended, or if nobody
        -- is currently active in it — otherwise the existing host keeps the room.
        INSERT INTO public.rooms (code, host_id, host_name, is_locked, status)
        VALUES (p_code, p_user_id, p_user_name, p_require_approval, 'active')
        ON CONFLICT (code) DO UPDATE
        SET host_id    = EXCLUDED.host_id,
            host_name  = EXCLUDED.host_name,
            is_locked  = EXCLUDED.is_locked,
            status     = 'active',
            updated_at = timezone('utc'::text, now()),
            ended_at   = NULL
        WHERE public.rooms.host_id = p_user_id
           OR public.rooms.status <> 'active'
           OR NOT EXISTS (
                SELECT 1
                FROM public.room_participants rp
                WHERE rp.room_code = public.rooms.code
                  AND rp.is_active = true
              );

        -- Upsert the caller as a participant. `is_host` follows the room's real
        -- owner, so a guest who tried to "create" an occupied code is not promoted.
        INSERT INTO public.room_participants (
            room_code, user_id, user_name, avatar_color,
            is_host, is_active, joined_at, last_seen_at, left_at
        )
        SELECT
            p_code, p_user_id, p_user_name, p_avatar_color,
            (r.host_id = p_user_id), true,
            timezone('utc'::text, now()), timezone('utc'::text, now()), NULL
        FROM public.rooms r
        WHERE r.code = p_code
        ON CONFLICT (room_code, user_id) DO UPDATE
        SET user_name    = EXCLUDED.user_name,
            avatar_color = EXCLUDED.avatar_color,
            is_host      = EXCLUDED.is_host,
            is_active    = true,
            last_seen_at = timezone('utc'::text, now()),
            left_at      = NULL;

        SELECT * INTO v_room FROM public.rooms WHERE code = p_code;

        RETURN jsonb_build_object(
            'success', true,
            'room',    row_to_json(v_room),
            'is_host', (v_room.host_id = p_user_id),
            'is_locked', v_room.is_locked
        );

    ELSE
        -- Joining an existing room
        SELECT * INTO v_room FROM public.rooms WHERE code = p_code;

        IF v_room.id IS NULL OR v_room.status <> 'active' THEN
            RETURN jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND_OR_CLOSED');
        END IF;

        INSERT INTO public.room_participants (
            room_code, user_id, user_name, avatar_color,
            is_host, is_active, joined_at, last_seen_at, left_at
        )
        VALUES (
            p_code, p_user_id, p_user_name, p_avatar_color,
            (v_room.host_id = p_user_id), true,
            timezone('utc'::text, now()), timezone('utc'::text, now()), NULL
        )
        ON CONFLICT (room_code, user_id) DO UPDATE
        SET user_name    = EXCLUDED.user_name,
            avatar_color = EXCLUDED.avatar_color,
            is_active    = true,
            last_seen_at = timezone('utc'::text, now()),
            left_at      = NULL;

        RETURN jsonb_build_object(
            'success', true,
            'room',    row_to_json(v_room),
            'is_host', (v_room.host_id = p_user_id),
            'is_locked', v_room.is_locked
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Optional but recommended: a unique index makes ON CONFLICT (code) reliable even
-- if the column constraint was created differently.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_code_unique ON public.rooms(code);
