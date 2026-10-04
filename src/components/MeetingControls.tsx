import React, { useState } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, 
  Hand, MessageSquare, Users, PhoneOff, Smile, Settings, 
  ChevronUp, Shield, Lock, Unlock 
} from 'lucide-react';
import { sounds } from '../lib/sound';

interface MeetingControlsProps {
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isHandRaised: boolean;
  isChatOpen: boolean;
  isParticipantsOpen: boolean;
  unreadChatCount: number;
  pendingKnocksCount: number;
  participantsCount: number;
  isHost: boolean;
  isRoomLocked: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleHandRaise: () => void;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onSendReaction: (emoji: string) => void;
  onOpenSettings: () => void;
  onLeaveMeeting: () => void;
  onToggleRoomLock?: () => void;
}

const EMOJIS = ['🎉', '❤️', '👏', '😂', '🔥', '🚀', '👍', '💡'];

export const MeetingControls: React.FC<MeetingControlsProps> = ({
  isAudioEnabled,
  isVideoEnabled,
  isScreenSharing,
  isHandRaised,
  isChatOpen,
  isParticipantsOpen,
  unreadChatCount,
  pendingKnocksCount,
  participantsCount,
  isHost,
  isRoomLocked,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onToggleHandRaise,
  onToggleChat,
  onToggleParticipants,
  onSendReaction,
  onOpenSettings,
  onLeaveMeeting,
  onToggleRoomLock,
}) => {
  const [showReactions, setShowReactions] = useState(false);

  const handleReactionClick = (emoji: string) => {
    sounds.playClick();
    onSendReaction(emoji);
    setShowReactions(false);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 sm:gap-3 px-4 py-3 rounded-2xl glass-dock shadow-2xl border border-slate-700/60 max-w-[95vw] overflow-x-auto">
      
      {/* 1. Mic Button */}
      <button
        onClick={() => {
          sounds.playClick();
          onToggleAudio();
        }}
        className={`relative p-3.5 rounded-xl font-medium transition-all ${
          isAudioEnabled
            ? 'bg-slate-800/80 hover:bg-slate-700 text-white border border-slate-700/60'
            : 'bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/25'
        }`}
        title={isAudioEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
      >
        {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      </button>

      {/* 2. Video Button */}
      <button
        onClick={() => {
          sounds.playClick();
          onToggleVideo();
        }}
        className={`relative p-3.5 rounded-xl font-medium transition-all ${
          isVideoEnabled
            ? 'bg-slate-800/80 hover:bg-slate-700 text-white border border-slate-700/60'
            : 'bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/25'
        }`}
        title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
      >
        {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
      </button>

      {/* 3. Screen Share Button */}
      <button
        onClick={() => {
          sounds.playClick();
          onToggleScreenShare();
        }}
        className={`p-3.5 rounded-xl font-medium transition-all ${
          isScreenSharing
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
            : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60'
        }`}
        title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen'}
      >
        {isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
      </button>

      <div className="h-7 w-[1px] bg-slate-800 mx-1 hidden sm:block" />

      {/* 4. Hand Raise Button */}
      <button
        onClick={() => {
          sounds.playHandRaise();
          onToggleHandRaise();
        }}
        className={`p-3.5 rounded-xl font-medium transition-all ${
          isHandRaised
            ? 'bg-amber-500 text-dark-950 font-bold shadow-lg shadow-amber-500/30 scale-105'
            : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60'
        }`}
        title={isHandRaised ? 'Lower Hand' : 'Raise Hand'}
      >
        <Hand className="w-5 h-5" />
      </button>

      {/* 5. Reactions Picker */}
      <div className="relative">
        <button
          onClick={() => setShowReactions(!showReactions)}
          className={`p-3.5 rounded-xl font-medium transition-all ${
            showReactions
              ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50'
              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60'
          }`}
          title="Send Reaction"
        >
          <Smile className="w-5 h-5" />
        </button>

        {showReactions && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 p-2 rounded-2xl glass-panel border border-slate-700/80 shadow-2xl flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReactionClick(emoji)}
                className="w-10 h-10 flex items-center justify-center text-xl hover:scale-125 hover:bg-white/10 rounded-xl transition-all"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 6. Host Room Lock Quick Button (if Host) */}
      {isHost && onToggleRoomLock && (
        <button
          onClick={() => {
            sounds.playClick();
            onToggleRoomLock();
          }}
          className={`p-3.5 rounded-xl font-medium transition-all ${
            isRoomLocked
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60'
          }`}
          title={isRoomLocked ? 'Room Locked (Guests must knock)' : 'Room Open (Anyone with link can join)'}
        >
          {isRoomLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
        </button>
      )}

      {/* 7. Chat Toggle Button */}
      <button
        onClick={() => {
          sounds.playClick();
          onToggleChat();
        }}
        className={`relative p-3.5 rounded-xl font-medium transition-all ${
          isChatOpen
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
            : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60'
        }`}
        title="Toggle Chat"
      >
        <MessageSquare className="w-5 h-5" />
        {unreadChatCount > 0 && !isChatOpen && (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.5 min-w-[18px] text-[10px] font-bold bg-indigo-500 text-white rounded-full flex items-center justify-center animate-bounce">
            {unreadChatCount}
          </span>
        )}
      </button>

      {/* 8. Participants Drawer Toggle Button */}
      <button
        onClick={() => {
          sounds.playClick();
          onToggleParticipants();
        }}
        className={`relative p-3.5 rounded-xl font-medium transition-all ${
          isParticipantsOpen
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
            : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60'
        }`}
        title="View Participants"
      >
        <Users className="w-5 h-5" />
        {pendingKnocksCount > 0 ? (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.5 min-w-[18px] text-[10px] font-bold bg-amber-500 text-dark-950 rounded-full flex items-center justify-center animate-pulse">
            {pendingKnocksCount}
          </span>
        ) : (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] font-semibold bg-slate-700 text-slate-300 rounded-full">
            {participantsCount}
          </span>
        )}
      </button>

      {/* 9. Settings Button */}
      <button
        onClick={() => {
          sounds.playClick();
          onOpenSettings();
        }}
        className="p-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition-all"
        title="Audio & Video Settings"
      >
        <Settings className="w-5 h-5" />
      </button>

      <div className="h-7 w-[1px] bg-slate-800 mx-1 hidden sm:block" />

      {/* 10. Leave Meeting Button */}
      <button
        onClick={() => {
          sounds.playLeaveChime();
          onLeaveMeeting();
        }}
        className="px-4 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all active:scale-95"
        title="Leave Meeting"
      >
        <PhoneOff className="w-5 h-5" />
        <span className="text-xs hidden md:inline">Leave</span>
      </button>
    </div>
  );
};
