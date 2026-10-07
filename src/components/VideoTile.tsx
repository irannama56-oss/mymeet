import React, { useCallback, useEffect, useRef, useState } from 'react';
import { 
  MicOff, VideoOff, Crown, Hand, Maximize2, Minimize2, 
  Pin, PinOff, Monitor, PictureInPicture, Shield
} from 'lucide-react';
import { Participant } from '../lib/types';

interface VideoTileProps {
  participant: Participant;
  stream?: MediaStream | null;
  isLocal?: boolean;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  isScreenShareTile?: boolean;
  disableAudio?: boolean;
}

export const VideoTile: React.FC<VideoTileProps> = ({
  participant,
  stream,
  isLocal = false,
  isPinned = false,
  onTogglePin,
  isScreenShareTile = false,
  disableAudio = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [trackCount, setTrackCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Monitor stream tracks dynamically
  useEffect(() => {
    if (!stream) return;
    const updateTracks = () => setTrackCount(stream.getTracks().length);
    updateTracks();
    stream.addEventListener('addtrack', updateTracks);
    stream.addEventListener('removetrack', updateTracks);
    return () => {
      stream.removeEventListener('addtrack', updateTracks);
      stream.removeEventListener('removetrack', updateTracks);
    };
  }, [stream]);

  const hasLiveVideoTrack = Boolean(
    stream && stream.getVideoTracks().some((t) => t.readyState === 'live')
  );

  const hasActiveVideo =
    hasLiveVideoTrack &&
    (isScreenShareTile || participant.isScreenSharing || participant.isVideoEnabled);

  // Keep video srcObject in sync
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [stream, hasActiveVideo, trackCount]);

  // Keep audio srcObject in sync
  useEffect(() => {
    const el = audioRef.current;
    if (!el || isLocal || disableAudio) return;
    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [stream, isLocal, disableAudio, trackCount]);

  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (el && stream) {
        el.srcObject = stream;
        el.play().catch(() => {});
      }
    },
    [stream]
  );

  const attachAudio = useCallback(
    (el: HTMLAudioElement | null) => {
      audioRef.current = el;
      if (el && stream) {
        el.srcObject = stream;
      }
    },
    [stream]
  );

  // Remote audio playback management with user gesture fallback
  useEffect(() => {
    if (isLocal || disableAudio || !stream) return;
    const el = audioRef.current;
    if (!el) return;

    let cancelled = false;

    const playAudio = () => {
      if (cancelled || !el) return;
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (cancelled) return;
          const resume = () => {
            el.play().catch(() => {});
          };
          document.addEventListener('click', resume, { once: true });
          document.addEventListener('keydown', resume, { once: true });
        });
      }
    };

    playAudio();

    return () => {
      cancelled = true;
    };
  }, [stream, isLocal, disableAudio]);

  // Fullscreen state listener
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch((err) => console.error('Fullscreen error:', err));
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch((err) => console.error('Exit fullscreen error:', err));
    }
  };

  const togglePictureInPicture = async () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    try {
      if (document.pictureInPictureElement === videoEl) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
      } else if (document.pictureInPictureEnabled) {
        await videoEl.requestPictureInPicture();
        setIsPipActive(true);
      }
    } catch (err) {
      console.warn('Picture in Picture error:', err);
    }
  };

  const isSuperAdminUser = Boolean(participant.isSuperAdmin || participant.role === 'superadmin');

  return (
    <div
      ref={containerRef}
      className={`relative group w-full h-full rounded-3xl overflow-hidden glass-card transition-all duration-300 border ${
        participant.isSpeaking
          ? isSuperAdminUser
            ? 'ring-4 ring-amber-500/80 border-amber-400'
            : 'active-speaker-ring'
          : isSuperAdminUser
          ? 'border-amber-500/50 shadow-lg shadow-amber-500/10'
          : 'border-slate-800/90 hover:border-slate-700'
      }`}
    >
      {/* Remote Audio Element */}
      {!isLocal && !disableAudio && (
        <audio 
          ref={attachAudio} 
          autoPlay 
          playsInline 
          onLoadedMetadata={(e) => e.currentTarget.play().catch(() => {})} 
        />
      )}

      {/* Video Element */}
      {hasActiveVideo ? (
        <video
          ref={attachVideo}
          autoPlay
          playsInline
          muted={isLocal}
          onLoadedMetadata={(e) => e.currentTarget.play().catch(() => {})}
          className={`w-full h-full object-contain bg-black/50 transition-all duration-300 ${
            isLocal && !isScreenShareTile && !participant.isScreenSharing
              ? '-scale-x-100 object-cover'
              : 'object-contain'
          }`}
        />
      ) : (
        /* Video Off Avatar Placeholder */
        <div className="w-full h-full flex flex-col items-center justify-center bg-dark-900/90 relative p-4 select-none">
          {participant.isSpeaking && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className={`w-48 h-48 rounded-full border animate-ping opacity-30 ${isSuperAdminUser ? 'border-amber-500/50' : 'border-indigo-500/30'}`} />
            </div>
          )}

          <div
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-gradient-to-tr ${
              isSuperAdminUser
                ? 'from-amber-500 via-orange-600 to-indigo-700'
                : participant.avatarColor || 'from-indigo-500 to-purple-600'
            } flex items-center justify-center text-3xl sm:text-4xl font-bold text-white shadow-2xl transition-all duration-300 border ${
              isSuperAdminUser ? 'border-amber-300/40 shadow-amber-500/30' : 'border-white/10'
            } ${
              participant.isSpeaking
                ? 'scale-110 ring-4 ring-indigo-500/40'
                : 'scale-100'
            }`}
          >
            {participant.name ? participant.name.charAt(0).toUpperCase() : '?'}
          </div>
          <span className="mt-3 text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            {isSuperAdminUser && <Crown className="w-3.5 h-3.5 text-amber-400" />}
            <span>{participant.name} {isLocal && '(You)'}</span>
          </span>
        </div>
      )}

      {/* Hand Raised Banner */}
      {participant.isHandRaised && (
        <div className="absolute top-3.5 left-3.5 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500 text-dark-950 font-bold text-xs shadow-xl shadow-amber-500/30 animate-bounce">
          <Hand className="w-3.5 h-3.5 fill-current" />
          <span>Hand Raised</span>
        </div>
      )}

      {/* Screen Sharing Badge */}
      {(isScreenShareTile || participant.isScreenSharing) && (
        <div className="absolute top-3.5 left-3.5 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600/95 text-white font-medium text-xs shadow-xl backdrop-blur-md border border-indigo-400/30">
          <Monitor className="w-3.5 h-3.5" />
          <span>{participant.name}'s Screen</span>
        </div>
      )}

      {/* Top right action buttons overlay */}
      <div className="absolute top-3 right-3 flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
        {hasActiveVideo && typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
          <button
            onClick={togglePictureInPicture}
            className="p-2 rounded-xl bg-dark-950/80 hover:bg-slate-800 text-slate-300 hover:text-white backdrop-blur-md border border-slate-700/60 transition-all cursor-pointer shadow-md"
            title="Picture in Picture"
          >
            <PictureInPicture className="w-3.5 h-3.5" />
          </button>
        )}
        {onTogglePin && (
          <button
            onClick={() => onTogglePin(participant.id)}
            className="p-2 rounded-xl bg-dark-950/80 hover:bg-slate-800 text-slate-300 hover:text-white backdrop-blur-md border border-slate-700/60 transition-all cursor-pointer shadow-md"
            title={isPinned ? 'Unpin' : 'Pin tile'}
          >
            {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          onClick={toggleFullscreen}
          className="p-2 rounded-xl bg-dark-950/80 hover:bg-slate-800 text-slate-300 hover:text-white backdrop-blur-md border border-slate-700/60 transition-all cursor-pointer shadow-md"
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Bottom overlay: Participant Name & Audio status */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between z-10 pointer-events-none">
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-dark-950/85 backdrop-blur-md border border-slate-800/90 shadow-lg">
          {isSuperAdminUser ? (
            <span className="flex items-center gap-1 text-amber-400 font-bold text-[10px] uppercase tracking-wider" title="Super Administrator">
              <Crown className="w-3.5 h-3.5 fill-current" />
              <span className="hidden sm:inline">Admin</span>
            </span>
          ) : participant.isHost ? (
            <span title="Meeting Host">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
            </span>
          ) : null}

          <span className="text-xs font-semibold text-white truncate max-w-[120px] sm:max-w-[180px]">
            {participant.name} {isLocal && <span className="text-indigo-400 font-normal">(You)</span>}
          </span>

          {participant.isSpeaking && (
            <div className="flex items-end gap-0.5 h-3.5">
              <span className={`w-0.5 rounded-full animate-pulse h-2 ${isSuperAdminUser ? 'bg-amber-400' : 'bg-indigo-400'}`} />
              <span className={`w-0.5 rounded-full animate-pulse h-3.5 delay-75 ${isSuperAdminUser ? 'bg-amber-400' : 'bg-indigo-400'}`} />
              <span className={`w-0.5 rounded-full animate-pulse h-2 delay-150 ${isSuperAdminUser ? 'bg-amber-400' : 'bg-indigo-400'}`} />
            </div>
          )}
        </div>

        {/* Muted Audio & Video indicator */}
        <div className="flex items-center space-x-1.5">
          {!participant.isAudioEnabled && (
            <div className="p-1.5 rounded-xl bg-rose-500/90 text-white shadow-md">
              <MicOff className="w-3.5 h-3.5" />
            </div>
          )}
          {!participant.isVideoEnabled && !isScreenShareTile && !participant.isScreenSharing && (
            <div className="p-1.5 rounded-xl bg-slate-800/90 text-slate-400 border border-slate-700/50 shadow-md">
              <VideoOff className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
