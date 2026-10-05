export interface Participant {
  id: string;
  name: string;
  avatarColor: string;
  isHost: boolean;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isHandRaised: boolean;
  isSpeaking: boolean;
  audioLevel?: number;
  stream?: MediaStream;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isHost?: boolean;
}

export interface KnockRequest {
  id: string;
  participantId: string;
  name: string;
  avatarColor: string;
  requestedAt: number;
}

export interface MeetingRoomState {
  roomId: string;
  isLocked: boolean;
  hostId: string;
  createdAt: number;
}

export interface ReactionEvent {
  id: string;
  senderId: string;
  senderName: string;
  emoji: string;
  timestamp: number;
}

export type SignalingMessageType =
  | 'join-request'
  | 'join-approved'
  | 'join-declined'
  | 'room-probe'
  | 'room-state'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'peer-left'
  | 'chat-message'
  | 'chat-history'
  | 'reaction'
  | 'state-update'
  | 'hand-raise'
  | 'host-lock-toggle'
  | 'host-kick';

export interface SignalingMessage {
  type: SignalingMessageType;
  roomId: string;
  senderId: string;
  senderName?: string;
  targetId?: string; // If targeting a specific peer
  payload?: any;
}

/**
 * Room codes are generated as `abc-defg-hij`. A URL path segment is only treated as a
 * room slug when it actually looks like a code (at least two dash separated groups).
 * Without this guard, paths such as `/app` or `/preview` were silently treated as rooms.
 */
export function isRoomCodeLike(input: string): boolean {
  const code = cleanRoomCode(input);
  return /^[a-z0-9]{2,}(-[a-z0-9]{2,})+$/.test(code);
}

export function cleanRoomCode(input: string): string {
  if (!input) return '';
  let str = input.trim().toLowerCase();
  if (str.includes('://')) {
    try {
      const url = new URL(str);
      str = url.pathname;
    } catch {
      str = str.split('://')[1] || str;
    }
  }
  str = str.split('?')[0].split('#')[0];
  if (str.includes('/')) {
    const segments = str.split('/').filter(Boolean);
    str = segments[segments.length - 1] || '';
  }
  str = str.replace(/[^a-z0-9-]/g, '');
  return str;
}

