-- ============================================================================
-- 002_admin_system.sql
-- Aura Meet (MyMeet) - Admin Panel, Authentication & Room Management RPCs
-- ============================================================================
-- Run this script SECOND in Supabase SQL Editor:
-- SQL Editor -> New Query -> Paste and Click "Run"
-- ============================================================================

-- 1. Create admin_users table
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT 'Super Admin',
    role TEXT NOT NULL DEFAULT 'superadmin' CHECK (role IN ('superadmin', 'admin', 'moderator')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_login_at TIMESTAMPTZ
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_admin_email ON public.admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_active ON public.admin_users(is_active);

-- 3. Seed Default Super Admin Account
-- Email: mohammad.m.sadeghi98@gmail.com
-- Password: moha3447
-- SHA-256 Hash of 'moha3447' = 'b5935771f43bbca6b350f841baa5ed7fb25fbaa8168ebdff549fa16295f46680'
INSERT INTO public.admin_users (email, password_hash, full_name, role, is_active)
VALUES (
    'mohammad.m.sadeghi98@gmail.com',
    'b5935771f43bbca6b350f841baa5ed7fb25fbaa8168ebdff549fa16295f46680',
    'Super Admin',
    'superadmin',
    true
)
ON CONFLICT (email) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = 'superadmin',
    is_active = true;

-- 4. RPC Function: Admin Authentication
CREATE OR REPLACE FUNCTION public.admin_authenticate(
    p_email TEXT,
    p_password_hash TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_admin RECORD;
BEGIN
    p_email := lower(trim(p_email));
    p_password_hash := lower(trim(p_password_hash));

    SELECT * INTO v_admin
    FROM public.admin_users
    WHERE lower(email) = p_email AND password_hash = p_password_hash AND is_active = true;

    IF v_admin.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_CREDENTIALS');
    END IF;

    -- Update last login timestamp
    UPDATE public.admin_users
    SET last_login_at = timezone('utc'::text, now())
    WHERE id = v_admin.id;

    RETURN jsonb_build_object(
        'success', true,
        'admin', jsonb_build_object(
            'id', v_admin.id,
            'email', v_admin.email,
            'fullName', v_admin.full_name,
            'role', v_admin.role,
            'createdAt', v_admin.created_at,
            'lastLoginAt', timezone('utc'::text, now())
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC Function: Admin Get All Rooms (with active participant count)
CREATE OR REPLACE FUNCTION public.admin_get_all_rooms()
RETURNS JSONB AS $$
DECLARE
    v_rooms JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', r.id,
            'code', r.code,
            'hostId', r.host_id,
            'hostName', r.host_name,
            'isLocked', r.is_locked,
            'status', r.status,
            'createdAt', r.created_at,
            'updatedAt', r.updated_at,
            'endedAt', r.ended_at,
            'activeParticipantsCount', COALESCE(p.active_count, 0),
            'totalParticipantsCount', COALESCE(p.total_count, 0)
        ) ORDER BY r.created_at DESC
    ) INTO v_rooms
    FROM public.rooms r
    LEFT JOIN (
        SELECT 
            room_code,
            COUNT(*) FILTER (WHERE is_active = true) as active_count,
            COUNT(*) as total_count
        FROM public.room_participants
        GROUP BY room_code
    ) p ON r.code = p.room_code;

    RETURN jsonb_build_object('success', true, 'rooms', COALESCE(v_rooms, '[]'::jsonb));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC Function: Admin Force Close Room
CREATE OR REPLACE FUNCTION public.admin_close_room(
    p_code TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_cleaned TEXT;
BEGIN
    v_cleaned := lower(trim(p_code));

    UPDATE public.rooms
    SET status = 'closed',
        ended_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE code = v_cleaned;

    UPDATE public.room_participants
    SET is_active = false,
        left_at = timezone('utc'::text, now())
    WHERE room_code = v_cleaned AND is_active = true;

    RETURN jsonb_build_object('success', true, 'code', v_cleaned);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC Function: Admin Delete Room Record
CREATE OR REPLACE FUNCTION public.admin_delete_room(
    p_code TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_cleaned TEXT;
BEGIN
    v_cleaned := lower(trim(p_code));

    DELETE FROM public.room_participants WHERE room_code = v_cleaned;
    DELETE FROM public.rooms WHERE code = v_cleaned;

    RETURN jsonb_build_object('success', true, 'code', v_cleaned);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RPC Function: Admin Create Room
CREATE OR REPLACE FUNCTION public.admin_create_room(
    p_code TEXT,
    p_host_name TEXT DEFAULT 'Super Admin',
    p_is_locked BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
    v_cleaned TEXT;
    v_room RECORD;
BEGIN
    v_cleaned := lower(trim(p_code));

    -- Check if room code already active
    SELECT * INTO v_room FROM public.rooms WHERE code = v_cleaned;

    IF v_room.id IS NOT NULL THEN
        UPDATE public.rooms
        SET host_name = p_host_name,
            is_locked = p_is_locked,
            status = 'active',
            created_at = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now()),
            ended_at = NULL
        WHERE code = v_cleaned
        RETURNING * INTO v_room;
    ELSE
        INSERT INTO public.rooms (code, host_id, host_name, is_locked, status)
        VALUES (v_cleaned, 'admin_master', p_host_name, p_is_locked, 'active')
        RETURNING * INTO v_room;
    END IF;

    RETURN jsonb_build_object('success', true, 'room', row_to_json(v_room));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. RPC Function: Admin System Statistics
CREATE OR REPLACE FUNCTION public.admin_get_system_stats()
RETURNS JSONB AS $$
DECLARE
    v_total_rooms INT;
    v_active_rooms INT;
    v_closed_rooms INT;
    v_active_participants INT;
    v_total_participants INT;
BEGIN
    SELECT COUNT(*) INTO v_total_rooms FROM public.rooms;
    SELECT COUNT(*) INTO v_active_rooms FROM public.rooms WHERE status = 'active';
    SELECT COUNT(*) INTO v_closed_rooms FROM public.rooms WHERE status = 'closed';
    SELECT COUNT(*) INTO v_active_participants FROM public.room_participants WHERE is_active = true;
    SELECT COUNT(*) INTO v_total_participants FROM public.room_participants;

    RETURN jsonb_build_object(
        'success', true,
        'stats', jsonb_build_object(
            'totalRooms', v_total_rooms,
            'activeRooms', v_active_rooms,
            'closedRooms', v_closed_rooms,
            'activeParticipants', v_active_participants,
            'totalParticipants', v_total_participants
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. RLS on admin_users
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon all on admin_users" ON public.admin_users;
CREATE POLICY "Allow anon all on admin_users" ON public.admin_users FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
