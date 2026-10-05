-- ============================================================================
-- Aura Meet (MyMeet) - Supabase Database Schema & Room Management Functions
-- ============================================================================
-- Run this complete SQL script in your Supabase Dashboard:
-- SQL Editor -> New Query -> Paste and Click "Run"
-- ============================================================================

-- 1. Create rooms table
CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    host_id TEXT NOT NULL,
    host_name TEXT NOT NULL,
    is_locked BOOLEAN DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    ended_at TIMESTAMPTZ
);

-- 2. Create room_participants table
CREATE TABLE IF NOT EXISTS public.room_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code TEXT NOT NULL REFERENCES public.rooms(code) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    avatar_color TEXT,
    is_host BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    left_at TIMESTAMPTZ,
    CONSTRAINT unique_room_user UNIQUE (room_code, user_id)
);

-- 3. Indexes for fast query performance
CREATE INDEX IF NOT EXISTS idx_rooms_code ON public.rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON public.rooms(status);
CREATE INDEX IF NOT EXISTS idx_participants_room_code ON public.room_participants(room_code);
CREATE INDEX IF NOT EXISTS idx_participants_active ON public.room_participants(room_code, is_active);
CREATE INDEX IF NOT EXISTS idx_participants_last_seen ON public.room_participants(last_seen_at);

-- 4. Function: Auto-close room when all active participants leave
CREATE OR REPLACE FUNCTION public.check_and_close_empty_room()
RETURNS TRIGGER AS $$
DECLARE
    active_count INT;
    r_code TEXT;
BEGIN
    r_code := COALESCE(NEW.room_code, OLD.room_code);
    
    -- Count active participants remaining in this room
    SELECT COUNT(*) INTO active_count
    FROM public.room_participants
    WHERE room_code = r_code AND is_active = true;

    -- If no active participants remain, close the room
    IF active_count = 0 THEN
        UPDATE public.rooms
        SET status = 'closed',
            ended_at = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now())
        WHERE code = r_code AND status = 'active';
    ELSE
        UPDATE public.rooms
        SET updated_at = timezone('utc'::text, now())
        WHERE code = r_code;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Trigger on room_participants update or delete
DROP TRIGGER IF EXISTS trg_check_room_empty ON public.room_participants;
CREATE TRIGGER trg_check_room_empty
AFTER INSERT OR UPDATE OF is_active OR DELETE ON public.room_participants
FOR EACH ROW
EXECUTE FUNCTION public.check_and_close_empty_room();

