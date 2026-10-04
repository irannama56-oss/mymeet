import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { SignalingMessage } from './types';

// Default Supabase config from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('your-supabase-url')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 20,
        },
      },
    })
  : null;

export class SignalingService {
  private roomId: string;
  private userId: string;
  private channel: RealtimeChannel | null = null;
  private localBroadcast: BroadcastChannel | null = null;
  private messageHandlers: ((msg: SignalingMessage) => void)[] = [];

  constructor(roomId: string, userId: string) {
    this.roomId = roomId;
    this.userId = userId;
  }

  public connect(onMessage: (msg: SignalingMessage) => void) {
    this.messageHandlers.push(onMessage);

    // 1. Setup Supabase Realtime Broadcast if credentials are provided
    if (supabase) {
      this.channel = supabase.channel(`meet-room-${this.roomId}`, {
        config: {
          broadcast: { self: false },
          presence: { key: this.userId },
        },
      });

      this.channel
        .on('broadcast', { event: 'signal' }, (payload) => {
          const msg = payload.payload as SignalingMessage;
          if (msg && msg.senderId !== this.userId) {
            this.notifyHandlers(msg);
          }
        })
        .subscribe((status) => {
          console.log(`[Supabase Realtime] Room ${this.roomId} status:`, status);
        });
    }

    // 2. Setup Local Browser BroadcastChannel for cross-tab peer testing on same machine
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.localBroadcast = new BroadcastChannel(`aura-room-${this.roomId}`);
        this.localBroadcast.onmessage = (event) => {
          const msg = event.data as SignalingMessage;
          // If we don't have active supabase or to support local multi-tab preview
          if (!supabase && msg && msg.senderId !== this.userId) {
            this.notifyHandlers(msg);
          }
        };
      } catch (err) {
        console.warn('Local BroadcastChannel error:', err);
      }
    }
  }

  private notifyHandlers(msg: SignalingMessage) {
    // If targeted to someone else, ignore
    if (msg.targetId && msg.targetId !== this.userId) {
      return;
    }
    this.messageHandlers.forEach((handler) => handler(msg));
  }

  public send(message: Omit<SignalingMessage, 'roomId' | 'senderId'>) {
    const fullMessage: SignalingMessage = {
      ...message,
      roomId: this.roomId,
      senderId: this.userId,
    };

    // Send via Supabase if available
    if (this.channel) {
      this.channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: fullMessage,
      });
    }

    // Also send via local BroadcastChannel
    if (this.localBroadcast) {
      try {
        this.localBroadcast.postMessage(fullMessage);
      } catch (e) {
        console.error('Error posting to local broadcast:', e);
      }
    }
  }

  public disconnect() {
    if (this.channel && supabase) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    if (this.localBroadcast) {
      this.localBroadcast.close();
      this.localBroadcast = null;
    }
    this.messageHandlers = [];
  }
}
