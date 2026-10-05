import React, { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { Lobby } from './components/Lobby';
import { VideoGrid } from './components/VideoGrid';
import { MeetingControls } from './components/MeetingControls';
import { ChatDrawer } from './components/ChatDrawer';
import { ParticipantsDrawer } from './components/ParticipantsDrawer';
import { GuestWaitingScreen, HostKnockBanner } from './components/KnockModal';
import { SettingsModal } from './components/SettingsModal';
import { MeetingHeader } from './components/MeetingHeader';
import { WebRTCManager } from './lib/webrtc';
import {
  SignalingService,
  RealtimeStatus,
  dbJoinOrCreateRoom,
  dbLeaveRoom,
  dbHeartbeat,
  dbUpdateRoomLock,
  dbCloseRoom,
  dbGetActiveParticipants,
} from './lib/supabase';
import {
  Participant,
  ChatMessage,
  KnockRequest,
  SignalingMessage,
  cleanRoomCode,
  isRoomCodeLike,
} from './lib/types';
import { sounds } from './lib/sound';
import { RoomNotFoundModal } from './components/RoomNotFoundModal';
import { ConnectionBanner } from './components/ConnectionBanner';
import { NoticeModal } from './components/NoticeModal';

/**
 * A peer that stops heartbeating for this long is considered gone. Deliberately generous:
 * browsers throttle timers in background tabs, so a shorter window would evict people who
 * simply switched tabs.
 */
const PEER_TIMEOUT_MS = 45000;

const AVATAR_COLORS = [
  'from-indigo-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
];

// Helper to extract room slug from pathname (/abc-defg-hij) or ?room= query
const getRoomSlugFromUrl = (): string => {
  if (typeof window === 'undefined') return '';
  const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '').trim().toLowerCase();
  // Only treat a path segment as a room when it actually looks like a room code,
  // otherwise paths such as /app or /preview would silently become "rooms".
  if (pathname && !pathname.includes('.') && isRoomCodeLike(pathname)) {
    return cleanRoomCode(pathname);
  }
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    return cleanRoomCode(roomParam);
  }
  return '';
};

