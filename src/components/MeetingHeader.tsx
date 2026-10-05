import React, { useState, useEffect } from 'react';
import { Shield, Lock, Unlock, Copy, Check, Radio, Users, Clock } from 'lucide-react';
import { sounds } from '../lib/sound';

interface MeetingHeaderProps {
  roomId: string;
  isHost: boolean;
  isRoomLocked: boolean;
  participantsCount: number;
}

export const MeetingHeader: React.FC<MeetingHeaderProps> = ({
  roomId,
  isHost,
  isRoomLocked,
  participantsCount,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleCopyCode = () => {
    sounds.playClick();
    const meetUrl = `${window.location.origin}/${roomId}`;
    navigator.clipboard.writeText(meetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="fixed top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
      {/* Left: Meeting Brand & Room Info */}
      <div className="flex items-center space-x-2.5 p-2 px-3.5 rounded-2xl glass-panel border border-slate-700/60 shadow-xl pointer-events-auto">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-xs font-bold text-indigo-300 tracking-wide">{roomId}</span>
        </div>

        <div className="h-4 w-[1px] bg-slate-700/80" />

        <button
          onClick={handleCopyCode}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-medium transition-all cursor-pointer border border-slate-700/50"
          title="Copy meeting invite link"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Invite'}</span>
        </button>

        {isRoomLocked && (
          <div className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[10px] font-semibold border border-amber-500/30">
            <Lock className="w-3 h-3" />
            <span>Locked</span>
          </div>
        )}
      </div>

      {/* Right: Call Timer & Security Status */}
      <div className="flex items-center space-x-3 p-2 px-4 rounded-2xl glass-panel border border-slate-700/60 shadow-xl pointer-events-auto">
        <div className="flex items-center space-x-1.5 text-slate-200 text-xs font-mono font-medium">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span>{formatTime(elapsedSeconds)}</span>
        </div>

        <div className="h-4 w-[1px] bg-slate-700/80" />

        <div className="flex items-center space-x-1.5 text-emerald-400 text-xs font-medium" title="End-to-End P2P WebRTC Encryption">
          <Shield className="w-3.5 h-3.5" />
          <span className="text-[11px] hidden sm:inline">Encrypted</span>
        </div>
      </div>
    </header>
  );
};
