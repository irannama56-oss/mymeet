import React, { useState, useEffect } from 'react';
import { Shield, Lock, Unlock, Copy, Check, Radio, Users } from 'lucide-react';

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
    const meetUrl = `${window.location.origin}/${roomId}`;
    navigator.clipboard.writeText(meetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="fixed top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
      {/* Left: Meeting Brand & Code */}
      <div className="flex items-center space-x-2.5 p-2 px-3 rounded-2xl glass-panel border border-slate-700/60 shadow-lg pointer-events-auto">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-xs font-bold text-indigo-300">{roomId}</span>
        </div>

        <div className="h-4 w-[1px] bg-slate-700" />

        <button
          onClick={handleCopyCode}
          className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-medium transition-all"
          title="Copy meeting link"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Invite'}</span>
        </button>

        {isRoomLocked && (
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-semibold border border-amber-500/30">
            <Lock className="w-3 h-3" />
            <span>Locked</span>
          </div>
        )}
      </div>

      {/* Right: Call Timer & Security Status */}
      <div className="flex items-center space-x-2 p-2 px-3.5 rounded-2xl glass-panel border border-slate-700/60 shadow-lg pointer-events-auto">
        <div className="flex items-center space-x-1.5 text-slate-300 text-xs font-mono font-medium">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          <span>{formatTime(elapsedSeconds)}</span>
        </div>

        <div className="h-4 w-[1px] bg-slate-700" />

        <div className="flex items-center space-x-1 text-emerald-400 text-xs font-medium" title="End-to-End P2P WebRTC">
          <Shield className="w-3.5 h-3.5" />
          <span className="text-[11px] hidden sm:inline">P2P Encrypted</span>
        </div>
      </div>
    </header>
  );
};
