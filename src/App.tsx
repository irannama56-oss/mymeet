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
import { AdminLogin } from './components/admin/AdminLogin';
import { AdminDashboard } from './components/admin/AdminDashboard';
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
  AdminUser,
  cleanRoomCode,
  isRoomCodeLike,
} from './lib/types';
import { getStoredAdminSession, adminLogout } from './lib/adminAuth';
import { sounds } from './lib/sound';
import { RoomNotFoundModal } from './components/RoomNotFoundModal';
import { ConnectionBanner } from './components/ConnectionBanner';
import { NoticeModal } from './components/NoticeModal';

const PEER_TIMEOUT_MS = 45000;

const AVATAR_COLORS = [
  'from-indigo-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
];

const checkIsAdminPath = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();
  return (
    path.startsWith('/admin') ||
    path.startsWith('/login') ||
    search.includes('admin=true') ||
    search.includes('login=true')
  );
};

const getRoomSlugFromUrl = (): string => {
  if (typeof window === 'undefined') return '';
  const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '').trim().toLowerCase();
  if (pathname && !pathname.includes('.') && isRoomCodeLike(pathname) && !pathname.startsWith('admin')) {
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
  // Navigation & View Routing State
  const [adminUser, setAdminUser] = useState<AdminUser | null>(() => getStoredAdminSession());
  const [currentView, setCurrentView] = useState<'lobby' | 'admin-login' | 'admin-dashboard'>(() => {
    if (checkIsAdminPath()) {
      return getStoredAdminSession() ? 'admin-dashboard' : 'admin-login';
    }
    return 'lobby';
  });

  // Session & UI States
  const [inMeeting, setInMeeting] = useState(false);
  const [waitingStatus, setWaitingStatus] = useState<'none' | 'waiting' | 'declined'>('none');
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

  // Push to talk state
  const spacePressedRef = useRef(false);
  const preSpaceMutedRef = useRef(false);

  // Speaking debounce ref
  const speakingTimeoutRef = useRef<any>(null);

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
  const signalingHandlerRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const joinPhaseRef = useRef<'idle' | 'probing' | 'not-found'>('idle');
  const probeTimersRef = useRef<any[]>([]);
  const pendingRoomRef = useRef<string>('');
  const remoteParticipantsRef = useRef<Participant[]>([]);
  remoteParticipantsRef.current = remoteParticipants;
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const screenShareBusyRef = useRef(false);
  const knockRequestsRef = useRef<KnockRequest[]>([]);
  knockRequestsRef.current = knockRequests;
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  chatMessagesRef.current = chatMessages;
  const mediaBusyRef = useRef(false);
  const emojiTimersRef = useRef<any[]>([]);

  // Initial room detection from URL pathname
  const [initialRoomParam, setInitialRoomParam] = useState(getRoomSlugFromUrl);

  // Browser history popstate handler
  useEffect(() => {
    const handlePopState = () => {
      if (checkIsAdminPath()) {
        const stored = getStoredAdminSession();
        setAdminUser(stored);
        setCurrentView(stored ? 'admin-dashboard' : 'admin-login');
      } else {
        const slug = getRoomSlugFromUrl();
        setInitialRoomParam(slug);
        if (!inMeetingRef.current) {
          setCurrentView('lobby');
        }
      }
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

  // Connect WebRTC peer connection deterministically: Larger userId initiates offer
  const connectPeer = useCallback((peerId: string) => {
    const webrtc = webrtcRef.current;
    if (!webrtc) return;

    const isInitiator = userId > peerId;
    console.log(`[Mesh] Connecting to peer ${peerId}, isInitiator: ${isInitiator} (myId: ${userId})`);
    webrtc.createPeerConnection(peerId, isInitiator);
  }, [userId]);

  const clearProbeTimers = useCallback(() => {
    probeTimersRef.current.forEach((t) => clearTimeout(t));
    probeTimersRef.current = [];
  }, []);

  // Acquire camera/mic
  const startLocalMedia = useCallback(async () => {
    const webrtc = webrtcRef.current;
    if (!webrtc || mediaBusyRef.current) return;
    mediaBusyRef.current = true;
    try {
      const p = localParticipantRef.current;
      const stream = await webrtc.getLocalMedia(p.isAudioEnabled, p.isVideoEnabled);
      if (webrtcRef.current !== webrtc) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setLocalStream(stream);
    } finally {
      mediaBusyRef.current = false;
    }
  }, []);

  // Enter room helper
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

    void startLocalMedia();
  }, [clearProbeTimers, startLocalMedia]);

  // Leave Meeting Helper
  const handleLeaveMeeting = useCallback(() => {
    clearProbeTimers();

    const targetCode = roomIdRef.current || pendingRoomRef.current;
    if (targetCode) {
      void dbLeaveRoom(targetCode, userId);
    }

    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }

    if (signalingRef.current) {
      try {
        signalingRef.current.send({
          type: 'peer-left',
        });
        signalingRef.current.disconnect();
      } catch {}
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
    setIsChatOpen(false);
    setIsParticipantsOpen(false);
    setIsSettingsOpen(false);
    setIsHost(false);
    setIsRoomLocked(false);
    isRoomLockedRef.current = false;
  }, [clearProbeTimers, userId]);

  // Handle incoming signaling messages
  const handleSignalingMessage = useCallback(async (msg: SignalingMessage) => {
    const webrtc = webrtcRef.current;
    const signaling = signalingRef.current;
    if (!webrtc || !signaling) return;

    switch (msg.type) {
      // 0. Guest sends probe to check if host/room exists
      case 'room-probe':
        if (inMeetingRef.current) {
          signaling.send({
            type: 'room-state',
            targetId: msg.senderId,
            payload: {
              hostId: localParticipantRef.current.isHost ? userId : undefined,
              isLocked: isRoomLockedRef.current,
              hostJoinedAt: localParticipantRef.current.joinedAt,
              activePeers: remoteParticipantsRef.current.map((p) => p.id),
            },
          });
        }
        break;

      // 0.5 Response to probe
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

      // 7. Remote Participant State Update
      case 'state-update':
        if (!inMeetingRef.current && joinPhaseRef.current === 'probing') {
          // If probing and active state received, room exists!
          clearProbeTimers();
          if (msg.payload?.isRoomLocked) {
            setIsRoomLocked(true);
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

        if (!inMeetingRef.current) break;

        if (msg.payload?.participant) {
          const remoteP: Participant = msg.payload.participant;
          const isNewPeer = !remoteParticipantsRef.current.some((p) => p.id === remoteP.id);
          lastSeenRef.current.set(remoteP.id, Date.now());

          // Prevent duplicate host collision: Super Admin always retains host; else seniority rule
          if (
            remoteP.isHost &&
            localParticipantRef.current.isHost &&
            remoteP.id !== userId &&
            !localParticipantRef.current.isSuperAdmin
          ) {
            const remoteJoinedAt = remoteP.joinedAt || 0;
            const localJoinedAt = localParticipantRef.current.joinedAt || 0;
            const shouldYield =
              remoteP.isSuperAdmin ||
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

          if (remoteP.isScreenSharing) {
            setScreenSharingParticipantId(remoteP.id);
          } else if (screenSharingParticipantId === remoteP.id) {
            setScreenSharingParticipantId(null);
          }

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

          connectPeer(remoteP.id);

          if (remoteP.isHost && msg.payload.isRoomLocked !== undefined) {
            setIsRoomLocked(msg.payload.isRoomLocked);
          }

          if (!msg.targetId && msg.senderId !== userId && isNewPeer) {
            signaling.send({
              type: 'state-update',
              targetId: msg.senderId,
              payload: {
                participant: localParticipantRef.current,
                isRoomLocked: isRoomLockedRef.current,
              },
            });

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
          if (newChat.senderId !== userId) {
            sounds.playMessagePop();
            setChatMessages((prev) =>
              prev.some((m) => m.id === newChat.id) ? prev : [...prev, newChat]
            );
            if (!isChatOpen) {
              setUnreadChatCount((prev) => prev + 1);
            }
          }
        }
        break;

      // 9.5 Chat backlog
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

      // 10. Reactions
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
        if (msg.targetId === userId && !localParticipantRef.current.isSuperAdmin) {
          handleLeaveMeeting();
          setNotice({
            title: 'Removed from the meeting',
            message: 'The host removed you from this meeting.',
          });
        }
        break;

      // 13. Super Admin closed room
      case 'admin-room-closed':
        handleLeaveMeeting();
        setNotice({
          title: 'Meeting Terminated',
          message: 'This meeting was closed by a Super Administrator.',
        });
        break;

      default:
        break;
    }
  }, [
    userId,
    screenSharingParticipantId,
    isChatOpen,
    connectPeer,
    enterRoom,
    clearProbeTimers,
    handleLeaveMeeting,
  ]);

  signalingHandlerRef.current = handleSignalingMessage;

  // Periodic presence heartbeat while in meeting
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

  // Drop peers that stopped heartbeating
  useEffect(() => {
    if (!inMeeting) return;
    const interval = setInterval(() => {
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
    return () => clearInterval(interval);
  }, [inMeeting, realtimeStatus]);

  // Keep DB heartbeat alive
  useEffect(() => {
    if (!inMeeting || !roomId) return;
    void dbHeartbeat(roomId, userId);

    const interval = setInterval(() => {
      void dbHeartbeat(roomId, userId);
    }, 15000);
    return () => clearInterval(interval);
  }, [inMeeting, roomId, userId]);

  // Closing tab notifies peers
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
        particleCount: 60,
        spread: 70,
        origin: { y: 0.8 },
      });
    }

    const newId = Math.random().toString(36).substring(2, 9);
    const left = Math.random() * 80 + 10;
    setFloatingEmojis((prev) => [...prev, { id: newId, emoji, left }]);

    const timer = setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((item) => item.id !== newId));
      emojiTimersRef.current = emojiTimersRef.current.filter((t) => t !== timer);
    }, 2200);
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

    // Check / Sync with Database with fast timeout
    const dbResult = await dbJoinOrCreateRoom({
      code: cleanId,
      userId,
      userName: data.name,
      avatarColor: updatedLocal.avatarColor,
      isCreate: data.isHost,
      requireApproval: data.requireHostApproval,
    });

    // If joining an existing room and DB confirmed it does NOT exist:
    if (!data.isHost && !dbResult.success && dbResult.error === 'ROOM_NOT_FOUND_OR_CLOSED') {
      setJoinPhase('not-found');
      joinPhaseRef.current = 'not-found';
      return;
    }

    // Setup Signaling Channel
    const signaling = new SignalingService(cleanId, userId);
    signalingRef.current = signaling;
    signaling.connect((msg) => signalingHandlerRef.current(msg));
    signaling.onStatusChange(setRealtimeStatus);

    // Setup Presence
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

    // Handle screen share ended
    webrtc.setScreenShareEndedCallback(() => {
      setScreenStream(null);
      setScreenSharingParticipantId(null);
      setLocalParticipant((prev) => {
        const reverted = { ...prev, isScreenSharing: false };
        localParticipantRef.current = reverted;
        broadcastMyState(reverted);
        return reverted;
      });
    });

    // Detect speaking levels
    webrtc.setAudioLevelCallback((level) => {
      const isVoiceDetected = level > 25 && localParticipantRef.current.isAudioEnabled;

      if (isVoiceDetected) {
        if (speakingTimeoutRef.current) {
          clearTimeout(speakingTimeoutRef.current);
          speakingTimeoutRef.current = null;
        }
        if (!localParticipantRef.current.isSpeaking) {
          setLocalParticipant((prev) => {
            const next = { ...prev, isSpeaking: true, audioLevel: level };
            signaling.send({
              type: 'state-update',
              payload: { participant: next },
            });
            return next;
          });
        }
      } else {
        if (localParticipantRef.current.isSpeaking && !speakingTimeoutRef.current) {
          speakingTimeoutRef.current = setTimeout(() => {
            speakingTimeoutRef.current = null;
            setLocalParticipant((prev) => {
              const next = { ...prev, isSpeaking: false, audioLevel: 0 };
              signaling.send({
                type: 'state-update',
                payload: { participant: next },
              });
              return next;
            });
          }, 350);
        }
      }
    });

    // 1. If host created the meeting
    if (data.isHost || dbResult.isHost) {
      enterRoom();
      return;
    }

    // 2. If room is known and locked in DB
    if (dbResult.success && dbResult.isLocked) {
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

    // 3. If room is known and unlocked in DB
    if (dbResult.success) {
      enterRoom();
      return;
    }

    // 4. DB was offline or timed out -> probe live mesh
    setJoinPhase('probing');
    joinPhaseRef.current = 'probing';

    signaling.send({
      type: 'room-probe',
      senderName: data.name,
    });

    // Probe timeout: if no active host or peer responds within 2.5s, room is NOT found
    const probeTimeout = setTimeout(async () => {
      if (joinPhaseRef.current === 'probing' && !inMeetingRef.current) {
        const existingActivePeers = await dbGetActiveParticipants(cleanId, userId);
        if (existingActivePeers.length > 0) {
          setRemoteParticipants(existingActivePeers);
          remoteParticipantsRef.current = existingActivePeers;
          existingActivePeers.forEach((peer) => {
            lastSeenRef.current.set(peer.id, Date.now());
            connectPeer(peer.id);
          });
          enterRoom();
        } else {
          // STRICT: Room does not exist -> show RoomNotFoundModal (no creation permitted)
          setJoinPhase('not-found');
          joinPhaseRef.current = 'not-found';

          if (signalingRef.current) {
            signalingRef.current.disconnect();
            signalingRef.current = null;
          }
          if (webrtcRef.current) {
            webrtcRef.current.cleanup();
            webrtcRef.current = null;
          }
        }
      }
    }, 2500);
    probeTimersRef.current.push(probeTimeout);
  };

  // Join Room directly as Super Admin (unrestricted bypass, host privileges, golden badge)
  const handleJoinAsSuperAdmin = async (roomCode: string) => {
    const cleanId = cleanRoomCode(roomCode);
    if (!cleanId) return;

    setNotice(null);
    setRoomId(cleanId);
    roomIdRef.current = cleanId;
    pendingRoomRef.current = cleanId;
    setIsHost(true);
    setIsRoomLocked(false);

    const superAdminLocal: Participant = {
      ...localParticipantRef.current,
      name: 'Super Admin',
      isHost: true,
      isSuperAdmin: true,
      role: 'superadmin',
      avatarColor: 'from-amber-500 via-orange-600 to-indigo-700',
      isAudioEnabled: true,
      isVideoEnabled: true,
      joinedAt: Date.now(),
    };
    setLocalParticipant(superAdminLocal);
    localParticipantRef.current = superAdminLocal;

    // Register / Update in Supabase
    await dbJoinOrCreateRoom({
      code: cleanId,
      userId,
      userName: 'Super Admin',
      avatarColor: superAdminLocal.avatarColor,
      isCreate: true,
      requireApproval: false,
    });

    // Setup Signaling Channel
    const signaling = new SignalingService(cleanId, userId);
    signalingRef.current = signaling;
    signaling.connect((msg) => signalingHandlerRef.current(msg));
    signaling.onStatusChange(setRealtimeStatus);

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

    webrtc.setScreenShareEndedCallback(() => {
      setScreenStream(null);
      setScreenSharingParticipantId(null);
      setLocalParticipant((prev) => {
        const reverted = { ...prev, isScreenSharing: false };
        localParticipantRef.current = reverted;
        broadcastMyState(reverted);
        return reverted;
      });
    });

    webrtc.setAudioLevelCallback((level) => {
      const isVoiceDetected = level > 25 && localParticipantRef.current.isAudioEnabled;
      if (isVoiceDetected) {
        if (speakingTimeoutRef.current) {
          clearTimeout(speakingTimeoutRef.current);
          speakingTimeoutRef.current = null;
        }
        if (!localParticipantRef.current.isSpeaking) {
          setLocalParticipant((prev) => {
            const next = { ...prev, isSpeaking: true, audioLevel: level };
            signaling.send({
              type: 'state-update',
              payload: { participant: next },
            });
            return next;
          });
        }
      } else {
        if (localParticipantRef.current.isSpeaking && !speakingTimeoutRef.current) {
          speakingTimeoutRef.current = setTimeout(() => {
            speakingTimeoutRef.current = null;
            setLocalParticipant((prev) => {
              const next = { ...prev, isSpeaking: false, audioLevel: 0 };
              signaling.send({
                type: 'state-update',
                payload: { participant: next },
              });
              return next;
            });
          }, 350);
        }
      }
    });

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
    const prev = localParticipantRef.current;
    const nextState = !prev.isAudioEnabled;
    const updated = { ...prev, isAudioEnabled: nextState };
    localParticipantRef.current = updated;
    setLocalParticipant(updated);
    broadcastMyState(updated);

    const webrtc = webrtcRef.current;
    if (!webrtc) return;

    if (nextState) {
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
      isSuperAdmin: Boolean(localParticipant.isSuperAdmin),
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

  // Global Keyboard Shortcuts
  useEffect(() => {
    if (!inMeeting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        sounds.playClick();
        void handleToggleAudio();
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        sounds.playClick();
        void handleToggleVideo();
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        sounds.playHandRaise();
        handleToggleHandRaise();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        sounds.playClick();
        setIsChatOpen((prev) => {
          const next = !prev;
          if (next) {
            setIsParticipantsOpen(false);
            setUnreadChatCount(0);
          }
          return next;
        });
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        sounds.playClick();
        setIsParticipantsOpen((prev) => {
          const next = !prev;
          if (next) setIsChatOpen(false);
          return next;
        });
      } else if (e.key === 'Escape') {
        setIsChatOpen(false);
        setIsParticipantsOpen(false);
        setIsSettingsOpen(false);
      } else if (e.code === 'Space' && !spacePressedRef.current) {
        if (!localParticipantRef.current.isAudioEnabled) {
          e.preventDefault();
          spacePressedRef.current = true;
          preSpaceMutedRef.current = true;
          void handleToggleAudio();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spacePressedRef.current) {
        e.preventDefault();
        spacePressedRef.current = false;
        if (preSpaceMutedRef.current && localParticipantRef.current.isAudioEnabled) {
          void handleToggleAudio();
        }
        preSpaceMutedRef.current = false;
      }
    };

    const handleWindowBlur = () => {
      if (spacePressedRef.current) {
        spacePressedRef.current = false;
        if (preSpaceMutedRef.current && localParticipantRef.current.isAudioEnabled) {
          void handleToggleAudio();
        }
        preSpaceMutedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [inMeeting]);

  // Unmount safety net
  useEffect(() => {
    return () => {
      emojiTimersRef.current.forEach((t) => clearTimeout(t));
      emojiTimersRef.current = [];
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
      }
      if (signalingRef.current) {
        try {
          signalingRef.current.send({ type: 'peer-left' });
          signalingRef.current.disconnect();
        } catch {}
        signalingRef.current = null;
      }
      if (webrtcRef.current) {
        webrtcRef.current.cleanup();
        webrtcRef.current = null;
      }
    };
  }, []);

  // Change Device Input from Settings
  const handleDeviceChange = async (audioId: string, videoId: string) => {
    const webrtc = webrtcRef.current;
    if (!webrtc) return;
    const prev = localParticipantRef.current;
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

  // Admin Login View
  if (!inMeeting && currentView === 'admin-login') {
    return (
      <AdminLogin
        onSuccess={(admin) => {
          setAdminUser(admin);
          setCurrentView('admin-dashboard');
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/admin/dashboard');
          }
        }}
        onBackToApp={() => {
          sounds.playClick();
          setCurrentView('lobby');
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/');
          }
        }}
      />
    );
  }

  // Admin Dashboard View
  if (!inMeeting && currentView === 'admin-dashboard' && adminUser) {
    return (
      <AdminDashboard
        admin={adminUser}
        onLogout={() => {
          adminLogout();
          setAdminUser(null);
          setCurrentView('admin-login');
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/admin');
          }
        }}
        onJoinAsSuperAdmin={(code) => {
          handleJoinAsSuperAdmin(code);
        }}
        onBackToApp={() => {
          sounds.playClick();
          setCurrentView('lobby');
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/');
          }
        }}
      />
    );
  }

  // Lobby View
  if (!inMeeting) {
    return (
      <>
        <Lobby
          onJoin={handleJoinFromLobby}
          initialRoomId={initialRoomParam}
          onOpenAdmin={() => {
            const stored = getStoredAdminSession();
            setAdminUser(stored);
            setCurrentView(stored ? 'admin-dashboard' : 'admin-login');
            if (typeof window !== 'undefined') {
              window.history.pushState({}, '', '/admin');
            }
          }}
        />
        {joinPhase === 'probing' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/80 backdrop-blur-md animate-in fade-in duration-150">
            <div className="p-6 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl text-center space-y-3 max-w-xs w-full">
              <div className="w-10 h-10 mx-auto rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 animate-spin">
                <span className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent" />
              </div>
              <p className="text-sm font-semibold text-white">Connecting to room...</p>
              <p className="text-xs text-slate-400">Looking for active meeting {roomId}</p>
            </div>
          </div>
        )}
        {joinPhase === 'not-found' && (
          <RoomNotFoundModal
            roomId={roomId}
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
      <div className="absolute top-1/3 left-1/4 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[150px] pointer-events-none -z-10 animate-pulse-subtle" />
      <div className="absolute bottom-1/3 right-1/4 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[150px] pointer-events-none -z-10 animate-pulse-subtle" />

      {/* Top Header */}
      <MeetingHeader
        roomId={roomId}
        isHost={isHost}
        isSuperAdmin={Boolean(localParticipant.isSuperAdmin)}
        isRoomLocked={isRoomLocked}
        participantsCount={remoteParticipants.length + 1}
      />

      {/* Host Knock Banner */}
      {isHost && (
        <HostKnockBanner
          knockRequests={knockRequests}
          onAdmit={handleAdmitKnock}
          onDecline={handleDeclineKnock}
        />
      )}

      {/* Connection Banner */}
      <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4 pointer-events-none">
        <ConnectionBanner status={realtimeStatus} />
      </div>

      {/* Floating Emojis Overlay */}
      {floatingEmojis.map((item) => (
        <div
          key={item.id}
          className="reaction-particle z-50 pointer-events-none"
          style={{ left: `${item.left}%`, bottom: '110px' }}
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

      {/* Participants Drawer */}
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
