import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { SignalingMessage, cleanRoomCode, Participant } from './types';

function isInvalidOrPlaceholder(val: string): boolean {
  if (!val || val.trim().length < 10) return true;
  if (val.includes('...')) return true;
  return /your[-_]?(project|supabase)|example\.com|changeme|xxxxx/i.test(val);
}

// Timeout helper so database network calls never freeze the UI
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

// Helper to get Supabase credentials from env, localStorage, or defaults
export function getSupabaseCredentials(): { url: string; key: string } {
  let localUrl = '';
  let localKey = '';
  try {
    if (typeof window !== 'undefined') {
      localUrl = (localStorage.getItem('aura_supabase_url') || '').trim();
      localKey = (localStorage.getItem('aura_supabase_key') || '').trim();
      if (isInvalidOrPlaceholder(localUrl)) localUrl = '';
      if (isInvalidOrPlaceholder(localKey)) localKey = '';
    }
  } catch {}

  const envUrl = ((import.meta.env.VITE_SUPABASE_URL as string) || '').trim();
  const envKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '').trim();

  const finalUrl = localUrl || (isInvalidOrPlaceholder(envUrl) ? '' : envUrl);
  const finalKey = localKey || (isInvalidOrPlaceholder(envKey) ? '' : envKey);

  return { url: finalUrl, key: finalKey };
}

export function isSupabaseReady(): boolean {
  const { url, key } = getSupabaseCredentials();
  if (!url || !key) return false;
  if (!url.startsWith('http')) return false;
  return !isInvalidOrPlaceholder(url) && !isInvalidOrPlaceholder(key);
}

let clientInstance: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient | null {
  if (clientInstance) return clientInstance;
  const { url, key } = getSupabaseCredentials();
  if (isSupabaseReady()) {
    try {
      clientInstance = createClient(url, key, {
        realtime: {
          params: {
            eventsPerSecond: 30,
          },
        },
      });
      return clientInstance;
    } catch (e) {
      console.warn('Failed to initialize Supabase client:', e);
      return null;
    }
  }
  return null;
}

/**
 * Drops the cached client so credentials saved from Settings take effect immediately.
 */
export function resetSupabaseClient() {
  const client = clientInstance;
  clientInstance = null;
  if (client) {
    try {
      client.removeAllChannels();
    } catch (e) {
      console.warn('Error while resetting Supabase client:', e);
    }
  }
}

export const isSupabaseConfigured = isSupabaseReady();

export interface DbRoomRecord {
  id: string;
  code: string;
  host_id: string;
  host_name: string;
  is_locked: boolean;
  status: 'active' | 'closed';
  created_at: string;
  updated_at: string;
  ended_at?: string | null;
}

export interface DbParticipantRecord {
  id: string;
  room_code: string;
  user_id: string;
  user_name: string;
  avatar_color?: string;
  is_host: boolean;
  is_active: boolean;
  joined_at: string;
  last_seen_at: string;
  left_at?: string | null;
}

/**
 * Check whether a room exists in database.
 */
export async function dbCheckRoomExists(code: string): Promise<{
  exists: boolean;
  isLocked?: boolean;
  hostId?: string;
  hostName?: string;
  isOffline?: boolean;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { exists: false, isOffline: true };
  }

  const cleanCode = cleanRoomCode(code);
  if (!cleanCode) return { exists: false };

  try {
    const query = client
      .from('rooms')
      .select('*')
      .eq('code', cleanCode)
      .eq('status', 'active')
      .maybeSingle();

    const response = await withTimeout<{ data: any; error: any }>(query, 2500, {
      data: null,
      error: { message: 'TIMEOUT' },
    });

    if (response.error && response.error.message === 'TIMEOUT') {
      return { exists: false, isOffline: true };
    }

    if (!response.error && response.data) {
      return {
        exists: true,
        isLocked: Boolean(response.data.is_locked),
        hostId: response.data.host_id,
        hostName: response.data.host_name,
        isOffline: false,
      };
    }

    if (!response.error && response.data === null) {
      return { exists: false, isOffline: false };
    }

    return { exists: false, isOffline: true };
  } catch (err) {
    console.warn('dbCheckRoomExists error:', err);
    return { exists: false, isOffline: true };
  }
}

