import React, { useEffect, useState } from 'react';
import { X, Mic, Video, Database, CheckCircle2, AlertTriangle, Key, Globe, Shield } from 'lucide-react';
import { getSupabaseCredentials, isSupabaseReady } from '../lib/supabase';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAudioInput?: string;
  selectedVideoInput?: string;
  onDeviceChange?: (audioId: string, videoId: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  selectedAudioInput,
  selectedVideoInput,
  onDeviceChange,
}) => {
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentAudio, setCurrentAudio] = useState(selectedAudioInput || '');
  const [currentVideo, setCurrentVideo] = useState(selectedVideoInput || '');

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

  if (!isOpen) return null;

  const handleSave = () => {
    // Save Supabase credentials to localStorage if modified
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

    if (onDeviceChange) {
      onDeviceChange(currentAudio, currentVideo);
    }

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 500);
  };

  const isConfigured = isSupabaseReady() || (supabaseUrl.trim() && supabaseKey.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-lg p-6 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            Audio & Video Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Microphone Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Mic className="w-4 h-4 text-indigo-400" />
              Microphone
            </label>
            <select
              value={currentAudio}
              onChange={(e) => setCurrentAudio(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-dark-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="">Default Microphone</option>
              {audioDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || `Microphone (${dev.deviceId.slice(0, 6)}...)`}
                </option>
              ))}
            </select>
          </div>

          {/* Camera Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Video className="w-4 h-4 text-indigo-400" />
              Camera
            </label>
            <select
              value={currentVideo}
              onChange={(e) => setCurrentVideo(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-dark-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="">Default Camera</option>
              {videoDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || `Camera (${dev.deviceId.slice(0, 6)}...)`}
                </option>
              ))}
            </select>
          </div>

          {/* Supabase Signaling Status & Configuration Card */}
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
              Local mesh uses browser BroadcastChannel for zero-latency multi-tab testing.
              For remote meetings across computers or phones, connect your Supabase project below.
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
              <div className="space-y-2 pt-2 border-t border-slate-800 animate-in fade-in duration-150">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Supabase Project URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://your-project.supabase.co"
                    value={supabaseUrl}
                    onChange={(e) => setSupabaseUrl(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Supabase Anon Key
                  </label>
                  <input
                    type="password"
                    placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                    value={supabaseKey}
                    onChange={(e) => setSupabaseKey(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 pt-2">
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
