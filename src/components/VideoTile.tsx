import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  MicOff, VideoOff, Crown, Hand, Maximize2, Minimize2,
  Pin, PinOff, Monitor, PictureInPicture
} from 'lucide-react';
import { Participant } from '../lib/types';

interface VideoTileProps {
  participant: Participant;
  stream?: MediaStream | null;
  isLocal?: boolean;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
  isScreenShareTile?: boolean;
}

/**
 * VideoTile renders ONLY video. Remote audio is deliberately NOT rendered here:
 * every remote peer's audio is played by a single root-level <GlobalRemoteAudio>
 * element in App.tsx. Rendering a second <audio> bound to the same MediaStream
 * made every remote voice play twice (audible echo / doubled volume).
 */
export const VideoTile: React.FC<VideoTileProps> = ({
  participant,
  stream,
  isLocal = false,
  isPinned = false,
  onTogglePin,
  isScreenShareTile = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [trackCount, setTrackCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Monitor stream tracks dynamically (a stream object can stay the same while
  // tracks are added/removed, so we need a counter to re-run the sync effect).
  useEffect(() => {
    if (!stream) {
      setTrackCount(0);
      return;
    }
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

  // Stable callback ref: keeps srcObject in sync even when the <video> element is
  // unmounted/remounted as the tile flips between avatar placeholder and video.
  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (!el) return;
      if (stream) {
        if (el.srcObject !== stream) {
          el.srcObject = stream;
        }
        el.play().catch(() => {});
      } else {
        el.srcObject = null;
      }
    },
    [stream]
  );

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

  return (
    <div
      ref={containerRef}
      className={`relative group w-full h-full rounded-3xl overflow-hidden glass-card transition-all duration-300 border ${
        participant.isSpeaking
          ? 'active-speaker-ring'
          : 'border-slate-800/90 hover:border-slate-700'
      }`}
    >
      {/* Video Element - always muted so the single root audio sink owns playback */}
      {hasActiveVideo ? (
        <video
          ref={attachVideo}
          autoPlay
          playsInline
          muted
          className={`w-full h-full bg-black/50 transition-all duration-300 ${
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
              <div className="w-48 h-48 rounded-full border animate-ping opacity-30 border-indigo-500/30" />
            </div>
          )}

          <div
            className={`w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-gradient-to-tr ${
              participant.avatarColor || 'from-indigo-500 to-purple-600'
            } flex items-center justify-center text-3xl sm:text-4xl font-bold text-white shadow-2xl transition-all duration-300 border border-white/10 ${
              participant.isSpeaking
                ? 'scale-110 ring-4 ring-indigo-500/40'
                : 'scale-100'
            }`}
          >
            {participant.name ? participant.name.charAt(0).toUpperCase() : '?'}
          </div>
          <span className="mt-3 text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-1.5">
            <span>{participant.name} {isLocal && '(You)'}</span>
          </span>
        </div>
      )}

      {/* Top-left status badges (stacked so they never overlap) */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 items-start pointer-events-none">
        {participant.isHandRaised && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500 text-dark-950 font-bold text-xs shadow-xl shadow-amber-500/30 animate-bounce">
            <Hand className="w-3 h-3 fill-current" />
            <span className="hidden sm:inline">Hand Raised</span>
            <span className="sm:hidden">✋</span>
          </div>
        )}
        {(isScreenShareTile || participant.isScreenSharing) && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-600/95 text-white font-medium text-xs shadow-xl backdrop-blur-md border border-indigo-400/30">
            <Monitor className="w-3 h-3" />
            <span className="hidden sm:inline">{isLocal ? 'Your Screen' : `${participant.name}'s Screen`}</span>
            <span className="sm:hidden">Screen</span>
          </div>
        )}
      </div>

      {/* Top right action buttons overlay.
          `tile-actions` keeps them permanently visible on touch devices, where
          `group-hover` never fires (see index.css). */}
      <div className="tile-actions absolute top-3 right-3 flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200 z-10">
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
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 z-10 pointer-events-none">
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-dark-950/85 backdrop-blur-md border border-slate-800/90 shadow-lg min-w-0">
          {participant.isHost && (
            <span title="Meeting Host" className="shrink-0">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
            </span>
          )}

          <span className="text-xs font-semibold text-white truncate max-w-[120px] sm:max-w-[180px]">
            {participant.name} {isLocal && <span className="text-indigo-400 font-normal">(You)</span>}
          </span>

          {participant.isSpeaking && (
            <div className="flex items-end gap-0.5 h-3.5 shrink-0">
              <span className="w-0.5 rounded-full animate-pulse h-2 bg-indigo-400" />
              <span className="w-0.5 rounded-full animate-pulse h-3.5 delay-75 bg-indigo-400" />
              <span className="w-0.5 rounded-full animate-pulse h-2 delay-150 bg-indigo-400" />
            </div>
          )}
        </div>

        {/* Muted Audio & Video indicator */}
        <div className="flex items-center space-x-1.5 shrink-0">
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