/**
 * DB Operations for persistent rooms & presence in Supabase with timeout resilience.
 */
export async function dbJoinOrCreateRoom(params: {
  code: string;
  userId: string;
  userName: string;
  avatarColor?: string;
  isCreate: boolean;
  requireApproval?: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  room?: DbRoomRecord;
  isHost?: boolean;
  isLocked?: boolean;
  isOffline?: boolean;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: params.isCreate,
      error: params.isCreate ? undefined : 'DB_UNAVAILABLE_PROBE_MESH',
      isHost: params.isCreate,
      isLocked: params.requireApproval || false,
      isOffline: true,
    };
  }

  const cleanCode = cleanRoomCode(params.code);

  try {
    // Try calling the optimized RPC function with 2500ms timeout
    const rpcPromise = client.rpc('join_or_create_room', {
      p_code: cleanCode,
      p_user_id: params.userId,
      p_user_name: params.userName,
      p_avatar_color: params.avatarColor || null,
      p_is_create: params.isCreate,
      p_require_approval: Boolean(params.requireApproval),
    });

    const response = await withTimeout<{ data: any; error: any }>(rpcPromise, 2500, {
      data: null,
      error: { message: 'TIMEOUT' },
    });

    if (!response.error && response.data) {
      const data = response.data;
      return {
        success: Boolean(data.success),
        error: data.error,
        room: data.room,
        isHost: Boolean(data.is_host),
        isLocked: Boolean(data.is_locked),
        isOffline: false,
      };
    }

    // Direct table fallback if RPC is missing or timed out
    if (params.isCreate) {
      const existingQuery = client
        .from('rooms')
        .select('*')
        .eq('code', cleanCode)
        .maybeSingle();

      const { data: existing } = await withTimeout<{ data: any; error: any }>(existingQuery, 2000, {
        data: null,
        error: null,
      });

      if (existing) {
        await withTimeout(
          client
            .from('rooms')
            .update({
              host_id: params.userId,
              host_name: params.userName,
              is_locked: Boolean(params.requireApproval),
              status: 'active',
              updated_at: new Date().toISOString(),
              ended_at: null,
            })
            .eq('code', cleanCode),
          2000,
          null
        );
      } else {
        await withTimeout(
          client.from('rooms').insert({
            code: cleanCode,
            host_id: params.userId,
            host_name: params.userName,
            is_locked: Boolean(params.requireApproval),
            status: 'active',
          }),
          2000,
          null
        );
      }

      await withTimeout(
        client.from('room_participants').upsert(
          {
            room_code: cleanCode,
            user_id: params.userId,
            user_name: params.userName,
            avatar_color: params.avatarColor,
            is_host: true,
            is_active: true,
            last_seen_at: new Date().toISOString(),
            left_at: null,
          },
          { onConflict: 'room_code,user_id' }
        ),
        2000,
        null
      );

      return { success: true, isHost: true, isLocked: Boolean(params.requireApproval) };
    } else {
      // Joining existing room
      const roomQuery = client
        .from('rooms')
        .select('*')
        .eq('code', cleanCode)
        .eq('status', 'active')
        .maybeSingle();

      const roomRes = await withTimeout<{ data: any; error: any }>(roomQuery, 2500, {
        data: null,
        error: { message: 'TIMEOUT' },
      });

      if (!roomRes.error && roomRes.data === null) {
        return { success: false, error: 'ROOM_NOT_FOUND_OR_CLOSED', isOffline: false };
      }

      if (roomRes.error) {
        return { success: false, error: 'DB_UNAVAILABLE_PROBE_MESH', isOffline: true };
      }

      const room = roomRes.data;
      if (room) {
        await withTimeout(
          client.from('room_participants').upsert(
            {
              room_code: cleanCode,
              user_id: params.userId,
              user_name: params.userName,
              avatar_color: params.avatarColor,
              is_host: room.host_id === params.userId,
              is_active: true,
              last_seen_at: new Date().toISOString(),
              left_at: null,
            },
            { onConflict: 'room_code,user_id' }
          ),
          2000,
          null
        );

        return {
          success: true,
          room,
          isHost: room.host_id === params.userId,
          isLocked: Boolean(room.is_locked),
          isOffline: false,
        };
      }

      return { success: false, error: 'ROOM_NOT_FOUND_OR_CLOSED', isOffline: false };
    }
  } catch (err: any) {
    console.warn('dbJoinOrCreateRoom exception:', err);
    if (params.isCreate) {
      return { success: true, isHost: true, isLocked: params.requireApproval || false, isOffline: true };
    }
    return { success: false, error: 'DB_UNAVAILABLE_PROBE_MESH', isOffline: true };
  }
}

