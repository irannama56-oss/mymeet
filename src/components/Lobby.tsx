import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, VideoOff, Mic, MicOff, Lock, Unlock, 
  ArrowRight, Shield, Radio, Copy, Check, Settings,
  Sparkles, RefreshCw, Volume2, KeyRound
} from 'lucide-react';
import { sounds } from '../lib/sound';
import { cleanRoomCode } from '../lib/types';
import { ConnectionBanner } from './ConnectionBanner';
import { SettingsModal } from './SettingsModal';

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
  onOpenAdmin?: () => void;
}

export const Lobby: React.FC<LobbyProps> = ({ onJoin, initialRoomId = '', onOpenAdmin }) => {
  const [name, setName] = useState(() => localStorage.getItem('aura_meet_username') || '');
  const [roomId, setRoomId] = useState(initialRoomId);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [requireHostApproval, setRequireHostApproval] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(!initialRoomId);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Available devices for quick switching in Lobby
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

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
    }
  }, [initialRoomId]);

  useEffect(() => {
    if (isCreatingNew && !roomId) {
      setRoomId(generateRoomCode());
    }
  }, [isCreatingNew, roomId]);

  // Load available devices
  useEffect(() => {
    async function loadDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
        setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
      } catch (err) {
        console.warn('Error fetching media devices in lobby:', err);
      }
    }
    loadDevices();
  }, []);

  // Setup preview stream
  useEffect(() => {
    let active = true;
    let currentStream: MediaStream | null = null;
    let currentAudioCtx: AudioContext | null = null;

    async function initPreview() {
      try {
        const constraints: MediaStreamConstraints = {
          video: isVideoEnabled
            ? selectedVideoId
              ? { deviceId: { exact: selectedVideoId }, width: { ideal: 1280 }, height: { ideal: 720 } }
              : { width: { ideal: 1280 }, height: { ideal: 720 } }
            : false,
          audio: isAudioEnabled
            ? selectedAudioId
              ? { deviceId: { exact: selectedAudioId }, echoCancellation: true }
              : { echoCancellation: true }
            : false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        currentStream = stream;
        setPreviewStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Setup audio level meter
        if (isAudioEnabled && stream.getAudioTracks().length > 0) {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioCtx) {
            const audioCtx = new AudioCtx();
            audioContextRef.current = audioCtx;
            currentAudioCtx = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 128;
            analyser.smoothingTimeConstant = 0.5;
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
        }
      } catch (err) {
        console.warn('Lobby preview error:', err);
      }
    }

    initPreview();

    return () => {
      active = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (currentAudioCtx) {
        currentAudioCtx.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isVideoEnabled, isAudioEnabled, selectedAudioId, selectedVideoId]);

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

    sounds.playClick();
    localStorage.setItem('aura_meet_username', name.trim());

    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
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

  const handleRegenerateCode = () => {
    sounds.playClick();
    setRoomId(generateRoomCode());
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 md:p-10 bg-gradient-to-br from-dark-950 via-dark-900 to-dark-950 overflow-x-hidden select-none">
      {/* Background ambient lighting effects */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse-subtle" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse-subtle" />
      <div className="absolute top-1/2 right-1/3 w-80 h-80 bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Top Navbar */}
      <header className="absolute top-6 left-6 right-6 flex items-center justify-between max-w-6xl mx-auto z-20">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-indigo-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 border border-indigo-400/30">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-white font-sans">Aura</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30 uppercase tracking-wider">
                Meet
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">Private, Encrypted WebRTC Video Rooms</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {onOpenAdmin && (
            <button
              onClick={() => {
                sounds.playClick();
                onOpenAdmin();
              }}
              className="p-2.5 rounded-xl glass-panel text-slate-300 hover:text-amber-300 hover:border-amber-500/40 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
              title="Super Admin Panel"
            >
              <KeyRound className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Admin Panel</span>
            </button>
          )}

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 rounded-xl glass-panel text-slate-300 hover:text-white hover:border-slate-600 transition-all flex items-center gap-2 text-xs font-medium cursor-pointer"
            title="Settings"
          >
            <Settings className="w-4 h-4 text-indigo-400" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center pt-16 sm:pt-12">
        
        {/* Left: Camera & Mic Live Preview Card */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          <div className="relative w-full aspect-video rounded-3xl overflow-hidden glass-panel border border-slate-700/60 shadow-2xl group transition-all duration-300">
            {isVideoEnabled ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100 bg-black/40"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-dark-900/90 relative">
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-4xl font-bold text-white shadow-2xl shadow-indigo-500/30 border border-indigo-400/20">
                  {name ? name.charAt(0).toUpperCase() : '?'}
                </div>
                <p className="mt-3 text-sm text-slate-400 font-medium">Camera is off</p>
              </div>
            )}

            {/* Audio level voice visualizer */}
            <div className="absolute bottom-4 left-4 flex items-center space-x-2 px-3.5 py-2 rounded-2xl bg-dark-950/85 backdrop-blur-md border border-slate-700/60 shadow-lg">
              {isAudioEnabled ? (
                <div className="flex items-center space-x-2">
                  <div className="flex items-end gap-0.5 h-4">
                    <span className="w-1 bg-emerald-400 rounded-full transition-all duration-75" style={{ height: `${Math.max(4, audioLevel * 0.4)}px` }} />
                    <span className="w-1 bg-emerald-400 rounded-full transition-all duration-75" style={{ height: `${Math.max(4, audioLevel * 0.9)}px` }} />
                    <span className="w-1 bg-emerald-400 rounded-full transition-all duration-75" style={{ height: `${Math.max(4, audioLevel * 0.6)}px` }} />
                  </div>
                  <span className="text-xs font-mono font-medium text-emerald-400">Mic Active</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-rose-400 text-xs font-medium">
                  <MicOff className="w-4 h-4" />
                  <span>Microphone Muted</span>
                </div>
              )}
            </div>

            {/* In-preview quick controls */}
            <div className="absolute bottom-4 right-4 flex items-center space-x-2.5">
              <button
                type="button"
                onClick={toggleAudio}
                className={`p-3.5 rounded-2xl backdrop-blur-md transition-all duration-200 cursor-pointer ${
                  isAudioEnabled
                    ? 'bg-slate-800/80 hover:bg-slate-700/90 text-white border border-slate-600/50 shadow-lg'
                    : 'bg-rose-500 hover:bg-rose-600 text-white shadow-xl shadow-rose-500/30'
                }`}
                title={isAudioEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
              >
                {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              <button
                type="button"
                onClick={toggleVideo}
                className={`p-3.5 rounded-2xl backdrop-blur-md transition-all duration-200 cursor-pointer ${
                  isVideoEnabled
                    ? 'bg-slate-800/80 hover:bg-slate-700/90 text-white border border-slate-600/50 shadow-lg'
                    : 'bg-rose-500 hover:bg-rose-600 text-white shadow-xl shadow-rose-500/30'
                }`}
                title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
              >
                {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Device Quick Pickers Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Mic selector */}
            <div className="flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl glass-card border border-slate-800">
              <Mic className="w-4 h-4 text-indigo-400 shrink-0" />
              <select
                value={selectedAudioId}
                onChange={(e) => setSelectedAudioId(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer truncate"
              >
                <option value="" className="bg-dark-900 text-white">Default Microphone</option>
                {audioDevices.map((dev) => (
                  <option key={dev.deviceId} value={dev.deviceId} className="bg-dark-900 text-white">
                    {dev.label || `Mic (${dev.deviceId.slice(0, 8)}...)`}
                  </option>
                ))}
              </select>
            </div>

            {/* Camera selector */}
            <div className="flex items-center space-x-2 px-3.5 py-2.5 rounded-2xl glass-card border border-slate-800">
              <Video className="w-4 h-4 text-indigo-400 shrink-0" />
              <select
                value={selectedVideoId}
                onChange={(e) => setSelectedVideoId(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-300 focus:outline-none cursor-pointer truncate"
              >
                <option value="" className="bg-dark-900 text-white">Default Camera</option>
                {videoDevices.map((dev) => (
                  <option key={dev.deviceId} value={dev.deviceId} className="bg-dark-900 text-white">
                    {dev.label || `Cam (${dev.deviceId.slice(0, 8)}...)`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Right: Join / Create Form Card */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-slate-700/60 shadow-2xl relative">
            
            {/* Tab switch */}
            <div className="flex p-1.5 bg-dark-950/90 rounded-2xl border border-slate-800/90 mb-6">
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setIsCreatingNew(true);
                  if (!roomId || !roomId.includes('-')) setRoomId(generateRoomCode());
                }}
                className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                  isCreatingNew
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
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
                  setRoomId(initialRoomId || '');
                }}
                className={`flex-1 py-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                  !isCreatingNew
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
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
                  className="w-full px-4 py-3.5 bg-dark-900/90 border border-slate-700/80 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-sm"
                />
              </div>

              {/* Room Code */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    {isCreatingNew ? 'Meeting Room Code' : 'Enter Meeting Code or Link'}
                  </label>
                  {isCreatingNew && (
                    <button
                      type="button"
                      onClick={handleRegenerateCode}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium cursor-pointer"
                      title="Generate new code"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Randomize</span>
                    </button>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    required
                    readOnly={isCreatingNew}
                    placeholder={isCreatingNew ? 'e.g. abc-defg-hij' : 'Enter code or paste invite link...'}
                    value={roomId}
                    onChange={(e) => setRoomId(cleanRoomCode(e.target.value))}
                    className={`w-full px-4 py-3.5 bg-dark-900/90 border border-slate-700/80 rounded-2xl font-mono text-indigo-300 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm ${
                      isCreatingNew ? 'cursor-default' : ''
                    }`}
                  />
                  {isCreatingNew && (
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="absolute right-2.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 border border-slate-600/50 shadow-sm transition-all cursor-pointer"
                      title="Copy code"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span className="text-[11px] font-medium">{isCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Host lock setting */}
              {isCreatingNew && (
                <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/20 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {requireHostApproval ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">Require Host Approval</p>
                      <p className="text-[11px] text-slate-400">Guests must knock before joining</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRequireHostApproval(!requireHostApproval)}
                    className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                      requireHostApproval ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                        requireHostApproval ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* Submit CTA Button */}
              <button
                type="submit"
                disabled={!name.trim() || !roomId.trim()}
                className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold flex items-center justify-center space-x-2 shadow-xl shadow-indigo-600/30 hover:shadow-indigo-600/45 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed group cursor-pointer"
              >
                <span>{isCreatingNew ? 'Start Meeting Now' : 'Join Room'}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-800/80 space-y-3">
              <ConnectionBanner />
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <Shield className="w-3.5 h-3.5" />
                  E2E Encrypted P2P
                </span>
                <span>Ultra-low Latency</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        selectedAudioInput={selectedAudioId}
        selectedVideoInput={selectedVideoId}
        onDeviceChange={(audio, video) => {
          setSelectedAudioId(audio);
          setSelectedVideoId(video);
        }}
      />
    </div>
  );
};
