export type ScreenSharePreset = 'low' | 'balanced' | 'high';

export const AVATAR_GRADIENTS = [
  'from-indigo-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
  'from-blue-600 to-indigo-800',
  'from-teal-500 to-emerald-700',
  'from-fuchsia-600 to-pink-600',
  'from-orange-500 to-amber-600',
];

export function getAvatarColorForName(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return AVATAR_GRADIENTS[0];
  let charSum = 0;
  for (let i = 0; i < trimmed.length; i++) {
    charSum += trimmed.charCodeAt(i);
  }
  const index = (trimmed.length * 7 + charSum) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index];
}

export interface Participant {
  id: string;
  name: string;
  avatarColor: string;
  isHost: boolean;
  role?: 'host' | 'participant';
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
  | 'host-mute-all'
  | 'host-kick';

export interface SignalingMessage {
  type: SignalingMessageType;
  roomId: string;
  senderId: string;
  senderName?: string;
  targetId?: string;
  payload?: any;
}

/**
 * Validates whether an input slug is a valid room identifier.
 * Accepts standard 3-part codes (abc-defg-hij) and custom room names (team-sync, project-review, room101).
 * Filters out common static app routes and file extensions.
 */
export function isRoomCodeLike(input: string): boolean {
  const code = cleanRoomCode(input);
  if (!code || code.length < 2 || code.length > 50) return false;
  
  const reservedPaths = [
    'app', 'preview', 'assets', 'favicon', 'index', 'robots', 
    'sitemap', 'api', 'login', 'signup', 'settings', 'dist', 'src'
  ];
  if (reservedPaths.includes(code)) return false;
  
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(code);
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
