import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, VideoOff, Mic, MicOff, Lock, Unlock, 
  Sparkles, ArrowRight, Shield, Users, Radio, Settings, Copy, Check
} from 'lucide-react';
import { sounds } from '../lib/sound';
import { cleanRoomCode } from '../lib/types';

interface LobbyProps {
  onJoin: (data: {
    name: string;
    roomId: string;
    isHost: boolean;
    audioEnabled: boolean;
    videoEnabled: boolean;
    requireHostApproval: boolean;
  }) => void;
  initialRoomId?: string;
}

const AVATAR_COLORS = [
  'from-indigo-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
];

export const Lobby: React.FC<LobbyProps> = ({ onJoin, initialRoomId = '' }) => {
  const [name, setName] = useState(() => localStorage.getItem('aura_meet_username') || '');
  const [roomId, setRoomId] = useState(initialRoomId);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [requireHostApproval, setRequireHostApproval] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(!initialRoomId);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isCopied, setIsCopied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Generate a random room code like Google Meet: 'xxx-yyyy-zzz'
  const generateRoomCode = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const randStr = (len: number) => {
      let res = '';
      for (let i = 0; i < len; i++) {
        res += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return res;
    };
    return `${randStr(3)}-${randStr(4)}-${randStr(3)}`;
  };

  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
      setIsCreatingNew(false);
    } else if (isCreatingNew && !roomId) {
      setRoomId(generateRoomCode());
    }
  }, [initialRoomId, isCreatingNew]);

  // Setup preview stream
  useEffect(() => {
    let active = true;

    async function initPreview() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: isVideoEnabled ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          audio: isAudioEnabled ? { echoCancellation: true } : false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        setPreviewStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Setup audio level meter
        if (isAudioEnabled && stream.getAudioTracks().length > 0) {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const checkLevel = () => {
            if (!active || !analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
            animFrameRef.current = requestAnimationFrame(checkLevel);
          };
          checkLevel();
        }
      } catch (err) {
        console.warn('Lobby preview error:', err);
      }
    }

    initPreview();

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isVideoEnabled, isAudioEnabled]);

  const toggleAudio = () => {
    sounds.playClick();
    setIsAudioEnabled((prev) => !prev);
  };

  const toggleVideo = () => {
    sounds.playClick();
    setIsVideoEnabled((prev) => !prev);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    sounds.playJoinChime();
    localStorage.setItem('aura_meet_username', name.trim());

    // Clean up preview stream tracks before joining
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
    }

    onJoin({
      name: name.trim(),
      roomId: roomId.trim().toLowerCase(),
      isHost: isCreatingNew,
      audioEnabled: isAudioEnabled,
      videoEnabled: isVideoEnabled,
      requireHostApproval: isCreatingNew ? requireHostApproval : false,
    });
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomId);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 md:p-8 bg-gradient-to-b from-dark-950 via-dark-900 to-dark-950 overflow-hidden">
      {/* Background ambient lighting effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/15 rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-cyan-600/10 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Main card */}
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        
        {/* Left: Camera & Audio Preview */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          <div className="flex items-center space-x-3 mb-1">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Radio className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Aura <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">MEET</span>
              </h1>
              <p className="text-xs text-slate-400">Ultra-low latency private meetings</p>
            </div>
          </div>

          {/* Camera preview box */}
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden glass-panel border border-slate-700/50 shadow-2xl group">
            {isVideoEnabled ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-dark-900/80">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-3xl font-bold text-white shadow-xl shadow-indigo-500/20">
                  {name ? name.charAt(0).toUpperCase() : '?'}
                </div>
                <p className="mt-3 text-sm text-slate-400 font-medium">Camera is off</p>
              </div>
            )}

            {/* Audio level indicator overlay */}
            <div className="absolute bottom-4 left-4 flex items-center space-x-2 px-3 py-1.5 rounded-full bg-dark-900/80 backdrop-blur-md border border-slate-700/50">
              {isAudioEnabled ? (
                <div className="flex items-center space-x-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-400 transition-all duration-75" 
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono text-slate-300">Mic Active</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-rose-400 text-[11px]">
                  <MicOff className="w-3.5 h-3.5" />
                  <span>Muted</span>
                </div>
              )}
            </div>

            {/* In-preview quick controls */}
            <div className="absolute bottom-4 right-4 flex items-center space-x-2">
              <button
                type="button"
                onClick={toggleAudio}
                className={`p-3 rounded-full backdrop-blur-md transition-all ${
                  isAudioEnabled
                    ? 'bg-slate-800/80 hover:bg-slate-700/80 text-white border border-slate-600/50'
                    : 'bg-rose-500/90 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/30'
                }`}
                title={isAudioEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
              >
                {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              <button
                type="button"
                onClick={toggleVideo}
                className={`p-3 rounded-full backdrop-blur-md transition-all ${
                  isVideoEnabled
                    ? 'bg-slate-800/80 hover:bg-slate-700/80 text-white border border-slate-600/50'
                    : 'bg-rose-500/90 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/30'
                }`}
                title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
              >
                {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Join / Create Form */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-slate-700/60 shadow-2xl relative">
            {/* Tab switch: New Meeting vs Join Existing */}
            <div className="flex p-1 bg-dark-950/80 rounded-xl border border-slate-800 mb-6">
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setIsCreatingNew(true);
                  if (!roomId || !roomId.includes('-')) setRoomId(generateRoomCode());
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                  isCreatingNew
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                New Meeting
              </button>
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setIsCreatingNew(false);
                  if (!initialRoomId) {
                    setRoomId('');
                  }
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                  !isCreatingNew
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Join with Code
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Your Display Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alex Rivera"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-dark-900/90 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>

              {/* Room Code */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  {isCreatingNew ? 'Meeting Code (Auto-generated)' : 'Enter Meeting Code or Link'}
                </label>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    required
                    readOnly={isCreatingNew}
                    placeholder={isCreatingNew ? 'e.g. abc-defg-hij' : 'Enter code or paste link...'}
                    value={roomId}
                    onChange={(e) => setRoomId(cleanRoomCode(e.target.value))}
                    className={`w-full px-4 py-3 bg-dark-900/90 border border-slate-700 rounded-xl font-mono text-indigo-300 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${
                      isCreatingNew ? 'cursor-pointer' : ''
                    }`}
                  />
                  {isCreatingNew && (
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="absolute right-2 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1 border border-slate-600/50"
                      title="Copy code"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span className="text-[11px]">{isCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Host lock setting (Only when creating new meeting) */}
              {isCreatingNew && (
                <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/20 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                      {requireHostApproval ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">Require Host Approval</p>
                      <p className="text-[11px] text-slate-400">Guests must knock to be admitted</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRequireHostApproval(!requireHostApproval)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${
                      requireHostApproval ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                        requireHostApproval ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!name.trim() || !roomId.trim()}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold flex items-center justify-center space-x-2 shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <span>{isCreatingNew ? 'Start Meeting' : 'Join Meeting'}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                P2P Encrypted Mesh
              </span>
              <span>Max 4-6 participants</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
