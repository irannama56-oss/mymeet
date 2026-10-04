import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { SignalingMessage } from './types';

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
  return Boolean(url && key && !url.includes('your-supabase-url') && url.startsWith('http'));
}

export const isSupabaseConfigured = isSupabaseReady();

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

export const supabase: SupabaseClient | null = getSupabaseClient();

export interface InternalSignalingMessage extends SignalingMessage {
  msgId?: string;
  sentAt?: number;
}

export class SignalingService {
  private roomId: string;
  private userId: string;
  private channel: RealtimeChannel | null = null;
  private localBroadcast: BroadcastChannel | null = null;
  private messageHandlers: ((msg: SignalingMessage) => void)[] = [];
  private isChannelSubscribed: boolean = false;
  private pendingOutboundQueue: InternalSignalingMessage[] = [];
  private seenMessageIds: Set<string> = new Set();

  constructor(roomId: string, userId: string) {
    this.roomId = roomId;
    this.userId = userId;
  }

  public connect(onMessage: (msg: SignalingMessage) => void) {
    this.messageHandlers.push(onMessage);

    const client = getSupabaseClient();

    // 1. Setup Supabase Realtime Broadcast if credentials are configured
    if (client) {
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
          .subscribe((status) => {
            console.log(`[Supabase Realtime] Room ${this.roomId} status:`, status);
            if (status === 'SUBSCRIBED') {
              this.isChannelSubscribed = true;
              this.flushPendingOutbound();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              this.isChannelSubscribed = false;
            }
          });
      } catch (err) {
        console.warn('Error setting up Supabase Realtime channel:', err);
      }
    }

    // 2. Setup Local Browser BroadcastChannel for instant cross-tab testing
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

    this.messageHandlers.forEach((handler) => {
      try {
        handler(msg);
      } catch (e) {
        console.error('Error in signaling message handler:', e);
      }
    });
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

  public send(message: Omit<SignalingMessage, 'roomId' | 'senderId'>) {
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
          this.pendingOutboundQueue.push(fullMessage);
        });
      } else {
        // Queue until SUBSCRIBED
        this.pendingOutboundQueue.push(fullMessage);
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
    this.messageHandlers = [];
    this.pendingOutboundQueue = [];
    this.isChannelSubscribed = false;
  }
}