export const App: React.FC = () => {
  // Session & UI States
  const [inMeeting, setInMeeting] = useState(false);
  const [waitingStatus, setWaitingStatus] = useState<'none' | 'waiting' | 'declined'>('none');
  // 'probing'  -> we asked the room whether a host is already there
  // 'not-found'-> nobody answered: the user decides to create the room or go back
  const [joinPhase, setJoinPhase] = useState<'idle' | 'probing' | 'not-found'>('idle');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [roomId, setRoomId] = useState('');
  const [userId] = useState(() => 'usr_' + Math.random().toString(36).substring(2, 9));
  const [avatarColor] = useState(() => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);

  // Meeting State
  const [isHost, setIsHost] = useState(false);
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);

  // Participants & Streams
  const [localParticipant, setLocalParticipant] = useState<Participant>({
    id: userId,
    name: '',
    avatarColor,
    isHost: false,
    isAudioEnabled: true,
    isVideoEnabled: true,
    isScreenSharing: false,
    isHandRaised: false,
    isSpeaking: false,
    joinedAt: Date.now(),
  });

  const [remoteParticipants, setRemoteParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [screenSharingParticipantId, setScreenSharingParticipantId] = useState<string | null>(null);

  // Drawers & Modals
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [knockRequests, setKnockRequests] = useState<KnockRequest[]>([]);
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: string; emoji: string; left: number }[]>([]);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);

  // Refs for access in callbacks
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const signalingRef = useRef<SignalingService | null>(null);
  const localParticipantRef = useRef(localParticipant);
  localParticipantRef.current = localParticipant;
  const isRoomLockedRef = useRef(isRoomLocked);
  isRoomLockedRef.current = isRoomLocked;
  const inMeetingRef = useRef(inMeeting);
  inMeetingRef.current = inMeeting;
  const roomIdRef = useRef('');
  // Latest signaling handler, so the transport never calls a stale closure.
  const signalingHandlerRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const joinPhaseRef = useRef<'idle' | 'probing' | 'not-found'>('idle');
  // Room-existence probe timers
  const probeTimersRef = useRef<number[]>([]);
  const pendingRoomRef = useRef<string>('');
  const remoteParticipantsRef = useRef<Participant[]>([]);
  remoteParticipantsRef.current = remoteParticipants;
  // Last time we heard from each peer. A tab that is closed or crashes never sends
  // `peer-left`, so without this the participant list kept ghosts forever.
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  // Guards against starting two getDisplayMedia captures from a double click.
  const screenShareBusyRef = useRef(false);
  const knockRequestsRef = useRef<KnockRequest[]>([]);
  knockRequestsRef.current = knockRequests;
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  chatMessagesRef.current = chatMessages;
  // Media acquisition must not run twice in parallel (join + a fast device toggle).
  const mediaBusyRef = useRef(false);
  const emojiTimersRef = useRef<number[]>([]);

  // Initial room detection from URL pathname (/slug)
  const [initialRoomParam, setInitialRoomParam] = useState(getRoomSlugFromUrl);

  useEffect(() => {
    const handlePopState = () => {
      const slug = getRoomSlugFromUrl();
      setInitialRoomParam(slug);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Handle remote stream update callback from WebRTC Manager
  const handleRemoteStreamUpdate = useCallback((peerId: string, stream: MediaStream | null) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      if (stream) {
        next.set(peerId, stream);
      } else {
        next.delete(peerId);
      }
      return next;
    });
  }, []);

  // Broadcast local state helper
  const broadcastMyState = useCallback((updatedParticipant: Participant) => {
    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'state-update',
        payload: {
          participant: updatedParticipant,
          isRoomLocked: isRoomLockedRef.current,
        },
      });
    }
  }, []);

  // Connect WebRTC peer connection deterministically: Larger userId initiates the offer
  const connectPeer = useCallback((peerId: string) => {
    const webrtc = webrtcRef.current;
    if (!webrtc) return;

    const isInitiator = userId > peerId;
    console.log(`[Mesh] Connecting to peer ${peerId}, isInitiator: ${isInitiator} (myId: ${userId})`);
    webrtc.createPeerConnection(peerId, isInitiator);
  }, [userId]);

  const clearProbeTimers = useCallback(() => {
    probeTimersRef.current.forEach((t) => window.clearTimeout(t));
    probeTimersRef.current = [];
  }, []);

  // Acquire camera/mic in the background. The meeting UI opens immediately so a slow
  // permission prompt can never look like "the Join button does nothing".
  const startLocalMedia = useCallback(async () => {
    const webrtc = webrtcRef.current;
    if (!webrtc || mediaBusyRef.current) return;
    mediaBusyRef.current = true;
    try {
      // Read the flags from the ref so a toggle that happened while the room was opening
      // is honoured instead of the values captured when the user pressed Join.
      const p = localParticipantRef.current;
      const stream = await webrtc.getLocalMedia(p.isAudioEnabled, p.isVideoEnabled);
      // If the user left while the permission prompt was open, the manager is already gone
      // and the freshly acquired tracks would otherwise keep the camera light on forever.
      if (webrtcRef.current !== webrtc) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setLocalStream(stream);
    } finally {
      mediaBusyRef.current = false;
    }
  }, []);

  // The single place that actually puts us inside the room.
  const enterRoom = useCallback(() => {
    clearProbeTimers();
    setJoinPhase('idle');
    joinPhaseRef.current = 'idle';
    setWaitingStatus('none');
    setInMeeting(true);
    inMeetingRef.current = true;
    sounds.playJoinChime();

    const slug = pendingRoomRef.current || roomIdRef.current;
    if (slug && typeof window !== 'undefined' && window.location.pathname !== `/${slug}`) {
      window.history.pushState({}, '', `/${slug}`);
    }

    const signaling = signalingRef.current;
    if (signaling) {
      signaling.send({
        type: 'state-update',
        payload: {
          participant: localParticipantRef.current,
          isRoomLocked: isRoomLockedRef.current,
        },
      });
    }

    // Media is fetched after the room view is on screen (the Lobby preview must
    // release the camera first).
    window.setTimeout(() => {
      void startLocalMedia();
    }, 150);
  }, [clearProbeTimers, startLocalMedia]);

  // Handle incoming signaling messages
  const handleSignalingMessage = useCallback(async (msg: SignalingMessage) => {
    const webrtc = webrtcRef.current;
    const signaling = signalingRef.current;
    if (!webrtc || !signaling) return;

    switch (msg.type) {
      // 0. Someone asks whether a host already owns this room code
      case 'room-probe':
        if (localParticipantRef.current.isHost && inMeetingRef.current) {
          signaling.send({
            type: 'room-state',
            targetId: msg.senderId,
            payload: {
              hostId: userId,
              isLocked: isRoomLockedRef.current,
              hostJoinedAt: localParticipantRef.current.joinedAt,
            },
          });
        }
        break;

      // 0.5 A host answered our probe: the room exists, join it (or knock if locked)
      case 'room-state':
        if (!inMeetingRef.current && joinPhaseRef.current === 'probing') {
          clearProbeTimers();
          const locked = Boolean(msg.payload?.isLocked);
          setIsRoomLocked(locked);

          if (locked) {
            setWaitingStatus('waiting');
            signaling.send({
              type: 'join-request',
              senderName: localParticipantRef.current.name,
              payload: { avatarColor: localParticipantRef.current.avatarColor },
            });
          } else {
            enterRoom();
          }
        }
        break;

      // 1. Host receives join request / knock
      case 'join-request':
        if (localParticipantRef.current.isHost) {
          // Only alert for a genuinely new knock — a repeated request from the same
          // guest must not re-trigger the sound while the host is deciding.
          const alreadyPending = knockRequestsRef.current.some(
            (k) => k.participantId === msg.senderId
          );
          if (!alreadyPending) {
            sounds.playKnockAlert();
          }
          const newKnock: KnockRequest = {
            id: 'knock_' + Math.random().toString(36).substring(2, 9),
            participantId: msg.senderId,
            name: msg.senderName || 'Guest',
            avatarColor: msg.payload?.avatarColor || AVATAR_COLORS[0],
            requestedAt: Date.now(),
          };
          setKnockRequests((prev) => [
            ...prev.filter((k) => k.participantId !== msg.senderId),
            newKnock,
          ]);
        }
        break;

      // 2. Guest receives approval from host
      case 'join-approved':
        if (msg.targetId === userId) {
          enterRoom();
          connectPeer(msg.senderId);
        }
        break;

      // 3. Guest receives rejection from host
      case 'join-declined':
        if (msg.targetId === userId) {
          clearProbeTimers();
          setJoinPhase('idle');
          setWaitingStatus('declined');
        }
        break;

      // 4. WebRTC Offer received
      case 'offer':
        if (msg.payload && msg.payload.sdp) {
          await webrtc.handleOffer(msg.senderId, msg.payload);
        }
        break;

      // 5. WebRTC Answer received
      case 'answer':
        if (msg.payload && msg.payload.sdp) {
          await webrtc.handleAnswer(msg.senderId, msg.payload);
        }
        break;

      // 6. ICE Candidate received
      case 'ice-candidate':
        if (msg.payload) {
          await webrtc.handleIceCandidate(msg.senderId, msg.payload);
        }
        break;

      // 7. Remote Participant State Update (Sync names, camera, mic, screen share, presence)
      case 'state-update':
        // Only peers that are actually inside the room take part in the mesh. While we
        // are still probing a room code we must not announce ourselves as present.
        if (!inMeetingRef.current) break;
        if (msg.payload?.participant) {
          const remoteP: Participant = msg.payload.participant;
          const isNewPeer = !remoteParticipantsRef.current.some((p) => p.id === remoteP.id);
          lastSeenRef.current.set(remoteP.id, Date.now());

          // Prevent duplicate host collision with same slug: Seniority rule
          if (remoteP.isHost && localParticipantRef.current.isHost && remoteP.id !== userId) {
            const remoteJoinedAt = remoteP.joinedAt || 0;
            const localJoinedAt = localParticipantRef.current.joinedAt || 0;
            const shouldYield =
              remoteJoinedAt < localJoinedAt ||
              (remoteJoinedAt === localJoinedAt && remoteP.id < userId);

            if (shouldYield) {
              console.log(`[Mesh] Existing host discovered (${remoteP.id}). Yielding host role.`);
              setIsHost(false);
              setLocalParticipant((prev) => {
                const next = { ...prev, isHost: false };
                localParticipantRef.current = next;
                return next;
              });
            }
          }

          // If remote participant is sharing screen, update spotlight ID
          if (remoteP.isScreenSharing) {
            setScreenSharingParticipantId(remoteP.id);
          } else if (screenSharingParticipantId === remoteP.id) {
            setScreenSharingParticipantId(null);
          }

          // Add or update participant in list.
          // The chime is played here rather than inside the state updater: updaters must be
          // pure, and React (StrictMode) can invoke them twice.
          if (isNewPeer) {
            sounds.playJoinChime();
          }
          setRemoteParticipants((prev) => {
            const exists = prev.some((p) => p.id === remoteP.id);
            if (exists) {
              return prev.map((p) => (p.id === remoteP.id ? { ...p, ...remoteP } : p));
            }
            return [...prev, remoteP];
          });

          // Connect WebRTC peer connection immediately
          connectPeer(remoteP.id);

          // Sync room locked state if sent from host
          if (remoteP.isHost && msg.payload.isRoomLocked !== undefined) {
            setIsRoomLocked(msg.payload.isRoomLocked);
          }

          // A newcomer announced itself (un-targeted broadcast): answer once so it can
          // discover us. Heartbeats from known peers are ignored to avoid chatter.
          if (!msg.targetId && msg.senderId !== userId && isNewPeer) {
            signaling.send({
              type: 'state-update',
              targetId: msg.senderId,
              payload: {
                participant: localParticipantRef.current,
                isRoomLocked: isRoomLockedRef.current,
              },
            });

            // The host owns the chat backlog — hand it to the newcomer once.
            if (localParticipantRef.current.isHost && chatMessagesRef.current.length > 0) {
              signaling.send({
                type: 'chat-history',
                targetId: msg.senderId,
                payload: { messages: chatMessagesRef.current },
              });
            }
          }
        }
        break;

      // 8. Participant left
      case 'peer-left':
        sounds.playLeaveChime();
        lastSeenRef.current.delete(msg.senderId);
        setRemoteParticipants((prev) => prev.filter((p) => p.id !== msg.senderId));
        if (screenSharingParticipantId === msg.senderId) {
          setScreenSharingParticipantId(null);
        }
        webrtc.closePeer(msg.senderId);
        break;

      // 9. In-call chat message
      case 'chat-message':
        if (msg.payload) {
          const newChat: ChatMessage = msg.payload;
          setChatMessages((prev) =>
            prev.some((m) => m.id === newChat.id) ? prev : [...prev, newChat]
          );
          if (!isChatOpen) {
            setUnreadChatCount((prev) => prev + 1);
          }
        }
        break;

      // 9.5 Chat backlog sent by the host to a newcomer, so a late joiner does not see
      // an empty conversation while everyone else can read it.
      case 'chat-history': {
        const incoming: ChatMessage[] = msg.payload?.messages || [];
        if (incoming.length === 0) break;
        setChatMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          incoming.forEach((m) => {
            if (m && m.id && !seen.has(m.id)) {
              merged.push(m);
              seen.add(m.id);
            }
          });
          merged.sort((a, b) => a.timestamp - b.timestamp);
          return merged;
        });
        break;
      }

      // 10. Reactions (Floating Emojis)
      case 'reaction':
        if (msg.payload?.emoji) {
          triggerFloatingEmoji(msg.payload.emoji);
        }
        break;

      // 11. Room Lock State Changed by Host
      case 'host-lock-toggle':
        if (msg.payload?.isLocked !== undefined) {
          setIsRoomLocked(msg.payload.isLocked);
        }
        break;

      // 12. Host kicked this user
      case 'host-kick':
        if (msg.targetId === userId) {
          handleLeaveMeeting();
          setNotice({
            title: 'Removed from the meeting',
            message: 'The host removed you from this meeting.',
          });
        }
        break;

      default:
        break;
    }
  }, [
    userId,
    screenSharingParticipantId,
    isChatOpen,
    connectPeer,
    broadcastMyState,
    enterRoom,
    clearProbeTimers,
  ]);

  // Always hand the transport the newest handler (avoids stale-closure signaling bugs).
  signalingHandlerRef.current = handleSignalingMessage;

  // Periodic presence heartbeat while in meeting to keep all tabs in sync
  useEffect(() => {
    if (!inMeeting) return;
    const interval = setInterval(() => {
      if (signalingRef.current && localParticipantRef.current) {
        signalingRef.current.send({
          type: 'state-update',
          payload: {
            participant: localParticipantRef.current,
            isRoomLocked: isRoomLockedRef.current,
          },
        });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [inMeeting]);

  // Drop peers that stopped heartbeating (closed tab, crashed browser, lost network).
  // Skipped while our own transport is unhealthy, otherwise we would evict everyone
  // just because *we* cannot hear them.
  useEffect(() => {
    if (!inMeeting) return;
    const interval = window.setInterval(() => {
      const healthy = realtimeStatus === 'connected' || realtimeStatus === 'disabled';
      if (!healthy) return;

      const now = Date.now();
      const stale = remoteParticipantsRef.current.filter(
        (p) => now - (lastSeenRef.current.get(p.id) ?? now) > PEER_TIMEOUT_MS
      );
      if (stale.length === 0) return;

      stale.forEach((p) => {
        lastSeenRef.current.delete(p.id);
        webrtcRef.current?.closePeer(p.id);
      });
      setRemoteParticipants((prev) => prev.filter((p) => !stale.some((s) => s.id === p.id)));
    }, 10000);
    return () => window.clearInterval(interval);
  }, [inMeeting, realtimeStatus]);

  // Keep DB and presence heartbeat alive while in meeting
  useEffect(() => {
    if (!inMeeting || !roomId) return;
    void dbHeartbeat(roomId, userId);

    const interval = window.setInterval(() => {
      void dbHeartbeat(roomId, userId);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [inMeeting, roomId, userId]);

  // Closing the tab notifies peers and updates database
  useEffect(() => {
    if (!inMeeting) return;

    const announceLeave = () => {
      if (signalingRef.current) {
        signalingRef.current.send({ type: 'peer-left' });
      }
      if (roomIdRef.current) {
        void dbLeaveRoom(roomIdRef.current, userId);
      }
    };

    window.addEventListener('pagehide', announceLeave);
    window.addEventListener('beforeunload', announceLeave);
    return () => {
      window.removeEventListener('pagehide', announceLeave);
      window.removeEventListener('beforeunload', announceLeave);
    };
  }, [inMeeting, userId]);

  // Trigger floating emoji animation and confetti
  const triggerFloatingEmoji = (emoji: string) => {
    if (emoji === '🎉') {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 },
      });
    }

    const newId = Math.random().toString(36).substring(2, 9);
    const left = Math.random() * 80 + 10;
    setFloatingEmojis((prev) => [...prev, { id: newId, emoji, left }]);

    const timer = window.setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((item) => item.id !== newId));
      emojiTimersRef.current = emojiTimersRef.current.filter((t) => t !== timer);
    }, 2000);
    emojiTimersRef.current.push(timer);
  };

  // Start or Join Flow from Lobby
  const handleJoinFromLobby = async (data: {
    name: string;
    roomId: string;
    isHost: boolean;
    audioEnabled: boolean;
    videoEnabled: boolean;
    requireHostApproval: boolean;
  }) => {
    const cleanId = cleanRoomCode(data.roomId);
    if (!cleanId) return;

    setNotice(null);
    setRoomId(cleanId);
    roomIdRef.current = cleanId;
    pendingRoomRef.current = cleanId;
    setIsHost(data.isHost);
    setIsRoomLocked(data.requireHostApproval);

    const updatedLocal: Participant = {
      ...localParticipantRef.current,
      name: data.name,
      isHost: data.isHost,
      isAudioEnabled: data.audioEnabled,
      isVideoEnabled: data.videoEnabled,
      joinedAt: Date.now(),
    };
    setLocalParticipant(updatedLocal);
    localParticipantRef.current = updatedLocal;

    // Synchronize / Validate with Supabase Database
    const dbResult = await dbJoinOrCreateRoom({
      code: cleanId,
      userId,
      userName: data.name,
      avatarColor: updatedLocal.avatarColor,
      isCreate: data.isHost,
      requireApproval: data.requireHostApproval,
    });

    if (!data.isHost) {
      if (!dbResult.success && dbResult.error === 'ROOM_NOT_FOUND_OR_CLOSED') {
        setJoinPhase('not-found');
        joinPhaseRef.current = 'not-found';
        return;
      }
    }

    // Setup Signaling Channel
    const signaling = new SignalingService(cleanId, userId);
    signalingRef.current = signaling;
    // A stable wrapper: the transport always reaches the latest handler.
    signaling.connect((msg) => signalingHandlerRef.current(msg));
    signaling.onStatusChange(setRealtimeStatus);

    // Presence is the reliable discovery channel: if a handshake broadcast was lost,
    // presence still tells us who is in the room so we can greet them directly.
    signaling.onPresence((peerIds) => {
      if (!inMeetingRef.current) return;
      peerIds.forEach((peerId) => {
        if (remoteParticipantsRef.current.some((p) => p.id === peerId)) return;
        signaling.send({
          type: 'state-update',
          targetId: peerId,
          payload: {
            participant: localParticipantRef.current,
            isRoomLocked: isRoomLockedRef.current,
          },
        });
      });
    });

    // Setup WebRTC Manager
    const webrtc = new WebRTCManager(signaling, userId, handleRemoteStreamUpdate);
    webrtcRef.current = webrtc;

    // Handle screen share ended from browser native UI bar
    webrtc.setScreenShareEndedCallback(() => {
      setScreenStream(null);
      setScreenSharingParticipantId(null);
      setLocalParticipant((prev) => {
        const reverted = { ...prev, isScreenSharing: false };
        broadcastMyState(reverted);
        return reverted;
      });
    });

    // Detect speaking levels
    webrtc.setAudioLevelCallback((level) => {
      const isSpeaking = level > 25 && localParticipantRef.current.isAudioEnabled;
      setLocalParticipant((prev) => {
        if (prev.isSpeaking !== isSpeaking) {
          const next = { ...prev, isSpeaking, audioLevel: level };
          signaling.send({
            type: 'state-update',
            payload: { participant: next },
          });
          return next;
        }
        return prev;
      });
    });

    // If host created the meeting or DB confirms host:
    if (data.isHost || dbResult.isHost) {
      enterRoom();
      return;
    }

    // If room is locked according to DB:
    if (dbResult.isLocked) {
      setIsRoomLocked(true);
      isRoomLockedRef.current = true;
      setWaitingStatus('waiting');
      signaling.send({
        type: 'join-request',
        senderName: data.name,
        payload: { avatarColor: localParticipantRef.current.avatarColor },
      });
      return;
    }

    // Unlocked existing room: enter directly and connect with all existing active peers from DB
    const existingActivePeers = await dbGetActiveParticipants(cleanId, userId);
    if (existingActivePeers.length > 0) {
      setRemoteParticipants(existingActivePeers);
      remoteParticipantsRef.current = existingActivePeers;
      existingActivePeers.forEach((peer) => {
        lastSeenRef.current.set(peer.id, Date.now());
        connectPeer(peer.id);
      });
    }

    enterRoom();
  };

  // The room code does not exist yet — the user chose to open it as the host.
  const handleStartMissingRoom = async () => {
    sounds.playClick();
    setIsHost(true);
    // Update the ref synchronously so the very first broadcast already says "host".
    const next: Participant = { ...localParticipantRef.current, isHost: true, joinedAt: Date.now() };
    localParticipantRef.current = next;
    setLocalParticipant(next);

    const targetCode = pendingRoomRef.current || roomIdRef.current;
    if (targetCode) {
      await dbJoinOrCreateRoom({
        code: targetCode,
        userId,
        userName: next.name,
        avatarColor: next.avatarColor,
        isCreate: true,
        requireApproval: false,
      });
    }

    enterRoom();
  };

  const handleCancelMissingRoom = () => {
    sounds.playClick();
    clearProbeTimers();

    if (signalingRef.current) {
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }
    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
      webrtcRef.current = null;
    }

    setIsHost(false);
    setLocalParticipant((prev) => {
      const next = { ...prev, isHost: false };
      localParticipantRef.current = next;
      return next;
    });
    setJoinPhase('idle');
    joinPhaseRef.current = 'idle';
  };

  // Toggle Audio
  const handleToggleAudio = async () => {
    // Read from the ref, not the render closure: two fast clicks used to compute the
    // same "next" value and leave the button out of sync with the real track.
    const prev = localParticipantRef.current;
    const nextState = !prev.isAudioEnabled;
    const updated = { ...prev, isAudioEnabled: nextState };
    localParticipantRef.current = updated;
    setLocalParticipant(updated);
    broadcastMyState(updated);

    const webrtc = webrtcRef.current;
    if (!webrtc) return;

    if (nextState) {
      // The user may have joined muted, so there was never a track to just re-enable.
      const stream = await webrtc.ensureAudioTrack();
      if (stream) setLocalStream(stream);
    } else {
      webrtc.toggleAudio(false);
    }
  };

  // Toggle Video
  const handleToggleVideo = async () => {
    const prev = localParticipantRef.current;
    const nextState = !prev.isVideoEnabled;
    const updated = { ...prev, isVideoEnabled: nextState };
    localParticipantRef.current = updated;
    setLocalParticipant(updated);
    broadcastMyState(updated);

    const webrtc = webrtcRef.current;
    if (!webrtc) return;

    if (nextState) {
      const stream = await webrtc.ensureVideoTrack();
      if (stream) setLocalStream(stream);
    } else {
      webrtc.toggleVideo(false);
    }
  };

  // Toggle Screen Share
  const handleToggleScreenShare = async () => {
    const webrtc = webrtcRef.current;
    if (!webrtc || screenShareBusyRef.current) return;

    const prev = localParticipantRef.current;

    if (prev.isScreenSharing) {
      webrtc.stopScreenShare();
      setScreenStream(null);
      const updated = { ...prev, isScreenSharing: false };
      localParticipantRef.current = updated;
      setLocalParticipant(updated);
      setScreenSharingParticipantId(null);
      broadcastMyState(updated);
      return;
    }

    // getDisplayMedia takes a moment; without the guard a double click opened two captures.
    screenShareBusyRef.current = true;
    try {
      const stream = await webrtc.startScreenShare();
      setScreenStream(stream);
      const updated = { ...localParticipantRef.current, isScreenSharing: true };
      localParticipantRef.current = updated;
      setLocalParticipant(updated);
      setScreenSharingParticipantId(userId);
      broadcastMyState(updated);
    } catch (e) {
      console.error('Screen sharing start error:', e);
    } finally {
      screenShareBusyRef.current = false;
    }
  };

  // Toggle Hand Raise
  const handleToggleHandRaise = () => {
    const prev = localParticipantRef.current;
    const updated = { ...prev, isHandRaised: !prev.isHandRaised };
    localParticipantRef.current = updated;
    setLocalParticipant(updated);
    broadcastMyState(updated);
  };

  // Send Reaction
  const handleSendReaction = (emoji: string) => {
    triggerFloatingEmoji(emoji);
    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'reaction',
        payload: { emoji },
      });
    }
  };

  // Send Chat Message
  const handleSendMessage = (text: string) => {
    const chatMsg: ChatMessage = {
      id: 'msg_' + Math.random().toString(36).substring(2, 9),
      senderId: userId,
      senderName: localParticipant.name,
      text,
      timestamp: Date.now(),
      isHost: localParticipant.isHost,
    };
    setChatMessages((prev) => [...prev, chatMsg]);

    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'chat-message',
        payload: chatMsg,
      });
    }
  };

  // Host Admits Knocking Guest
  const handleAdmitKnock = (knock: KnockRequest) => {
    sounds.playClick();
    setKnockRequests((prev) => prev.filter((k) => k.id !== knock.id));
    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'join-approved',
        targetId: knock.participantId,
      });
    }
    connectPeer(knock.participantId);
  };

  // Host Declines Knocking Guest
  const handleDeclineKnock = (knockId: string) => {
    sounds.playClick();
    const target = knockRequests.find((k) => k.id === knockId);
    setKnockRequests((prev) => prev.filter((k) => k.id !== knockId));
    if (signalingRef.current && target) {
      signalingRef.current.send({
        type: 'join-declined',
        targetId: target.participantId,
      });
    }
  };

  // Host Toggles Room Lock
  const handleToggleRoomLock = () => {
    const nextState = !isRoomLockedRef.current;
    isRoomLockedRef.current = nextState;
    setIsRoomLocked(nextState);
    if (roomIdRef.current) {
      void dbUpdateRoomLock(roomIdRef.current, nextState);
    }
    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'host-lock-toggle',
        payload: { isLocked: nextState },
      });
    }
  };

  // Host Kicks Participant
  const handleKickParticipant = (participantId: string) => {
    sounds.playClick();
    setRemoteParticipants((prev) => prev.filter((p) => p.id !== participantId));
    if (webrtcRef.current) {
      webrtcRef.current.closePeer(participantId);
    }
    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'host-kick',
        targetId: participantId,
      });
    }
  };

  // Leave Meeting
  const handleLeaveMeeting = () => {
    clearProbeTimers();

    const targetCode = roomIdRef.current || pendingRoomRef.current;
    if (targetCode) {
      void dbLeaveRoom(targetCode, userId);
    }

    // Reset URL back to root
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }

    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'peer-left',
      });
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }

    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
      webrtcRef.current = null;
    }

    lastSeenRef.current.clear();
    screenShareBusyRef.current = false;
    setLocalStream(null);
    setScreenStream(null);
    setRemoteStreams(new Map());
    setRemoteParticipants([]);
    setChatMessages([]);
    setKnockRequests([]);
    setInMeeting(false);
    inMeetingRef.current = false;
    setWaitingStatus('none');
    setJoinPhase('idle');
    joinPhaseRef.current = 'idle';
    setPinnedParticipantId(null);
    setScreenSharingParticipantId(null);
    setUnreadChatCount(0);
    // Otherwise these drawers reappear open the next time the user joins.
    setIsChatOpen(false);
    setIsParticipantsOpen(false);
    setIsSettingsOpen(false);
    setIsHost(false);
    setIsRoomLocked(false);
    isRoomLockedRef.current = false;
  };

  // Safety net: never leave the camera/mic running if the app unmounts mid-call.
  useEffect(() => {
    return () => {
      emojiTimersRef.current.forEach((t) => window.clearTimeout(t));
      emojiTimersRef.current = [];
      if (signalingRef.current) {
        try {
          signalingRef.current.send({ type: 'peer-left' });
          signalingRef.current.disconnect();
        } catch (e) {
          /* already gone */
        }
        signalingRef.current = null;
      }
      if (webrtcRef.current) {
        webrtcRef.current.cleanup();
        webrtcRef.current = null;
      }
    };
  }, []);

  // Change Device Input
  const handleDeviceChange = async (audioId: string, videoId: string) => {
    const webrtc = webrtcRef.current;
    if (!webrtc) return;
    const prev = localParticipantRef.current;
    // Ask for the camera whenever the user currently has video on, otherwise the new
    // stream would silently drop the video track and "turn on camera" would stop working.
    const stream = await webrtc.getLocalMedia(
      prev.isAudioEnabled,
      prev.isVideoEnabled,
      audioId || undefined,
      videoId || undefined
    );
    if (webrtcRef.current !== webrtc) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    setLocalStream(stream);
  };

  // If waiting in knock queue
  if (waitingStatus !== 'none') {
    return (
      <GuestWaitingScreen
        roomName={roomId}
        status={waitingStatus}
        onCancel={handleLeaveMeeting}
      />
    );
  }

  // Lobby View
  if (!inMeeting) {
    return (
      <>
        <Lobby onJoin={handleJoinFromLobby} initialRoomId={initialRoomParam} />
        {joinPhase === 'not-found' && (
          <RoomNotFoundModal
            roomId={roomId}
            onStart={handleStartMissingRoom}
            onCancel={handleCancelMissingRoom}
          />
        )}
        {notice && (
          <NoticeModal
            title={notice.title}
            message={notice.message}
            onClose={() => setNotice(null)}
          />
        )}
      </>
    );
  }

  // Active Meeting View
  return (
    <div className="relative w-screen h-screen bg-dark-950 text-slate-100 overflow-hidden select-none flex flex-col justify-between">
      {/* Background ambient radial glows */}
      <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="absolute bottom-1/3 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Top Header */}
      <MeetingHeader
        roomId={roomId}
        isHost={isHost}
        isRoomLocked={isRoomLocked}
        participantsCount={remoteParticipants.length + 1}
      />

      {/* Host Knock Banner (Appears when someone knocks) */}
      {isHost && (
        <HostKnockBanner
          knockRequests={knockRequests}
          onAdmit={handleAdmitKnock}
          onDecline={handleDeclineKnock}
        />
      )}

      {/* Transport health — makes "I'm alone in the room" explainable */}
      <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4">
        <ConnectionBanner status={realtimeStatus} />
      </div>

      {/* Floating Emojis Overlay */}
      {floatingEmojis.map((item) => (
        <div
          key={item.id}
          className="reaction-particle z-50 pointer-events-none"
          style={{ left: `${item.left}%`, bottom: '100px' }}
        >
          {item.emoji}
        </div>
      ))}

      {/* Center: Main Video Grid & Spotlight Area */}
      <main className="flex-1 w-full h-full pt-16 pb-24 px-2 sm:px-4 flex items-center justify-center overflow-hidden">
        <VideoGrid
          localParticipant={localParticipant}
          localStream={localStream}
          remoteParticipants={remoteParticipants}
          remoteStreams={remoteStreams}
          pinnedId={pinnedParticipantId}
          onTogglePin={(id) => setPinnedParticipantId(pinnedParticipantId === id ? null : id)}
          screenStream={screenStream}
          screenSharingParticipantId={screenSharingParticipantId}
        />
      </main>

      {/* Bottom Floating Controls Dock */}
      <MeetingControls
        isAudioEnabled={localParticipant.isAudioEnabled}
        isVideoEnabled={localParticipant.isVideoEnabled}
        isScreenSharing={localParticipant.isScreenSharing}
        isHandRaised={localParticipant.isHandRaised}
        isChatOpen={isChatOpen}
        isParticipantsOpen={isParticipantsOpen}
        unreadChatCount={unreadChatCount}
        pendingKnocksCount={knockRequests.length}
        participantsCount={remoteParticipants.length + 1}
        isHost={isHost}
        isRoomLocked={isRoomLocked}
        onToggleAudio={handleToggleAudio}
        onToggleVideo={handleToggleVideo}
        onToggleScreenShare={handleToggleScreenShare}
        onToggleHandRaise={handleToggleHandRaise}
        onToggleChat={() => {
          const next = !isChatOpen;
          setIsChatOpen(next);
          // The two drawers are both anchored to the right edge — only one at a time.
          if (next) setIsParticipantsOpen(false);
          if (next) setUnreadChatCount(0);
        }}
        onToggleParticipants={() => {
          const next = !isParticipantsOpen;
          setIsParticipantsOpen(next);
          if (next) setIsChatOpen(false);
        }}
        onSendReaction={handleSendReaction}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLeaveMeeting={handleLeaveMeeting}
        onToggleRoomLock={handleToggleRoomLock}
      />

      {/* In-Call Chat Drawer */}
      <ChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        onSendMessage={handleSendMessage}
        currentUserId={userId}
      />

      {/* Participants & Host Security Drawer */}
      <ParticipantsDrawer
        isOpen={isParticipantsOpen}
        onClose={() => setIsParticipantsOpen(false)}
        localParticipant={localParticipant}
        remoteParticipants={remoteParticipants}
        isHost={isHost}
        isRoomLocked={isRoomLocked}
        knockRequests={knockRequests}
        roomId={roomId}
        onToggleRoomLock={handleToggleRoomLock}
        onAdmitKnock={handleAdmitKnock}
        onDeclineKnock={handleDeclineKnock}
        onKickParticipant={handleKickParticipant}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onDeviceChange={handleDeviceChange}
      />
    </div>
  );
};

export default App;
