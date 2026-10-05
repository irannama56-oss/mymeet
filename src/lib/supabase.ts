import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { SignalingMessage, cleanRoomCode } from './types';

// Helper to get Supabase credentials from env or localStorage
export function getSupabaseCredentials(): { url: string; key: string } {
  const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const localUrl = typeof window !== 'undefined' ? localStorage.getItem('aura_supabase_url') || '' : '';
  const localKey = typeof window !== 'undefined' ? localStorage.getItem('aura_supabase_key') || '' : '';

  const url = (localUrl || envUrl).trim();
  const key = (localKey || envKey).trim();

  return { url, key };
}

export function isSupabaseReady(): boolean {
  const { url, key } = getSupabaseCredentials();
  if (!url || !key) return false;
  if (!url.startsWith('http')) return false;
  // Reject the template values so an unfilled .env never looks "configured" and
  // silently sends signaling into the void.
  const isPlaceholder = /your[-_]?(project|supabase)|example\.com|changeme|xxxxx/i.test(url + key);
  return !isPlaceholder;
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
            eventsPerSecond: 25,
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
 * Drops the cached client so credentials saved from the Settings modal take effect
 * immediately instead of requiring a full page reload.
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

export interface InternalSignalingMessage extends SignalingMessage {
  msgId?: string;
  sentAt?: number;
}

export type RealtimeStatus = 'disabled' | 'connecting' | 'connected' | 'error';

/**
 * Cross-device signaling transport.
 *
 * Two transports run side by side:
 *  1. Supabase Realtime broadcast  -> required for real remote meetings.
 *  2. Browser BroadcastChannel     -> instant multi-tab testing on one machine.
 *
 * Both are deduplicated by `msgId`, so a message that arrives twice is handled once.
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
  private retryTimer: number | null = null;
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

  /** Called with the ids of every other participant currently present in the room. */
  public onPresence(handler: (userIds: string[]) => void) {
    this.presenceHandler = handler;
  }

  private setStatus(status: RealtimeStatus) {
    this.status = status;
    this.statusHandler?.(status);
  }

  public connect(onMessage: (msg: SignalingMessage) => void) {
    this.messageHandler = onMessage;

    const client = getSupabaseClient();

    if (!client) {
      // No cloud transport available: only same-browser tabs will ever see each other.
      this.setStatus('disabled');
    } else {
      this.setStatus('connecting');
      this.subscribeToChannel(client);
    }

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
          console.log(`[Supabase Realtime] Room ${this.roomId} status:`, status);
          if (status === 'SUBSCRIBED') {
            this.isChannelSubscribed = true;
            this.retryCount = 0;
            this.setStatus('connected');
            this.flushPendingOutbound();
            // Announce ourselves so other peers can discover us even if our
            // broadcast handshake was lost.
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

  /** A dropped websocket used to silently kill the room; now it retries with backoff. */
  private scheduleResubscribe(client: SupabaseClient) {
    if (this.disposed || this.retryTimer !== null) return;
    if (this.retryCount >= 6) return;

    const delay = Math.min(8000, 1000 * Math.pow(1.6, this.retryCount));
    this.retryCount += 1;

    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed) return;
      try {
        if (this.channel) {
          client.removeChannel(this.channel);
        }
      } catch (e) {
        /* channel already gone */
      }
      this.channel = null;
      this.subscribeToChannel(client);
    }, delay);
  }

  private handleIncoming(msg: InternalSignalingMessage) {
    // If targeted to someone else, ignore
    if (msg.targetId && msg.targetId !== this.userId) {
      return;
    }

    // Deduplicate messages across multiple channels (Supabase + BroadcastChannel)
    if (msg.msgId) {
      if (this.seenMessageIds.has(msg.msgId)) {
        return;
      }
      this.seenMessageIds.add(msg.msgId);
      // Keep set size manageable
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

  /**
   * Bounded queue: while the channel is down, heartbeats kept piling up and would all be
   * flushed at once on reconnect (a burst of stale state updates).
   */
  private queueOutbound(msg: InternalSignalingMessage) {
    const MAX_QUEUE = 60;
    this.pendingOutboundQueue.push(msg);
    if (this.pendingOutboundQueue.length > MAX_QUEUE) {
      this.pendingOutboundQueue.splice(0, this.pendingOutboundQueue.length - MAX_QUEUE);
    }
  }

  public send(message: Omit<SignalingMessage, 'roomId' | 'senderId'>) {
    if (this.disposed) return;

    const msgId = `${this.userId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullMessage: InternalSignalingMessage = {
      ...message,
      roomId: this.roomId,
      senderId: this.userId,
      msgId,
      sentAt: Date.now(),
    };

    // Send via Supabase Realtime
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
        // Queue until SUBSCRIBED
        this.queueOutbound(fullMessage);
      }
    }

    // Also broadcast locally across browser tabs
    if (this.localBroadcast) {
      try {
        this.localBroadcast.postMessage(fullMessage);
      } catch (e) {
        console.error('Error posting to local broadcast:', e);
      }
    }
  }

  public disconnect() {
    this.disposed = true;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
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