export async function dbGetActiveParticipants(code: string, excludeUserId: string): Promise<Participant[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const cleanCode = cleanRoomCode(code);
  try {
    const query = client
      .from('room_participants')
      .select('*')
      .eq('room_code', cleanCode)
      .eq('is_active', true)
      .neq('user_id', excludeUserId);

    const { data, error } = await withTimeout<{ data: any[] | null; error: any }>(query, 2000, {
      data: null,
      error: null,
    });

    if (error || !data) return [];

    return data.map((row: any) => ({
      id: row.user_id,
      name: row.user_name || 'Participant',
      avatarColor: row.avatar_color || 'from-indigo-500 to-purple-600',
      isHost: Boolean(row.is_host),
      isAudioEnabled: true,
      isVideoEnabled: true,
      isScreenSharing: false,
      isHandRaised: false,
      isSpeaking: false,
      joinedAt: row.joined_at ? new Date(row.joined_at).getTime() : Date.now(),
    }));
  } catch (e) {
    console.warn('dbGetActiveParticipants error:', e);
    return [];
  }
}

export async function dbLeaveRoom(code: string, userId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const cleanCode = cleanRoomCode(code);
  try {
    await withTimeout(
      client.rpc('leave_room', {
        p_code: cleanCode,
        p_user_id: userId,
      }),
      2000,
      null
    );
  } catch (e) {
    try {
      await withTimeout(
        client
          .from('room_participants')
          .update({ is_active: false, left_at: new Date().toISOString() })
          .eq('room_code', cleanCode)
          .eq('user_id', userId),
        2000,
        null
      );
    } catch {}
  }
}

export async function dbHeartbeat(code: string, userId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const cleanCode = cleanRoomCode(code);
  try {
    await withTimeout(
      client.rpc('heartbeat_room', {
        p_code: cleanCode,
        p_user_id: userId,
      }),
      2000,
      null
    );
  } catch (e) {
    try {
      await withTimeout(
        client
          .from('room_participants')
          .update({ last_seen_at: new Date().toISOString(), is_active: true })
          .eq('room_code', cleanCode)
          .eq('user_id', userId),
        2000,
        null
      );
    } catch {}
  }
}

export async function dbCloseRoom(code: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const cleanCode = cleanRoomCode(code);
  try {
    await withTimeout(
      client
        .from('rooms')
        .update({ status: 'closed', ended_at: new Date().toISOString() })
        .eq('code', cleanCode),
      2000,
      null
    );
    await withTimeout(
      client
        .from('room_participants')
        .update({ is_active: false, left_at: new Date().toISOString() })
        .eq('room_code', cleanCode),
      2000,
      null
    );
  } catch (e) {
    console.warn('dbCloseRoom error:', e);
  }
}

