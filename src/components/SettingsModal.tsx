import React, { useEffect, useRef, useState } from 'react';
import { 
  X, Mic, Video, Database, CheckCircle2, AlertTriangle, 
  Key, Globe, Shield, Volume2, Play, Keyboard, Sparkles
} from 'lucide-react';
import { getSupabaseCredentials, isSupabaseReady, resetSupabaseClient } from '../lib/supabase';
import { sounds } from '../lib/sound';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAudioInput?: string;
  selectedVideoInput?: string;
  onDeviceChange?: (audioId: string, videoId: string) => void;
  isNoiseCancellationEnabled?: boolean;
  onToggleNoiseCancellation?: (enabled: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  selectedAudioInput,
  selectedVideoInput,
  onDeviceChange,
  isNoiseCancellationEnabled = true,
  onToggleNoiseCancellation,
}) => {
  const [activeTab, setActiveTab] = useState<'audio' | 'video' | 'network' | 'shortcuts'>('audio');
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentAudio, setCurrentAudio] = useState(selectedAudioInput || '');
  const [currentVideo, setCurrentVideo] = useState(selectedVideoInput || '');

  // Live test preview in settings
  const [testStream, setTestStream] = useState<MediaStream | null>(null);
  const [testAudioLevel, setTestAudioLevel] = useState(0);
  const testVideoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number | null>(null);

  // Supabase manual config in UI
  const initialCreds = getSupabaseCredentials();
  const [supabaseUrl, setSupabaseUrl] = useState(initialCreds.url);
  const [supabaseKey, setSupabaseKey] = useState(initialCreds.key);
  const [showCredsInput, setShowCredsInput] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    async function loadDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
        setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
      } catch (err) {
        console.warn('Error fetching media devices:', err);
      }
    }
    if (isOpen) {
      loadDevices();
      const creds = getSupabaseCredentials();
      setSupabaseUrl(creds.url);
      setSupabaseKey(creds.key);
    }
  }, [isOpen]);

  // Handle live test stream for video tab
  useEffect(() => {
    if (!isOpen || activeTab !== 'video') {
      if (testStream) {
        testStream.getTracks().forEach((t) => t.stop());
        setTestStream(null);
      }
      return;
    }

    let active = true;
    async function startCameraTest() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: currentVideo
            ? { deviceId: { exact: currentVideo }, width: { ideal: 640 }, height: { ideal: 360 } }
            : { width: { ideal: 640 }, height: { ideal: 360 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setTestStream(stream);
        if (testVideoRef.current) {
          testVideoRef.current.srcObject = stream;
        }
      } catch (e) {
        console.warn('Camera test stream error:', e);
      }
    }

    startCameraTest();

    return () => {
      active = false;
      if (testStream) {
        testStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isOpen, activeTab, currentVideo]);

  if (!isOpen) return null;

  const handleTestSpeaker = () => {
    sounds.playTestTone();
  };

  const handleSave = () => {
    sounds.playClick();
    const previousUrl = localStorage.getItem('aura_supabase_url') || '';
    const previousKey = localStorage.getItem('aura_supabase_key') || '';

    if (supabaseUrl.trim()) {
      localStorage.setItem('aura_supabase_url', supabaseUrl.trim());
    } else {
      localStorage.removeItem('aura_supabase_url');
    }

    if (supabaseKey.trim()) {
      localStorage.setItem('aura_supabase_key', supabaseKey.trim());
    } else {
      localStorage.removeItem('aura_supabase_key');
    }

    if (previousUrl !== supabaseUrl.trim() || previousKey !== supabaseKey.trim()) {
      resetSupabaseClient();
    }

    if (onDeviceChange) {
      onDeviceChange(currentAudio, currentVideo);
    }

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 400);
  };

  const isConfigured = isSupabaseReady() || (supabaseUrl.trim() && supabaseKey.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-3xl glass-panel border border-slate-700/60 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <h2 className="text-base font-bold text-white">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-dark-950/50 px-4 pt-2 gap-2 overflow-x-auto">
          {[
            { id: 'audio', label: 'Audio', icon: Mic },
            { id: 'video', label: 'Video', icon: Video },
            { id: 'network', label: 'Signaling & Cloud', icon: Database },
            { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  sounds.playClick();
                  setActiveTab(tab.id as any);
                }}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-t-xl transition-all border-b-2 cursor-pointer ${
                  isActive
                    ? 'text-indigo-400 border-indigo-500 bg-dark-900/80 shadow-sm'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {activeTab === 'audio' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Microphone Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Mic className="w-4 h-4 text-indigo-400" />
                  Microphone Input
                </label>
                <select
                  value={currentAudio}
                  onChange={(e) => setCurrentAudio(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-dark-900 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="">Default System Microphone</option>
                  {audioDevices.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label || `Microphone (${dev.deviceId.slice(0, 8)}...)`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Noise Cancellation Toggle */}
              <div className="p-4 rounded-2xl bg-dark-900/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className={`p-2 rounded-xl border ${
                      isNoiseCancellationEnabled
                        ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <p className="text-xs font-semibold text-white">AI Noise Cancellation</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          isNoiseCancellationEnabled
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {isNoiseCancellationEnabled ? 'ACTIVE' : 'OFF'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Filters out background noise, keyboard clicks & room echo
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      sounds.playClick();
                      onToggleNoiseCancellation?.(!isNoiseCancellationEnabled);
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isNoiseCancellationEnabled ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                    role="switch"
                    aria-checked={isNoiseCancellationEnabled}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        isNoiseCancellationEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Speaker Test */}
              <div className="p-4 rounded-2xl bg-dark-900/80 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-white">Test Audio Output</p>
                    <p className="text-[11px] text-slate-400">Play a test sound to verify speakers</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestSpeaker}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-all cursor-pointer shadow-sm"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play Test Sound</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'video' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Camera Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Video className="w-4 h-4 text-indigo-400" />
                  Camera Device
                </label>
                <select
                  value={currentVideo}
                  onChange={(e) => setCurrentVideo(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-dark-900 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="">Default System Camera</option>
                  {videoDevices.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label || `Camera (${dev.deviceId.slice(0, 8)}...)`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Camera Live Test Preview */}
              <div className="w-full aspect-video rounded-2xl overflow-hidden glass-card border border-slate-700/60 relative bg-black/40 flex items-center justify-center">
                {testStream ? (
                  <video
                    ref={testVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover -scale-x-100"
                  />
                ) : (
                  <div className="text-center text-slate-500 text-xs">
                    <Video className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <span>Camera preview loading...</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'network' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-4 rounded-2xl bg-dark-900/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Database className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-white">Signaling Transport</span>
                  </div>
                  {isConfigured ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Supabase Cloud Active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-indigo-300">
                      <Globe className="w-3.5 h-3.5" />
                      Local Mesh Mode
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Local mesh uses browser BroadcastChannel for zero-latency multi-tab testing on the same device.
                  For remote meetings between different computers and phones, configure your Supabase project keys below.
                </p>

                <button
                  type="button"
                  onClick={() => setShowCredsInput(!showCredsInput)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium underline flex items-center gap-1 cursor-pointer"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>{showCredsInput ? 'Hide Supabase Keys' : 'Configure Supabase Keys'}</span>
                </button>

                {showCredsInput && (
                  <div className="space-y-3 pt-3 border-t border-slate-800 animate-in fade-in duration-150">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">
                        Supabase Project URL
                      </label>
                      <input
                        type="text"
                        placeholder="https://your-project.supabase.co"
                        value={supabaseUrl}
                        onChange={(e) => setSupabaseUrl(e.target.value)}
                        className="w-full px-3 py-2 bg-dark-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">
                        Supabase Anon Key
                      </label>
                      <input
                        type="password"
                        placeholder="eyJhbG...IsIn..."
                        value={supabaseKey}
                        onChange={(e) => setSupabaseKey(e.target.value)}
                        className="w-full px-3 py-2 bg-dark-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* TURN Relay status */}
              <div className="p-4 rounded-2xl bg-dark-900/80 border border-slate-800 space-y-2">
                <div className="flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-white">NAT / TURN Relay</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  WebRTC includes STUN and TURN fallback relays (OpenRelay & Cloudflare) to ensure symmetric NAT and mobile carriers can establish peer-to-peer connections seamlessly.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-3 animate-in fade-in duration-150">
              <p className="text-xs text-slate-400 mb-2">Keyboard shortcuts available during calls:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { key: 'M', desc: 'Mute / Unmute Microphone' },
                  { key: 'V', desc: 'Start / Stop Video' },
                  { key: 'H', desc: 'Raise / Lower Hand' },
                  { key: 'C', desc: 'Open / Close Chat' },
                  { key: 'P', desc: 'Open / Close Participants' },
                  { key: 'Space (hold)', desc: 'Push to Talk (temporary unmute)' },
                  { key: 'Esc', desc: 'Close Drawers & Modals' },
                ].map((s) => (
                  <div key={s.key} className="flex items-center justify-between p-2.5 rounded-xl bg-dark-900/90 border border-slate-800">
                    <span className="text-xs text-slate-300">{s.desc}</span>
                    <kbd className="px-2 py-0.5 rounded-lg bg-dark-950 border border-slate-700 text-indigo-300 font-mono text-[11px] font-bold shadow-inner">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-dark-950/60 flex items-center justify-end space-x-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
          >
            {savedSuccess ? 'Saved!' : 'Apply Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};
