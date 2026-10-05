import React from 'react';
import { SearchX, Video, ArrowLeft } from 'lucide-react';
import { sounds } from '../lib/sound';

interface RoomNotFoundModalProps {
  roomId: string;
  onStart: () => void;
  onCancel: () => void;
}

export const RoomNotFoundModal: React.FC<RoomNotFoundModalProps> = ({
  roomId,
  onStart,
  onCancel,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/85 backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150">
      <div className="w-full max-w-md p-6 sm:p-8 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-xl shadow-amber-500/20">
          <SearchX className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-bold text-white">Meeting Not Found</h3>
          <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
            Nobody is hosting room{' '}
            <span className="font-mono text-indigo-300 font-semibold">{roomId}</span> right now.
            You can start this room as host, or check the code and try again.
          </p>
        </div>

        <div className="space-y-2.5">
          <button
            onClick={() => {
              sounds.playClick();
              onStart();
            }}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xl shadow-indigo-600/30 transition-all cursor-pointer"
          >
            <Video className="w-4 h-4" />
            Start This Meeting as Host
          </button>

          <button
            onClick={() => {
              sounds.playClick();
              onCancel();
            }}
            className="w-full py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-medium text-xs flex items-center justify-center gap-2 border border-slate-700 transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
};
