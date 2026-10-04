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
  | 'room-state'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'peer-left'
  | 'chat-message'
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
