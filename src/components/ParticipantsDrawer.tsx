import React, { useEffect, useState } from 'react';
import {
  X, Users, Crown, Mic, MicOff, Video, VideoOff,
  Hand, UserX, Lock, Unlock, Copy, Check, ShieldCheck,
  UserPlus, CheckCircle2, XCircle, Search
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
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmKickId, setConfirmKickId] = useState<string | null>(null);

  const allParticipants = [localParticipant, ...remoteParticipants];
  const participantIds = allParticipants.map((p) => p.id).join(',');

  useEffect(() => {
    if (!isOpen) {
      setConfirmKickId(null);
      setSearchQuery('');
      return;
    }
    if (confirmKickId && !participantIds.split(',').includes(confirmKickId)) {
      setConfirmKickId(null);
    }
  }, [isOpen, participantIds, confirmKickId]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    sounds.playClick();
    const url = `${window.location.origin}/${roomId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleAdmitAll = () => {
    sounds.playClick();
    knockRequests.forEach((k) => onAdmitKnock(k));
  };

  const filteredParticipants = allParticipants.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <aside
      aria-label="Meeting Participants"
      className="fixed top-0 right-0 h-full w-full sm:w-96 z-50 glass-panel border-l border-slate-700/60 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 select-none"
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-white text-sm truncate">
              People ({allParticipants.length})
            </h2>
            <p className="text-[11px] text-slate-400 truncate">Manage participants & room access</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-all cursor-pointer shrink-0"
          aria-label="Close Participants Drawer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Search Input */}
        {allParticipants.length > 3 && (
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search people in call..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-dark-900/90 border border-slate-700/70 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}

        {/* Host Security Section */}
        {isHost && (
          <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-semibold text-white">Host Security</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                HOST
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div>
                <p className="text-xs text-slate-200 font-medium">Room Lock</p>
                <p className="text-[11px] text-slate-400">
                  {isRoomLocked ? 'New guests must knock to enter' : 'Open for anyone with code'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  onToggleRoomLock();
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isRoomLocked
                    ? 'bg-amber-500 text-dark-950 shadow-md shadow-amber-500/20'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
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
          <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-amber-400">
                <UserPlus className="w-4 h-4" />
                <span className="text-xs font-semibold">Waiting Room ({knockRequests.length})</span>
              </div>
              {knockRequests.length > 1 && (
                <button
                  onClick={handleAdmitAll}
                  className="text-[11px] font-semibold text-indigo-300 hover:text-indigo-200 transition-colors"
                >
                  Admit All
                </button>
              )}
            </div>

            <div className="space-y-2">
              {knockRequests.map((knock) => (
                <div
                  key={knock.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-dark-950/70 border border-slate-800"
                >
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                    <div
                      className={`w-7 h-7 rounded-lg bg-gradient-to-tr ${knock.avatarColor} flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0`}
                    >
                      {knock.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium text-white truncate min-w-0">
                      {knock.name}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      onClick={() => onAdmitKnock(knock)}
                      className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all cursor-pointer shadow-sm"
                      title="Admit to meeting"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDeclineKnock(knock.id)}
                      className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-all cursor-pointer shadow-sm"
                      title="Decline request"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Invite link share card */}
        <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/90 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <p className="text-[11px] font-medium text-slate-400">Meeting Code</p>
            <p className="text-xs font-mono font-bold text-indigo-300 truncate">{roomId}</p>
          </div>
          <button
            onClick={handleCopyLink}
            className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Copied' : 'Share Link'}</span>
          </button>
        </div>

        {/* Participants list */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">
            In Meeting ({filteredParticipants.length})
          </h3>

          {filteredParticipants.map((p) => {
            const isMe = p.id === localParticipant.id;

            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 p-2.5 rounded-2xl border transition-all bg-slate-900/50 hover:bg-slate-800/60 border-slate-800/80"
              >
                <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                  <div
                    className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${p.avatarColor} flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0`}
                  >
                    {p.name ? p.name.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <span className="text-xs font-medium text-white truncate min-w-0">
                        {p.name || 'Unnamed'}
                      </span>
                      {isMe && <span className="text-[10px] text-indigo-400 font-normal shrink-0">(You)</span>}
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
                    <div className="p-1 rounded-lg bg-amber-500/20 text-amber-400" title="Hand Raised">
                      <Hand className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div
                    className={`p-1 rounded-lg ${
                      p.isAudioEnabled ? 'text-slate-400' : 'text-rose-400 bg-rose-500/10'
                    }`}
                  >
                    {p.isAudioEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                  </div>
                  <div
                    className={`p-1 rounded-lg ${
                      p.isVideoEnabled ? 'text-slate-400' : 'text-slate-500 bg-slate-800'
                    }`}
                  >
                    {p.isVideoEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  </div>

                  {/* Host Kick Option */}
                  {isHost && !isMe && (
                    confirmKickId === p.id ? (
                      <div className="flex items-center gap-1 ml-1 animate-in fade-in duration-100">
                        <button
                          onClick={() => {
                            setConfirmKickId(null);
                            onKickParticipant(p.id);
                          }}
                          className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold transition-colors cursor-pointer"
                          title="Confirm removal"
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => setConfirmKickId(null)}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold border border-slate-700 transition-colors cursor-pointer"
                          title="Cancel"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmKickId(p.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-1 cursor-pointer"
                        title="Remove from meeting"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    )
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
