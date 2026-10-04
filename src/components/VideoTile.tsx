import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, VideoOff, Crown, Hand, Maximize2, Minimize2, Pin, PinOff, Monitor } from 'lucide-react';
import { Participant } from '../lib/types';

interface VideoTileProps {
  participant: Participant;
  stream?: MediaStream | null;
  isLocal?: boolean;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  isScreenShareTile?: boolean;
}

export const VideoTile: React.FC<VideoTileProps> = ({
  participant,
  stream,
  isLocal = false,
  isPinned = false,
  onTogglePin,
  isScreenShareTile = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Attach stream to dedicated audio element for remote participants
  useEffect(() => {
    if (!isLocal && audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch((err) => {
        console.warn('Audio auto-play prevented (user gesture needed):', err);
      });
    }
  }, [stream, isLocal]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => console.error(err));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch((err) => console.error(err));
      setIsFullscreen(false);
    }
  };

  // Determine whether video should be rendered
  const hasLiveVideoTrack = Boolean(
    stream && stream.getVideoTracks().some((t) => t.readyState === 'live')
  );

  // Video is active if there is a live video track AND:
  // - it's a screen share tile OR participant is screen sharing OR participant has video enabled
  const hasActiveVideo =
    hasLiveVideoTrack &&
    (isScreenShareTile || participant.isScreenSharing || participant.isVideoEnabled);

  return (
    <div
      ref={containerRef}
      className={`relative group w-full h-full rounded-2xl overflow-hidden glass-card transition-all duration-300 border ${
        participant.isSpeaking
          ? 'border-indigo-500 shadow-lg shadow-indigo-500/20 active-speaker-ring'
          : 'border-slate-800 hover:border-slate-700/80'
      }`}
    >
      {/* Remote Audio Element (Always present for remote peers to guarantee continuous audio) */}
      {!isLocal && <audio ref={audioRef} autoPlay playsInline />}

      {/* Video Element */}
      {hasActiveVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal} // Mute local preview to prevent echo feedback
          className={`w-full h-full object-contain bg-black/40 transition-transform duration-300 ${
            isLocal && !isScreenShareTile && !participant.isScreenSharing ? '-scale-x-100 object-cover' : 'object-contain'
          }`}
        />
      ) : (
        /* Video Off Avatar Placeholder */
        <div className="w-full h-full flex flex-col items-center justify-center bg-dark-900/90 relative">
          {/* Subtle radiating background circles when speaking */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
            <div
              className={`w-48 h-48 rounded-full border border-indigo-500/30 ${
                participant.isSpeaking ? 'animate-ping' : ''
              }`}
            />
          </div>

          <div
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-gradient-to-tr ${
              participant.avatarColor || 'from-indigo-500 to-purple-600'
            } flex items-center justify-center text-3xl sm:text-4xl font-bold text-white shadow-2xl transition-transform duration-300 ${
              participant.isSpeaking
                ? 'scale-110 shadow-indigo-500/50 ring-4 ring-indigo-500/30'
                : 'scale-100'
            }`}
          >
            {participant.name ? participant.name.charAt(0).toUpperCase() : '?'}
          </div>
          <span className="mt-3 text-xs sm:text-sm font-medium text-slate-300">
            {participant.name} {isLocal && '(You)'}
          </span>
        </div>
      )}

      {/* Hand Raised Banner */}
      {participant.isHandRaised && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500 text-dark-950 font-bold text-xs shadow-lg shadow-amber-500/30 animate-bounce">
          <Hand className="w-3.5 h-3.5 fill-current" />
          <span>Hand Raised</span>
        </div>
      )}

      {/* Screen Sharing Badge */}
      {(isScreenShareTile || participant.isScreenSharing) && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600/90 text-white font-medium text-xs shadow-lg backdrop-blur-md border border-indigo-400/30">
          <Monitor className="w-3.5 h-3.5" />
          <span>{participant.name}'s Screen</span>
        </div>
      )}

      {/* Top right action buttons (on hover) */}
      <div className="absolute top-3 right-3 flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
        {onTogglePin && (
          <button
            onClick={() => onTogglePin(participant.id)}
            className="p-2 rounded-lg bg-dark-900/80 hover:bg-slate-800 text-slate-300 hover:text-white backdrop-blur-md border border-slate-700/50 transition-all cursor-pointer"
            title={isPinned ? 'Unpin' : 'Pin to main view'}
          >
            {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          onClick={toggleFullscreen}
          className="p-2 rounded-lg bg-dark-900/80 hover:bg-slate-800 text-slate-300 hover:text-white backdrop-blur-md border border-slate-700/50 transition-all cursor-pointer"
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Bottom overlay: Participant Info & Status */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between z-10 pointer-events-none">
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-dark-950/80 backdrop-blur-md border border-slate-800/80 shadow-md">
          {/* Host Crown */}
          {participant.isHost && (
            <span title="Host">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
            </span>
          )}

          {/* Name */}
          <span className="text-xs font-semibold text-white truncate max-w-[120px] sm:max-w-[180px]">
            {participant.name} {isLocal && <span className="text-indigo-400 font-normal">(You)</span>}
          </span>

          {/* Speaking Indicator */}
          {participant.isSpeaking && (
            <div className="flex items-center space-x-0.5">
              <span className="w-1 h-3 bg-indigo-400 rounded-full animate-pulse" />
              <span className="w-1 h-4 bg-indigo-400 rounded-full animate-pulse delay-75" />
              <span className="w-1 h-2 bg-indigo-400 rounded-full animate-pulse delay-150" />
            </div>
          )}
        </div>

        {/* Audio / Video Status Icons */}
        <div className="flex items-center space-x-1.5">
          {!participant.isAudioEnabled && (
            <div className="p-1.5 rounded-lg bg-rose-500/90 text-white shadow-md">
              <MicOff className="w-3.5 h-3.5" />
            </div>
          )}
          {!participant.isVideoEnabled && !isScreenShareTile && !participant.isScreenSharing && (
            <div className="p-1.5 rounded-lg bg-slate-800/90 text-slate-400 border border-slate-700/50">
              <VideoOff className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