export async function dbUpdateRoomLock(code: string, isLocked: boolean): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const cleanCode = cleanRoomCode(code);
  try {
    await withTimeout(
      client
        .from('rooms')
        .update({ is_locked: isLocked, updated_at: new Date().toISOString() })
        .eq('code', cleanCode),
      2000,
      null
    );
  } catch (e) {
    console.warn('dbUpdateRoomLock error:', e);
  }
}

export interface InternalSignalingMessage extends SignalingMessage {
  msgId?: string;
  sentAt?: number;
}

export type RealtimeStatus = 'disabled' | 'connecting' | 'connected' | 'error';

/**
 * Cross-device signaling transport.
 * Runs dual transports:
 *  1. Supabase Realtime broadcast -> remote meetings across devices.
 *  2. Browser BroadcastChannel    -> 0ms latency multi-tab testing on the same device.
 */
export class SignalingService {
  private roomId: string;
  private userId: string;
  private channel: RealtimeChannel | null = null;
  private localBroadcast: BroadcastChannel | null = null;
  private messageHandler: ((msg: SignalingMessage) => void) | null = null;
  private presenceHandler: ((userIds: string[]) => void) | null = null;
  private statusHandler: ((status: RealtimeStatus) => void) | null = null;
  private isChannelSubscribed: boolean = false;
  private status: RealtimeStatus = 'connecting';
  private pendingOutboundQueue: InternalSignalingMessage[] = [];
  private seenMessageIds: Set<string> = new Set();
  private retryCount: number = 0;
  private retryTimer: any = null;
  private disposed: boolean = false;

  constructor(roomId: string, userId: string) {
    this.roomId = cleanRoomCode(roomId);
    this.userId = userId;
  }

  public getStatus(): RealtimeStatus {
    return this.status;
  }

  public onStatusChange(handler: (status: RealtimeStatus) => void) {
    this.statusHandler = handler;
    handler(this.status);
  }

  public onPresence(handler: (userIds: string[]) => void) {
    this.presenceHandler = handler;
  }

  private setStatus(status: RealtimeStatus) {
    this.status = status;
    this.statusHandler?.(status);
  }

