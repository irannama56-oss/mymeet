import React, { useEffect, useRef, useState } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, 
  Hand, MessageSquare, Users, PhoneOff, Smile, Settings, 
  Lock, Unlock, Sparkles, Monitor, ChevronUp
} from 'lucide-react';
import { sounds } from '../lib/sound';
import { ScreenSharePreset } from '../lib/types';

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
  isNoiseCancellationEnabled?: boolean;
  screenSharePreset?: ScreenSharePreset;
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
  onToggleNoiseCancellation?: () => void;
  onSelectScreenSharePreset?: (preset: ScreenSharePreset) => void;
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
  isNoiseCancellationEnabled = true,
  screenSharePreset = 'low',
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
  onToggleNoiseCancellation,
  onSelectScreenSharePreset,
}) => {
  const [showReactions, setShowReactions] = useState(false);
  const [showScreenPresetMenu, setShowScreenPresetMenu] = useState(false);
  const reactionsRef = useRef<HTMLDivElement>(null);
  const screenMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (reactionsRef.current && !reactionsRef.current.contains(e.target as Node)) {
        setShowReactions(false);
      }
      if (screenMenuRef.current && !screenMenuRef.current.contains(e.target as Node)) {
        setShowScreenPresetMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowReactions(false);
        setShowScreenPresetMenu(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleReactionClick = (emoji: string) => {
    sounds.playClick();
    onSendReaction(emoji);
    setShowReactions(false);
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center justify-center max-w-[98vw] select-none">
      <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-2.5 sm:px-4 sm:py-3 rounded-3xl glass-dock shadow-2xl border border-slate-700/60 flex-wrap sm:flex-nowrap justify-center">
        
        {/* 1. Mic Button */}
        <div className="has-tooltip relative flex items-center">
          <button
            onClick={() => {
              sounds.playClick();
              onToggleAudio();
            }}
            className={`relative p-3.5 rounded-2xl font-medium transition-all duration-200 cursor-pointer ${
              isAudioEnabled
                ? 'bg-slate-800/80 hover:bg-slate-700/90 text-white border border-slate-700/60 shadow-md'
                : 'bg-rose-500 hover:bg-rose-600 text-white shadow-xl shadow-rose-500/25'
            }`}
            aria-label={isAudioEnabled ? 'Mute Mic (M)' : 'Unmute Mic (M)'}
          >
            {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
          <span className="tooltip">{isAudioEnabled ? 'Mute (M)' : 'Unmute (M)'}</span>
        </div>

        {/* 1.5 AI Noise Cancellation Toggle right next to Mic */}
        {onToggleNoiseCancellation && (
          <div className="has-tooltip relative flex items-center">
            <button
              onClick={() => {
                sounds.playClick();
                onToggleNoiseCancellation();
              }}
              className={`relative px-3 py-3.5 rounded-2xl font-semibold text-xs transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                isNoiseCancellationEnabled
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50 shadow-md'
                  : 'bg-slate-800/80 hover:bg-slate-700/90 text-slate-400 border border-slate-700/60'
              }`}
              aria-label={isNoiseCancellationEnabled ? 'AI Noise Cancellation: Active' : 'AI Noise Cancellation: Off'}
            >
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-[11px] hidden md:inline font-bold">
                {isNoiseCancellationEnabled ? 'NC ON' : 'NC OFF'}
              </span>
            </button>
            <span className="tooltip">
              {isNoiseCancellationEnabled ? 'Noise Cancellation: Active' : 'Noise Cancellation: Off'}
            </span>
          </div>
        )}

        {/* 2. Video Button */}
        <div className="has-tooltip relative flex items-center">
          <button
            onClick={() => {
              sounds.playClick();
              onToggleVideo();
            }}
            className={`relative p-3.5 rounded-2xl font-medium transition-all duration-200 cursor-pointer ${
              isVideoEnabled
                ? 'bg-slate-800/80 hover:bg-slate-700/90 text-white border border-slate-700/60 shadow-md'
                : 'bg-rose-500 hover:bg-rose-600 text-white shadow-xl shadow-rose-500/25'
            }`}
            aria-label={isVideoEnabled ? 'Stop Video (V)' : 'Start Video (V)'}
          >
            {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>
          <span className="tooltip">{isVideoEnabled ? 'Stop Video (V)' : 'Start Video (V)'}</span>
        </div>

        {/* 3. Screen Share & Quality Preset Control */}
        <div className="relative flex items-center" ref={screenMenuRef}>
          <div className="has-tooltip relative flex items-center">
            <button
              onClick={() => {
                sounds.playClick();
                onToggleScreenShare();
              }}
              className={`p-3.5 rounded-l-2xl font-medium transition-all duration-200 cursor-pointer ${
                isScreenSharing
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 border border-slate-700/60'
              }`}
              aria-label={isScreenSharing ? 'Stop Presenting' : 'Share Screen'}
            >
              {isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
            </button>
            <span className="tooltip">{isScreenSharing ? 'Stop Presenting' : 'Share Screen'}</span>
          </div>

          <div className="has-tooltip relative flex items-center">
            <button
              onClick={() => setShowScreenPresetMenu(!showScreenPresetMenu)}
              className={`px-2 py-3.5 rounded-r-2xl border-l border-slate-700/50 font-mono text-[10px] font-bold transition-all cursor-pointer ${
                isScreenSharing
                  ? 'bg-indigo-700 text-white'
                  : 'bg-slate-800/80 hover:bg-slate-700/90 text-indigo-300 border border-slate-700/60'
              }`}
              title="Screen Share Quality & Data Usage"
            >
              <span className="uppercase">{screenSharePreset}</span>
              <ChevronUp className="w-3 h-3 inline ml-0.5" />
            </button>
            <span className="tooltip">Screen Quality ({screenSharePreset.toUpperCase()})</span>
          </div>

          {/* Screen Quality Quick Menu */}
          {showScreenPresetMenu && (
            <div className="absolute bottom-16 left-0 p-2 rounded-2xl glass-dock border border-slate-700/80 shadow-2xl flex flex-col gap-1 w-52 z-50 animate-in fade-in zoom-in-95 duration-150">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2.5 py-1 border-b border-slate-800">
                Screen Quality
              </p>
              {[
                { id: 'low', label: 'Low Data', sub: '720p 15fps (~200MB/h)' },
                { id: 'balanced', label: 'Balanced', sub: '720p 30fps (~500MB/h)' },
                { id: 'high', label: 'High Quality', sub: '1080p 30fps (~1.2GB/h)' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    sounds.playClick();
                    onSelectScreenSharePreset?.(item.id as any);
                    setShowScreenPresetMenu(false);
                  }}
                  className={`px-3 py-2 rounded-xl text-left transition-all cursor-pointer flex flex-col ${
                    screenSharePreset === item.id
                      ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 font-bold'
                      : 'hover:bg-slate-800/80 text-slate-300'
                  }`}
                >
                  <span className="text-xs">{item.label}</span>
                  <span className="text-[10px] text-slate-400 font-mono">{item.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-7 w-[1px] bg-slate-800/90 mx-0.5 hidden sm:block" />

      {/* 4. Hand Raise Button */}
      <div className="has-tooltip relative flex items-center">
        <button
          onClick={() => {
            sounds.playHandRaise();
            onToggleHandRaise();
          }}
          className={`p-3.5 rounded-2xl font-medium transition-all duration-200 cursor-pointer ${
            isHandRaised
              ? 'bg-amber-500 text-dark-950 font-bold shadow-lg shadow-amber-500/30 scale-105'
              : 'bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 border border-slate-700/60'
          }`}
          aria-label={isHandRaised ? 'Lower Hand (H)' : 'Raise Hand (H)'}
        >
          <Hand className="w-5 h-5" />
        </button>
        <span className="tooltip">{isHandRaised ? 'Lower Hand (H)' : 'Raise Hand (H)'}</span>
      </div>

      {/* 5. Reactions Picker */}
      <div className="relative" ref={reactionsRef}>
        <div className="has-tooltip relative flex items-center">
          <button
            onClick={() => setShowReactions(!showReactions)}
            className={`p-3.5 rounded-2xl font-medium transition-all duration-200 cursor-pointer ${
              showReactions
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50 shadow-md'
                : 'bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 border border-slate-700/60'
            }`}
            aria-label="Send Reaction"
          >
            <Smile className="w-5 h-5" />
          </button>
          {!showReactions && <span className="tooltip">Reactions</span>}
        </div>

        {showReactions && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 p-2 rounded-2xl glass-dock border border-slate-700/80 shadow-2xl flex items-center gap-1 animate-in fade-in zoom-in-95 duration-150 max-w-[92vw] overflow-x-auto">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReactionClick(emoji)}
                className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-xl hover:scale-125 hover:bg-white/10 rounded-xl transition-all cursor-pointer shrink-0"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 6. Host Room Lock Quick Button */}
      {isHost && onToggleRoomLock && (
        <div className="has-tooltip relative flex items-center">
          <button
            onClick={() => {
              sounds.playClick();
              onToggleRoomLock();
            }}
            className={`p-3.5 rounded-2xl font-medium transition-all duration-200 cursor-pointer ${
              isRoomLocked
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-md'
                : 'bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 border border-slate-700/60'
            }`}
            aria-label={isRoomLocked ? 'Unlock Room' : 'Lock Room'}
          >
            {isRoomLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
          </button>
          <span className="tooltip">{isRoomLocked ? 'Unlock Room' : 'Lock Room'}</span>
        </div>
      )}

      {/* 7. Chat Toggle Button */}
      <div className="has-tooltip relative flex items-center">
        <button
          onClick={() => {
            sounds.playClick();
            onToggleChat();
          }}
          className={`relative p-3.5 rounded-2xl font-medium transition-all duration-200 cursor-pointer ${
            isChatOpen
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 border border-slate-700/60'
          }`}
          aria-label="Toggle In-Call Chat (C)"
        >
          <MessageSquare className="w-5 h-5" />
          {unreadChatCount > 0 && !isChatOpen && (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.5 min-w-[18px] text-[10px] font-bold bg-indigo-500 text-white rounded-full flex items-center justify-center animate-bounce shadow-md">
              {unreadChatCount}
            </span>
          )}
        </button>
        <span className="tooltip">Chat (C)</span>
      </div>

      {/* 8. Participants Drawer Toggle Button */}
      <div className="has-tooltip relative flex items-center">
        <button
          onClick={() => {
            sounds.playClick();
            onToggleParticipants();
          }}
          className={`relative p-3.5 rounded-2xl font-medium transition-all duration-200 cursor-pointer ${
            isParticipantsOpen
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 border border-slate-700/60'
          }`}
          aria-label="View Participants (P)"
        >
          <Users className="w-5 h-5" />
          {pendingKnocksCount > 0 ? (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.5 min-w-[18px] text-[10px] font-bold bg-amber-500 text-dark-950 rounded-full flex items-center justify-center animate-pulse shadow-md">
              {pendingKnocksCount}
            </span>
          ) : (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] font-semibold bg-slate-700 text-slate-200 rounded-full shadow-sm">
              {participantsCount}
            </span>
          )}
        </button>
        <span className="tooltip">People (P)</span>
      </div>

      {/* 9. Settings Button */}
      <div className="has-tooltip relative flex items-center">
        <button
          onClick={() => {
            sounds.playClick();
            onOpenSettings();
          }}
          className="p-3.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 border border-slate-700/60 transition-all duration-200 cursor-pointer"
          aria-label="Device & Audio Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
        <span className="tooltip">Settings</span>
      </div>

      <div className="h-7 w-[1px] bg-slate-800/90 mx-1 hidden sm:block" />

      {/* 10. Leave Meeting Button */}
      <div className="has-tooltip relative flex items-center">
        <button
          onClick={() => {
            sounds.playLeaveChime();
            onLeaveMeeting();
          }}
          className="px-4 py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all active:scale-95 cursor-pointer"
          aria-label="Leave Meeting"
        >
          <PhoneOff className="w-5 h-5" />
          <span className="text-xs font-semibold hidden md:inline">Leave</span>
        </button>
        <span className="tooltip">Leave Call</span>
      </div>
    </div>
  </div>
);
};
