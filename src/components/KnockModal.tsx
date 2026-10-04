import React from 'react';
import { Shield, Clock, X, Check, CheckCircle, AlertCircle } from 'lucide-react';
import { KnockRequest } from '../lib/types';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/90 backdrop-blur-xl">
      <div className="w-full max-w-md p-6 sm:p-8 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl text-center space-y-6 animate-in zoom-in-95 duration-200">
        
        {status === 'waiting' ? (
          <>
            <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-indigo-500/30 animate-ping" />
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                <Clock className="w-8 h-8 animate-pulse" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Waiting for Host Approval</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                This meeting is locked. We've sent a knock to the host of room{' '}
                <span className="font-mono text-indigo-300 font-semibold">{roomName}</span>. 
                You'll be admitted as soon as they accept.
              </p>
            </div>

            <button
              onClick={onCancel}
              className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs transition-all border border-slate-700"
            >
              Cancel Request
            </button>
          </>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <AlertCircle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Request Declined</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                The host has declined your request to join this meeting.
              </p>
            </div>

            <button
              onClick={onCancel}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/20"
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
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4 animate-in slide-in-from-top duration-300">
      <div className="p-4 rounded-2xl glass-panel border border-amber-500/40 shadow-2xl bg-dark-900/95 flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${currentKnock.avatarColor} flex items-center justify-center text-sm font-bold text-white shadow-md shrink-0`}
          >
            {currentKnock.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate">{currentKnock.name}</p>
            <p className="text-[11px] text-amber-400 font-medium">Wants to join the call</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => onDecline(currentKnock.id)}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:text-rose-400 text-slate-300 text-xs font-semibold border border-slate-700 transition-all"
          >
            Deny
          </button>
          <button
            onClick={() => onAdmit(currentKnock)}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all"
          >
            Admit
          </button>
        </div>
      </div>
    </div>
  );
};
