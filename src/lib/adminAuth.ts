import { getSupabaseClient } from './supabase';
import { AdminUser, AdminRoomSummary, AdminSystemStats, cleanRoomCode } from './types';

const ADMIN_STORAGE_KEY = 'aura_admin_session';

// Known hardcoded Super Admin credentials hash for secure fallback
const SUPER_ADMIN_EMAIL = 'mohammad.m.sadeghi98@gmail.com';
const SUPER_ADMIN_HASH = 'b5935771f43bbca6b350f841baa5ed7fb25fbaa8168ebdff549fa16295f46680'; // SHA-256 of moha3447

/**
 * SHA-256 cryptographic password hashing using browser Web Crypto API
 */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function withTimeout<T>(
  promiseLike: PromiseLike<T> | Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: any = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    const result = await Promise.race([Promise.resolve(promiseLike), timeoutPromise]);
    return result;
  } catch (err) {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Admin Login Authentication with Supabase RPC and secure client verification fallback
 */
export async function adminLogin(
  emailInput: string,
  passwordInput: string
): Promise<{ success: boolean; error?: string; admin?: AdminUser }> {
  const cleanEmail = emailInput.trim().toLowerCase();
  if (!cleanEmail || !passwordInput) {
    return { success: false, error: 'Email and password are required' };
  }

  const computedHash = await hashPassword(passwordInput.trim());

  const client = getSupabaseClient();
  let rpcSuccess = false;
  let adminResult: AdminUser | null = null;

  if (client) {
    try {
      const query = client.rpc('admin_authenticate', {
        p_email: cleanEmail,
        p_password_hash: computedHash,
      });

      const response = await withTimeout<{ data: any; error: any }>(query, 3000, {
        data: null,
        error: { message: 'TIMEOUT' },
      });

      if (!response.error && response.data && response.data.success && response.data.admin) {
        rpcSuccess = true;
        adminResult = response.data.admin;
      }
    } catch (e) {
      console.warn('admin_authenticate RPC exception:', e);
    }
  }

  // Fallback verification if database RPC is not reachable or offline
  if (!rpcSuccess) {
    if (cleanEmail === SUPER_ADMIN_EMAIL && computedHash === SUPER_ADMIN_HASH) {
      adminResult = {
        id: 'admin_master_super',
        email: SUPER_ADMIN_EMAIL,
        fullName: 'Super Admin',
        role: 'superadmin',
        lastLoginAt: new Date().toISOString(),
      };
      rpcSuccess = true;
    }
  }

  if (rpcSuccess && adminResult) {
    try {
      localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminResult));
    } catch {}
    return { success: true, admin: adminResult };
  }

  return { success: false, error: 'Invalid email or password' };
}

/**
 * Check if an admin is currently logged in
 */
export function getStoredAdminSession(): AdminUser | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.email && parsed.role) {
      return parsed;
    }
  } catch {}
  return null;
}

/**
 * Logout admin
 */
export function adminLogout(): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ADMIN_STORAGE_KEY);
    }
  } catch {}
}

/**
 * Fetch all meetings for Admin Panel
 */
export async function adminGetAllRooms(): Promise<AdminRoomSummary[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  try {
    // 1. Try admin_get_all_rooms RPC
    const rpcQuery = client.rpc('admin_get_all_rooms');
    const rpcRes = await withTimeout<{ data: any; error: any }>(rpcQuery, 3000, {
      data: null,
      error: { message: 'TIMEOUT' },
    });

    if (!rpcRes.error && rpcRes.data && rpcRes.data.success && Array.isArray(rpcRes.data.rooms)) {
      return rpcRes.data.rooms;
    }

    // 2. Direct tables fallback
    const { data: rooms, error } = await withTimeout<{ data: any[] | null; error: any }>(
      client.from('rooms').select('*').order('created_at', { ascending: false }).limit(100),
      3000,
      { data: null, error: null }
    );

    if (error || !rooms) return [];

    const { data: participants } = await withTimeout<{ data: any[] | null; error: any }>(
      client.from('room_participants').select('*'),
      2500,
      { data: null, error: null }
    );

    const partMap = new Map<string, { active: number; total: number }>();
    if (participants) {
      participants.forEach((p) => {
        const current = partMap.get(p.room_code) || { active: 0, total: 0 };
        current.total += 1;
        if (p.is_active) current.active += 1;
        partMap.set(p.room_code, current);
      });
    }

    return rooms.map((r) => {
      const counts = partMap.get(r.code) || { active: 0, total: 0 };
      return {
        id: r.id,
        code: r.code,
        hostId: r.host_id,
        hostName: r.host_name,
        isLocked: Boolean(r.is_locked),
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        endedAt: r.ended_at,
        activeParticipantsCount: counts.active,
        totalParticipantsCount: counts.total,
      };
    });
  } catch (err) {
    console.warn('adminGetAllRooms error:', err);
    return [];
  }
}

