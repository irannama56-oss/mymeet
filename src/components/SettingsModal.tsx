import React, { useEffect, useState } from 'react';
import { X, Mic, Video, Volume2, Shield, Database, CheckCircle2, AlertTriangle, Key } from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabase';

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
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (onDeviceChange) {
      onDeviceChange(currentAudio, currentVideo);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-lg p-6 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h2 className="text-lg font-bold text-white">Audio & Video Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
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
              className="w-full px-3.5 py-2.5 bg-dark-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              className="w-full px-3.5 py-2.5 bg-dark-900 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Default Camera</option>
              {videoDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label || `Camera (${dev.deviceId.slice(0, 6)}...)`}
                </option>
              ))}
            </select>
          </div>

          {/* Supabase Connection Status Card */}
          <div className="p-4 rounded-2xl bg-dark-900/90 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-semibold text-white">Signaling Backend</span>
              </div>
              {isSupabaseConfigured ? (
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Supabase Cloud Active
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Local Mesh Mode
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {isSupabaseConfigured
                ? 'Connected to Supabase Realtime for worldwide P2P signaling.'
                : 'For remote calls across different computers, add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env. Currently running local multi-tab preview.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-md shadow-indigo-600/30"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
};