  public connect(onMessage: (msg: SignalingMessage) => void) {
    this.messageHandler = onMessage;

    // Local Browser BroadcastChannel for instant cross-tab testing
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.localBroadcast = new BroadcastChannel(`aura-room-${this.roomId}`);
        this.localBroadcast.onmessage = (event) => {
          const msg = event.data as InternalSignalingMessage;
          if (msg && msg.senderId !== this.userId) {
            this.handleIncoming(msg);
          }
        };
      } catch (err) {
        console.warn('Local BroadcastChannel error:', err);
      }
    }

    const client = getSupabaseClient();
    if (!client) {
      this.setStatus('disabled');
    } else {
      this.setStatus('connecting');
      this.subscribeToChannel(client);
    }
  }

  private subscribeToChannel(client: SupabaseClient) {
    if (this.disposed) return;

    try {
      this.channel = client.channel(`meet-room-${this.roomId}`, {
        config: {
          broadcast: { self: false },
          presence: { key: this.userId },
        },
      });

      this.channel
        .on('broadcast', { event: 'signal' }, (payload) => {
          const msg = payload.payload as InternalSignalingMessage;
          if (msg && msg.senderId !== this.userId) {
            this.handleIncoming(msg);
          }
        })
        .on('presence', { event: 'sync' }, () => {
          const state = this.channel?.presenceState() || {};
          const ids = Object.keys(state).filter((id) => id !== this.userId);
          this.presenceHandler?.(ids);
        })
        .subscribe((status) => {
          if (this.disposed) return;
          console.log(`[Supabase Realtime] Room ${this.roomId} status:`, status);
          if (status === 'SUBSCRIBED') {
            this.isChannelSubscribed = true;
            this.retryCount = 0;
            this.setStatus('connected');
            this.flushPendingOutbound();
            this.channel?.track({ userId: this.userId, joinedAt: Date.now() }).catch(() => {});
            return;
          }

          this.isChannelSubscribed = false;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            this.setStatus('error');
            this.scheduleResubscribe(client);
          }
        });
    } catch (err) {
      console.warn('Error setting up Supabase Realtime channel:', err);
      this.setStatus('error');
      this.scheduleResubscribe(client);
    }
  }

  private scheduleResubscribe(client: SupabaseClient) {
    if (this.disposed || this.retryTimer !== null) return;
    if (this.retryCount >= 5) return;

    const delay = Math.min(8000, 1000 * Math.pow(1.5, this.retryCount));
    this.retryCount += 1;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed) return;
      try {
        if (this.channel) {
          client.removeChannel(this.channel);
        }
      } catch (e) {}
      this.channel = null;
      this.subscribeToChannel(client);
    }, delay);
  }

  private handleIncoming(msg: InternalSignalingMessage) {
    if (msg.targetId && msg.targetId !== this.userId) {
      return;
    }

    if (msg.msgId) {
      if (this.seenMessageIds.has(msg.msgId)) {
        return;
      }
      this.seenMessageIds.add(msg.msgId);
      if (this.seenMessageIds.size > 500) {
        const first = this.seenMessageIds.values().next().value;
        if (first) this.seenMessageIds.delete(first);
      }
    }

    try {
      this.messageHandler?.(msg);
    } catch (e) {
      console.error('Error in signaling message handler:', e);
    }
  }

  private flushPendingOutbound() {
    if (!this.channel || !this.isChannelSubscribed) return;
    while (this.pendingOutboundQueue.length > 0) {
      const msg = this.pendingOutboundQueue.shift();
      if (msg) {
        this.channel.send({
          type: 'broadcast',
          event: 'signal',
          payload: msg,
        }).catch((e) => console.warn('Failed to send queued signal:', e));
      }
    }
  }

  private queueOutbound(msg: InternalSignalingMessage) {
    const MAX_QUEUE = 60;
    this.pendingOutboundQueue.push(msg);
    if (this.pendingOutboundQueue.length > MAX_QUEUE) {
      this.pendingOutboundQueue.splice(0, this.pendingOutboundQueue.length - MAX_QUEUE);
    }
  }

  public send(message: Omit<SignalingMessage, 'roomId' | 'senderId'>) {
    if (this.disposed) return;

    const msgId = `${this.userId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const fullMessage: InternalSignalingMessage = {
      ...message,
      roomId: this.roomId,
      senderId: this.userId,
      msgId,
      sentAt: Date.now(),
    };

    // 1. Send via local BroadcastChannel immediately for multi-tab
    if (this.localBroadcast) {
      try {
        this.localBroadcast.postMessage(fullMessage);
      } catch (e) {
        console.error('Error posting to local broadcast:', e);
      }
    }

    // 2. Send via Supabase Realtime
    if (this.channel) {
      if (this.isChannelSubscribed) {
        this.channel.send({
          type: 'broadcast',
          event: 'signal',
          payload: fullMessage,
        }).catch((e) => {
          console.warn('Error sending broadcast:', e);
          this.queueOutbound(fullMessage);
        });
      } else {
        this.queueOutbound(fullMessage);
      }
    }
  }

  public disconnect() {
    this.disposed = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const client = getSupabaseClient();
    if (this.channel && client) {
      try {
        client.removeChannel(this.channel);
      } catch (e) {
        console.warn('Error removing channel:', e);
      }
      this.channel = null;
    }
    if (this.localBroadcast) {
      try {
        this.localBroadcast.close();
      } catch (e) {
        console.warn('Error closing broadcast:', e);
      }
      this.localBroadcast = null;
    }
    this.messageHandler = null;
    this.presenceHandler = null;
    this.statusHandler = null;
    this.pendingOutboundQueue = [];
    this.isChannelSubscribed = false;
  }
}
