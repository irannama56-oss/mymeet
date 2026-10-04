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
import { Participant, ChatMessage, KnockRequest, SignalingMessage } from './lib/types';
import { sounds } from './lib/sound';

const AVATAR_COLORS = [
  'from-indigo-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
];

export const App: React.FC = () => {
  // Session & UI States
  const [inMeeting, setInMeeting] = useState(false);
  const [waitingStatus, setWaitingStatus] = useState<'none' | 'waiting' | 'declined'>('none');
  const [roomId, setRoomId] = useState('');
  const [userId] = useState(() => 'user_' + Math.random().toString(36).substring(2, 9));
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

  // Refs
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const signalingRef = useRef<SignalingService | null>(null);
  const localParticipantRef = useRef(localParticipant);
  localParticipantRef.current = localParticipant;

  // Check URL query parameters for direct room joining
  const [initialRoomParam, setInitialRoomParam] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInitialRoomParam(roomParam.toLowerCase());
    }
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
          setKnockRequests((prev) => [...prev.filter((k) => k.participantId !== msg.senderId), newKnock]);
        }
        break;

      // 2. Guest receives approval from host
      case 'join-approved':
        if (waitingStatus === 'waiting' && msg.targetId === userId) {
          setWaitingStatus('none');
          setInMeeting(true);
          sounds.playJoinChime();
          // Broadcast presence to all existing participants
          signaling.send({
            type: 'state-update',
            payload: {
              participant: localParticipantRef.current,
              isRoomLocked,
            },
          });
          // Initiate WebRTC connection to host
          webrtc.createPeerConnection(msg.senderId, true);
        }
        break;

      // 3. Guest receives rejection from host
      case 'join-declined':
        if (waitingStatus === 'waiting' && msg.targetId === userId) {
          setWaitingStatus('declined');
        }
        break;

      // 4. WebRTC Offer received
      case 'offer':
        if (msg.payload) {
          await webrtc.handleOffer(msg.senderId, msg.payload);
        }
        break;

      // 5. WebRTC Answer received
      case 'answer':
        if (msg.payload) {
          await webrtc.handleAnswer(msg.senderId, msg.payload);
        }
        break;

      // 6. ICE Candidate received
      case 'ice-candidate':
        if (msg.payload) {
          await webrtc.handleIceCandidate(msg.senderId, msg.payload);
        }
        break;

      // 7. Remote Participant State Update (Sync names, camera, mic, hand raise)
      case 'state-update':
        if (msg.payload?.participant) {
          const remoteP: Participant = msg.payload.participant;
          setRemoteParticipants((prev) => {
            const exists = prev.some((p) => p.id === remoteP.id);
            if (exists) {
              return prev.map((p) => (p.id === remoteP.id ? { ...p, ...remoteP } : p));
            } else {
              sounds.playJoinChime();
              // Create peer connection if not already created
              webrtc.createPeerConnection(remoteP.id, false);
              return [...prev, remoteP];
            }
          });

          // Sync room locked state if sent from host
          if (remoteP.isHost && msg.payload.isRoomLocked !== undefined) {
            setIsRoomLocked(msg.payload.isRoomLocked);
          }
        }
        break;

      // 8. Participant left
      case 'peer-left':
        sounds.playLeaveChime();
        setRemoteParticipants((prev) => prev.filter((p) => p.id !== msg.senderId));
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
  }, [userId, waitingStatus, isChatOpen, isRoomLocked]);

  // Trigger floating emoji animation and confetti for specific items
  const triggerFloatingEmoji = (emoji: string) => {
    if (emoji === '🎉') {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 },
      });
    }

    const newId = Math.random().toString(36).substring(2, 9);
    const left = Math.random() * 80 + 10; // Between 10% and 90%
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
    setRoomId(data.roomId);
    setIsHost(data.isHost);
    setIsRoomLocked(data.requireHostApproval);

    const updatedLocal: Participant = {
      ...localParticipant,
      name: data.name,
      isHost: data.isHost,
      isAudioEnabled: data.audioEnabled,
      isVideoEnabled: data.videoEnabled,
    };
    setLocalParticipant(updatedLocal);

    // Setup Signaling Channel
    const signaling = new SignalingService(data.roomId, userId);
    signalingRef.current = signaling;
    signaling.connect(handleSignalingMessage);

    // Setup WebRTC Manager
    const webrtc = new WebRTCManager(signaling, userId, handleRemoteStreamUpdate);
    webrtcRef.current = webrtc;

    // Detect speaking levels
    webrtc.setAudioLevelCallback((level) => {
      const isSpeaking = level > 25 && updatedLocal.isAudioEnabled;
      setLocalParticipant((prev) => {
        if (prev.isSpeaking !== isSpeaking) {
          const next = { ...prev, isSpeaking, audioLevel: level };
          // Broadcast speaking state if changed
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

    // If host, enter room immediately and notify
    if (data.isHost) {
      setInMeeting(true);
      sounds.playJoinChime();
      signaling.send({
        type: 'state-update',
        payload: {
          participant: updatedLocal,
          isRoomLocked: data.requireHostApproval,
        },
      });
    } else {
      // If guest, send join request (knock) and wait for host if room is locked
      if (data.requireHostApproval) {
        setWaitingStatus('waiting');
        signaling.send({
          type: 'join-request',
          senderName: data.name,
          payload: { avatarColor },
        });
      } else {
        // Direct join
        setInMeeting(true);
        sounds.playJoinChime();
        signaling.send({
          type: 'state-update',
          payload: {
            participant: updatedLocal,
            isRoomLocked: false,
          },
        });
      }
    }
  };

  // Broadcast state changes whenever audio, video, hand raise toggles
  const broadcastMyState = (updatedParticipant: Participant) => {
    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'state-update',
        payload: {
          participant: updatedParticipant,
          isRoomLocked,
        },
      });
    }
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

        stream.getVideoTracks()[0].onended = () => {
          setScreenStream(null);
          const reverted = { ...localParticipant, isScreenSharing: false };
          setLocalParticipant(reverted);
          setScreenSharingParticipantId(null);
          broadcastMyState(reverted);
        };
      } catch (e) {
        console.error('Screen sharing error:', e);
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
    setWaitingStatus('none');
    setPinnedParticipantId(null);
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
      {/* Background radial glows */}
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