/**
 * Admin Force Close Room
 */
export async function adminCloseRoom(code: string): Promise<boolean> {
  const clean = cleanRoomCode(code);
  if (!clean) return false;

  // Broadcast closure to any live participants immediately
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      const bc = new BroadcastChannel(`aura-room-${clean}`);
      bc.postMessage({
        type: 'admin-room-closed',
        roomId: clean,
        senderId: 'superadmin_console',
        isSuperAdmin: true,
      });
      setTimeout(() => bc.close(), 1000);
    } catch {}
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      const rpcQuery = client.rpc('admin_close_room', { p_code: clean });
      const res = await withTimeout<{ data: any; error: any }>(rpcQuery, 2500, { data: null, error: null });
      if (!res.error && res.data) return true;

      await client
        .from('rooms')
        .update({ status: 'closed', ended_at: new Date().toISOString() })
        .eq('code', clean);
      await client
        .from('room_participants')
        .update({ is_active: false, left_at: new Date().toISOString() })
        .eq('room_code', clean);
      return true;
    } catch (e) {
      console.warn('adminCloseRoom error:', e);
    }
  }

  return true;
}

/**
 * Admin Delete Room Record
 */
export async function adminDeleteRoom(code: string): Promise<boolean> {
  const clean = cleanRoomCode(code);
  if (!clean) return false;

  const client = getSupabaseClient();
  if (!client) return true;

  try {
    const rpcQuery = client.rpc('admin_delete_room', { p_code: clean });
    const res = await withTimeout<{ data: any; error: any }>(rpcQuery, 2500, { data: null, error: null });
    if (!res.error && res.data) return true;

    await client.from('room_participants').delete().eq('room_code', clean);
    await client.from('rooms').delete().eq('code', clean);
    return true;
  } catch (e) {
    console.warn('adminDeleteRoom error:', e);
    return false;
  }
}

/**
 * Admin Create Meeting Room
 */
export async function adminCreateRoom(params: {
  code?: string;
  hostName?: string;
  isLocked?: boolean;
}): Promise<{ success: boolean; code: string; room?: any }> {
  let targetCode = cleanRoomCode(params.code || '');
  if (!targetCode) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const randStr = (len: number) => {
      let res = '';
      for (let i = 0; i < len; i++) {
        res += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return res;
    };
    targetCode = `${randStr(3)}-${randStr(4)}-${randStr(3)}`;
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      const rpcQuery = client.rpc('admin_create_room', {
        p_code: targetCode,
        p_host_name: params.hostName || 'Super Admin',
        p_is_locked: Boolean(params.isLocked),
      });

      const res = await withTimeout<{ data: any; error: any }>(rpcQuery, 2500, { data: null, error: null });
      if (!res.error && res.data && res.data.success) {
        return { success: true, code: targetCode, room: res.data.room };
      }

      // Direct fallback
      await client.from('rooms').upsert(
        {
          code: targetCode,
          host_id: 'admin_master',
          host_name: params.hostName || 'Super Admin',
          is_locked: Boolean(params.isLocked),
          status: 'active',
          updated_at: new Date().toISOString(),
          ended_at: null,
        },
        { onConflict: 'code' }
      );
    } catch (e) {
      console.warn('adminCreateRoom fallback error:', e);
    }
  }

  return { success: true, code: targetCode };
}

/**
 * Admin System Statistics
 */
export async function adminGetStats(): Promise<AdminSystemStats> {
  const defaultStats: AdminSystemStats = {
    totalRooms: 0,
    activeRooms: 0,
    closedRooms: 0,
    activeParticipants: 0,
    totalParticipants: 0,
  };

  const client = getSupabaseClient();
  if (!client) return defaultStats;

  try {
    const rpcQuery = client.rpc('admin_get_system_stats');
    const res = await withTimeout<{ data: any; error: any }>(rpcQuery, 2500, { data: null, error: null });
    if (!res.error && res.data && res.data.success && res.data.stats) {
      return res.data.stats;
    }

    const roomsRes = await client.from('rooms').select('*');
    const partsRes = await client.from('room_participants').select('*');

    const rooms = roomsRes.data || [];
    const parts = partsRes.data || [];

    return {
      totalRooms: rooms.length,
      activeRooms: rooms.filter((r) => r.status === 'active').length,
      closedRooms: rooms.filter((r) => r.status === 'closed').length,
      activeParticipants: parts.filter((p) => p.is_active).length,
      totalParticipants: parts.length,
    };
  } catch (e) {
    console.warn('adminGetStats error:', e);
    return defaultStats;
  }
}
