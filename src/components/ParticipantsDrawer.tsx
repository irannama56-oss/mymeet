import React, { useState } from 'react';
import { 
  X, Users, Crown, Mic, MicOff, Video, VideoOff, 
  Hand, UserX, Lock, Unlock, Copy, Check, ShieldCheck, UserPlus, CheckCircle2, XCircle
} from 'lucide-react';
import { Participant, KnockRequest } from '../lib/types';
import { sounds } from '../lib/sound';

interface ParticipantsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  localParticipant: Participant;
  remoteParticipants: Participant[];
  isHost: boolean;
  isRoomLocked: boolean;
  knockRequests: KnockRequest[];
  roomId: string;
  onToggleRoomLock: () => void;
  onAdmitKnock: (knock: KnockRequest) => void;
  onDeclineKnock: (knockId: string) => void;
  onKickParticipant: (participantId: string) => void;
}

export const ParticipantsDrawer: React.FC<ParticipantsDrawerProps> = ({
  isOpen,
  onClose,
  localParticipant,
  remoteParticipants,
  isHost,
  isRoomLocked,
  knockRequests,
  roomId,
  onToggleRoomLock,
  onAdmitKnock,
  onDeclineKnock,
  onKickParticipant,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const allParticipants = [localParticipant, ...remoteParticipants];

  if (!isOpen) return null;

  const handleCopyLink = () => {
    const url = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <aside aria-label="Meeting Participants" className="fixed top-0 right-0 h-full w-full sm:w-96 z-50 glass-panel border-l border-slate-700/60 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Users className="w-5 h-5 text-indigo-400" />
          <h2 className="font-semibold text-white text-base">
            People ({allParticipants.length})
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Host Meeting Controls Section */}
        {isHost && (
          <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-semibold text-white">Host Security</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                HOST
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div>
                <p className="text-xs text-slate-200 font-medium">Room Lock</p>
                <p className="text-[11px] text-slate-400">
                  {isRoomLocked ? 'New guests must ask to join' : 'Open for anyone with code'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  onToggleRoomLock();
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  isRoomLocked
                    ? 'bg-amber-500 text-dark-950 shadow-md shadow-amber-500/20'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                }`}
              >
                {isRoomLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                <span>{isRoomLocked ? 'Locked' : 'Unlocked'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Pending Knock Requests (Waiting Room) */}
        {isHost && knockRequests.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-amber-400">
                <UserPlus className="w-4 h-4" />
                <span className="text-xs font-semibold">Waiting to Join ({knockRequests.length})</span>
              </div>
            </div>

            <div className="space-y-2">
              {knockRequests.map((knock) => (
                <div
                  key={knock.id}
                  className="flex items-center justify-between p-2 rounded-xl bg-dark-950/60 border border-slate-800"
                >
                  <div className="flex items-center space-x-2">
                    <div
                      className={`w-7 h-7 rounded-lg bg-gradient-to-tr ${knock.avatarColor} flex items-center justify-center text-xs font-bold text-white`}
                    >
                      {knock.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium text-white truncate max-w-[110px]">
                      {knock.name}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => onAdmitKnock(knock)}
                      className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all"
                      title="Admit"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeclineKnock(knock.id)}
                      className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-all"
                      title="Decline"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Invite link card */}
        <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <p className="text-[11px] font-medium text-slate-400">Meeting Code</p>
            <p className="text-xs font-mono font-bold text-indigo-300 truncate">{roomId}</p>
          </div>
          <button
            onClick={handleCopyLink}
            className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center gap-1.5 transition-all"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Copied' : 'Share Link'}</span>
          </button>
        </div>

        {/* Participants list */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
            In Meeting ({allParticipants.length})
          </h3>

          {allParticipants.map((p) => {
            const isMe = p.id === localParticipant.id;
            return (
              <div
                key={p.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/50 hover:bg-slate-800/60 border border-slate-800/80 transition-all"
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${p.avatarColor} flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0`}
                  >
                    {p.name ? p.name.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-medium text-white truncate max-w-[120px]">
                        {p.name}
                      </span>
                      {isMe && <span className="text-[10px] text-indigo-400 font-normal">(You)</span>}
                      {p.isHost && (
                        <span title="Host">
                          <Crown className="w-3 h-3 text-amber-400 shrink-0" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  {p.isHandRaised && (
                    <div className="p-1 rounded-md bg-amber-500/20 text-amber-400" title="Hand Raised">
                      <Hand className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div
                    className={`p-1 rounded-md ${
                      p.isAudioEnabled ? 'text-slate-400' : 'text-rose-400 bg-rose-500/10'
                    }`}
                  >
                    {p.isAudioEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                  </div>
                  <div
                    className={`p-1 rounded-md ${
                      p.isVideoEnabled ? 'text-slate-400' : 'text-slate-500 bg-slate-800'
                    }`}
                  >
                    {p.isVideoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  </div>

                  {/* Host Kick Option */}
                  {isHost && !isMe && (
                    <button
                      onClick={() => onKickParticipant(p.id)}
                      className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-1"
                      title="Remove from meeting"
                    >
                      <UserX className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