-- 6. RPC Function: Join or Create Room Atomically
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

    -- Check existing room
    SELECT * INTO v_room FROM public.rooms WHERE code = p_code;

    IF p_is_create THEN
        -- If room already exists in database
        IF v_room.id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_active_count FROM public.room_participants WHERE room_code = p_code AND is_active = true;
            IF v_active_count > 0 AND v_room.status = 'active' THEN
                -- If same host reconnects, update lock and keep active
                IF v_room.host_id = p_user_id THEN
                    UPDATE public.rooms 
                    SET is_locked = p_require_approval, status = 'active', updated_at = timezone('utc'::text, now())
                    WHERE code = p_code;
                END IF;
            ELSE
                -- Previous session ended or closed: reactivate room afresh
                UPDATE public.rooms
                SET host_id = p_user_id,
                    host_name = p_user_name,
                    is_locked = p_require_approval,
                    status = 'active',
                    created_at = timezone('utc'::text, now()),
                    updated_at = timezone('utc'::text, now()),
                    ended_at = NULL
                WHERE code = p_code;
            END IF;
        ELSE
            -- Insert brand new room
            INSERT INTO public.rooms (code, host_id, host_name, is_locked, status)
            VALUES (p_code, p_user_id, p_user_name, p_require_approval, 'active')
            RETURNING * INTO v_room;
        END IF;

        -- Upsert participant as host
        INSERT INTO public.room_participants (room_code, user_id, user_name, avatar_color, is_host, is_active, joined_at, last_seen_at, left_at)
        VALUES (p_code, p_user_id, p_user_name, p_avatar_color, true, true, timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
        ON CONFLICT (room_code, user_id) DO UPDATE
        SET user_name = EXCLUDED.user_name,
            avatar_color = EXCLUDED.avatar_color,
            is_host = true,
            is_active = true,
            last_seen_at = timezone('utc'::text, now()),
            left_at = NULL;

        SELECT * INTO v_room FROM public.rooms WHERE code = p_code;
        RETURN jsonb_build_object('success', true, 'room', row_to_json(v_room), 'is_host', true);

    ELSE
        -- Joining existing room
        IF v_room.id IS NULL OR v_room.status != 'active' THEN
            RETURN jsonb_build_object('success', false, 'error', 'ROOM_NOT_FOUND_OR_CLOSED');
        END IF;

        -- Upsert participant as active member
        INSERT INTO public.room_participants (room_code, user_id, user_name, avatar_color, is_host, is_active, joined_at, last_seen_at, left_at)
        VALUES (p_code, p_user_id, p_user_name, p_avatar_color, (v_room.host_id = p_user_id), true, timezone('utc'::text, now()), timezone('utc'::text, now()), NULL)
        ON CONFLICT (room_code, user_id) DO UPDATE
        SET user_name = EXCLUDED.user_name,
            avatar_color = EXCLUDED.avatar_color,
            is_active = true,
            last_seen_at = timezone('utc'::text, now()),
            left_at = NULL;

        RETURN jsonb_build_object(
            'success', true, 
            'room', row_to_json(v_room),
            'is_host', (v_room.host_id = p_user_id),
            'is_locked', v_room.is_locked
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC Function: Leave Room (closes room if no active participants remain)
CREATE OR REPLACE FUNCTION public.leave_room(
    p_code TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_active_count INT;
BEGIN
    p_code := lower(trim(p_code));

    UPDATE public.room_participants
    SET is_active = false,
        left_at = timezone('utc'::text, now())
    WHERE room_code = p_code AND user_id = p_user_id;

    -- Count active participants remaining
    SELECT COUNT(*) INTO v_active_count
    FROM public.room_participants
    WHERE room_code = p_code AND is_active = true;

    IF v_active_count = 0 THEN
        UPDATE public.rooms
        SET status = 'closed',
            ended_at = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now())
        WHERE code = p_code AND status = 'active';
    END IF;

    RETURN jsonb_build_object('success', true, 'remaining_participants', v_active_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RPC Function: Participant Heartbeat & Stale cleanup
CREATE OR REPLACE FUNCTION public.heartbeat_room(
    p_code TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
BEGIN
    p_code := lower(trim(p_code));

    UPDATE public.room_participants
    SET last_seen_at = timezone('utc'::text, now()),
        is_active = true
    WHERE room_code = p_code AND user_id = p_user_id;

    -- Mark participants who haven't sent a heartbeat for > 45 seconds as inactive
    UPDATE public.room_participants
    SET is_active = false,
        left_at = timezone('utc'::text, now())
    WHERE room_code = p_code AND is_active = true AND last_seen_at < (timezone('utc'::text, now()) - interval '45 seconds');

    -- If nobody active remains, close room
    IF NOT EXISTS (SELECT 1 FROM public.room_participants WHERE room_code = p_code AND is_active = true) THEN
        UPDATE public.rooms
        SET status = 'closed',
            ended_at = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now())
        WHERE code = p_code AND status = 'active';
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Row Level Security (RLS) policies for Anon & Authenticated access
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon all on rooms" ON public.rooms;
CREATE POLICY "Allow anon all on rooms" ON public.rooms FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon all on room_participants" ON public.room_participants;
CREATE POLICY "Allow anon all on room_participants" ON public.room_participants FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 10. Enable Realtime Replication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
