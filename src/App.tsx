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
import { SignalingService } from './lib/supabase';
import { Participant, ChatMessage, KnockRequest, SignalingMessage, cleanRoomCode } from './lib/types';
import { sounds } from './lib/sound';

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
  if (pathname && !pathname.includes('.') && pathname !== 'index.html') {
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

  // Refs for access in callbacks
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const signalingRef = useRef<SignalingService | null>(null);
  const localParticipantRef = useRef(localParticipant);
  localParticipantRef.current = localParticipant;
  const isRoomLockedRef = useRef(isRoomLocked);
  isRoomLockedRef.current = isRoomLocked;
  const inMeetingRef = useRef(inMeeting);
  inMeetingRef.current = inMeeting;

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

  // Handle incoming signaling messages
  const handleSignalingMessage = useCallback(async (msg: SignalingMessage) => {
    const webrtc = webrtcRef.current;
    const signaling = signalingRef.current;
    if (!webrtc || !signaling) return;

    switch (msg.type) {
      // 1. Host receives join request / knock
      case 'join-request':
        if (localParticipantRef.current.isHost) {
          sounds.playKnockAlert();
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
          setWaitingStatus('none');
          setInMeeting(true);
          inMeetingRef.current = true;
          sounds.playJoinChime();
          // Broadcast presence to all participants
          signaling.send({
            type: 'state-update',
            payload: {
              participant: localParticipantRef.current,
              isRoomLocked: isRoomLockedRef.current,
            },
          });
          connectPeer(msg.senderId);
        }
        break;

      // 3. Guest receives rejection from host
      case 'join-declined':
        if (msg.targetId === userId) {
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
        if (msg.payload?.participant) {
          const remoteP: Participant = msg.payload.participant;

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

          // Add or update participant in list
          setRemoteParticipants((prev) => {
            const exists = prev.some((p) => p.id === remoteP.id);
            if (exists) {
              return prev.map((p) => (p.id === remoteP.id ? { ...p, ...remoteP } : p));
            } else {
              sounds.playJoinChime();
              return [...prev, remoteP];
            }
          });

          // Connect WebRTC peer connection immediately
          connectPeer(remoteP.id);

          // Sync room locked state if sent from host
          if (remoteP.isHost && msg.payload.isRoomLocked !== undefined) {
            setIsRoomLocked(msg.payload.isRoomLocked);
          }

          // If newcomer announced (un-targeted broadcast), reply with our presence immediately!
          if (!msg.targetId && msg.senderId !== userId) {
            signaling.send({
              type: 'state-update',
              targetId: msg.senderId,
              payload: {
                participant: localParticipantRef.current,
                isRoomLocked: isRoomLockedRef.current,
              },
            });
          }
        }
        break;

      // 8. Participant left
      case 'peer-left':
        sounds.playLeaveChime();
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
          setChatMessages((prev) => [...prev, newChat]);
          if (!isChatOpen) {
            setUnreadChatCount((prev) => prev + 1);
          }
        }
        break;

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
          alert('You have been removed from the meeting by the host.');
          handleLeaveMeeting();
        }
        break;

      default:
        break;
    }
  }, [userId, screenSharingParticipantId, isChatOpen, connectPeer, broadcastMyState]);

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

    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((item) => item.id !== newId));
    }, 2000);
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

    setRoomId(cleanId);
    setIsHost(data.isHost);
    setIsRoomLocked(data.requireHostApproval);

    // Update browser URL to Google Meet path format: /abc-defg-hij
    if (typeof window !== 'undefined' && window.location.pathname !== `/${cleanId}`) {
      window.history.pushState({}, '', `/${cleanId}`);
    }

    const updatedLocal: Participant = {
      ...localParticipant,
      name: data.name,
      isHost: data.isHost,
      isAudioEnabled: data.audioEnabled,
      isVideoEnabled: data.videoEnabled,
    };
    setLocalParticipant(updatedLocal);
    localParticipantRef.current = updatedLocal;

    // Setup Signaling Channel
    const signaling = new SignalingService(cleanId, userId);
    signalingRef.current = signaling;
    signaling.connect(handleSignalingMessage);

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
      const isSpeaking = level > 25 && updatedLocal.isAudioEnabled;
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

    // Acquire camera and mic stream
    try {
      const stream = await webrtc.getLocalMedia(data.audioEnabled, data.videoEnabled);
      setLocalStream(stream);
    } catch (err) {
      console.warn('Could not acquire media stream:', err);
    }

    // Enter meeting immediately!
    setInMeeting(true);
    inMeetingRef.current = true;
    sounds.playJoinChime();

    // Broadcast presence immediately to all participants in this room
    signaling.send({
      type: 'state-update',
      payload: {
        participant: updatedLocal,
        isRoomLocked: data.requireHostApproval,
      },
    });

    // Send a second announcement after 400ms to guarantee sync with any opening tabs
    setTimeout(() => {
      if (inMeetingRef.current && signalingRef.current) {
        signalingRef.current.send({
          type: 'state-update',
          payload: {
            participant: localParticipantRef.current,
            isRoomLocked: isRoomLockedRef.current,
          },
        });
      }
    }, 400);
  };

  // Toggle Audio
  const handleToggleAudio = () => {
    const nextState = !localParticipant.isAudioEnabled;
    if (webrtcRef.current) {
      webrtcRef.current.toggleAudio(nextState);
    }
    const updated = { ...localParticipant, isAudioEnabled: nextState };
    setLocalParticipant(updated);
    broadcastMyState(updated);
  };

  // Toggle Video
  const handleToggleVideo = () => {
    const nextState = !localParticipant.isVideoEnabled;
    if (webrtcRef.current) {
      webrtcRef.current.toggleVideo(nextState);
    }
    const updated = { ...localParticipant, isVideoEnabled: nextState };
    setLocalParticipant(updated);
    broadcastMyState(updated);
  };

  // Toggle Screen Share
  const handleToggleScreenShare = async () => {
    if (!webrtcRef.current) return;

    if (localParticipant.isScreenSharing) {
      webrtcRef.current.stopScreenShare();
      setScreenStream(null);
      const updated = { ...localParticipant, isScreenSharing: false };
      setLocalParticipant(updated);
      setScreenSharingParticipantId(null);
      broadcastMyState(updated);
    } else {
      try {
        const stream = await webrtcRef.current.startScreenShare();
        setScreenStream(stream);
        const updated = { ...localParticipant, isScreenSharing: true };
        setLocalParticipant(updated);
        setScreenSharingParticipantId(userId);
        broadcastMyState(updated);
      } catch (e) {
        console.error('Screen sharing start error:', e);
      }
    }
  };

  // Toggle Hand Raise
  const handleToggleHandRaise = () => {
    const nextState = !localParticipant.isHandRaised;
    const updated = { ...localParticipant, isHandRaised: nextState };
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
    const nextState = !isRoomLocked;
    setIsRoomLocked(nextState);
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

    setLocalStream(null);
    setScreenStream(null);
    setRemoteStreams(new Map());
    setRemoteParticipants([]);
    setChatMessages([]);
    setKnockRequests([]);
    setInMeeting(false);
    inMeetingRef.current = false;
    setWaitingStatus('none');
    setPinnedParticipantId(null);
    setScreenSharingParticipantId(null);
  };

  // Change Device Input
  const handleDeviceChange = async (audioId: string, videoId: string) => {
    if (webrtcRef.current) {
      const stream = await webrtcRef.current.getLocalMedia(
        localParticipant.isAudioEnabled,
        localParticipant.isVideoEnabled,
        audioId,
        videoId
      );
      setLocalStream(stream);
    }
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
    return <Lobby onJoin={handleJoinFromLobby} initialRoomId={initialRoomParam} />;
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
          setIsChatOpen(!isChatOpen);
          if (!isChatOpen) setUnreadChatCount(0);
        }}
        onToggleParticipants={() => setIsParticipantsOpen(!isParticipantsOpen)}
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
