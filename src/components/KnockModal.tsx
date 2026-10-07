import React from 'react';
import { Shield, Clock, X, Check, CheckCircle, AlertCircle, UserPlus } from 'lucide-react';
import { KnockRequest } from '../lib/types';
import { sounds } from '../lib/sound';

interface GuestWaitingScreenProps {
  roomName: string;
  onCancel: () => void;
  status: 'waiting' | 'declined';
}

export const GuestWaitingScreen: React.FC<GuestWaitingScreenProps> = ({
  roomName,
  onCancel,
  status,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/90 backdrop-blur-2xl">
      <div className="w-full max-w-md p-6 sm:p-8 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl text-center space-y-6 animate-in zoom-in-95 duration-200">
        
        {status === 'waiting' ? (
          <>
            <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-3xl border-2 border-indigo-500/30 animate-ping opacity-50" />
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-500/20">
                <Clock className="w-8 h-8 animate-pulse" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Waiting for Host Approval</h3>
              <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
                This meeting is locked. We've sent a knock request to the host of room{' '}
                <span className="font-mono text-indigo-300 font-semibold">{roomName}</span>. 
                You'll be admitted as soon as they accept.
              </p>
            </div>

            <button
              onClick={() => {
                sounds.playClick();
                onCancel();
              }}
              className="w-full py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-medium text-xs transition-all border border-slate-700 cursor-pointer shadow-md"
            >
              Cancel Request
            </button>
          </>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-xl shadow-rose-500/20">
              <AlertCircle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Request Declined</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                The host has declined your request to join this meeting room.
              </p>
            </div>

            <button
              onClick={() => {
                sounds.playClick();
                onCancel();
              }}
              className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/25 cursor-pointer"
            >
              Back to Lobby
            </button>
          </>
        )}
      </div>
    </div>
  );
};

interface HostKnockBannerProps {
  knockRequests: KnockRequest[];
  onAdmit: (knock: KnockRequest) => void;
  onDecline: (knockId: string) => void;
}

export const HostKnockBanner: React.FC<HostKnockBannerProps> = ({
  knockRequests,
  onAdmit,
  onDecline,
}) => {
  if (knockRequests.length === 0) return null;

  const currentKnock = knockRequests[0];

  return (
    <div className="fixed top-20 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 sm:w-full sm:max-w-md sm:px-4 animate-in slide-in-from-top duration-300">
      <div className="p-3 sm:p-4 rounded-3xl glass-dock border border-amber-500/40 shadow-2xl bg-dark-900/95 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
          <div
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr ${currentKnock.avatarColor} flex items-center justify-center text-sm font-bold text-white shadow-md shrink-0 border border-white/10`}
          >
            {currentKnock.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate">{currentKnock.name}</p>
            <p className="text-[11px] text-amber-400 font-medium truncate">Knocking to join the call</p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          <button
            onClick={() => onDecline(currentKnock.id)}
            className="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-300 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
          >
            Deny
          </button>
          <button
            onClick={() => onAdmit(currentKnock)}
            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
          >
            Admit
          </button>
        </div>
      </div>
    </div>
  );
};
