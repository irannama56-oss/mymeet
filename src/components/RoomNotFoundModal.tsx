import React from 'react';
import { SearchX, Video, ArrowLeft } from 'lucide-react';

interface RoomNotFoundModalProps {
  roomId: string;
  onStart: () => void;
  onCancel: () => void;
}

/**
 * Shown when a guest tried to join a room code that nobody is hosting.
 * Previously the app silently dropped the user into an empty room, which looked
 * exactly like "a brand new meeting was created" instead of joining the real one.
 */
export const RoomNotFoundModal: React.FC<RoomNotFoundModalProps> = ({
  roomId,
  onStart,
  onCancel,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/85 backdrop-blur-xl">
      <div className="w-full max-w-md p-6 sm:p-8 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
          <SearchX className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-bold text-white">Meeting not found</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Nobody is hosting room{' '}
            <span className="font-mono text-indigo-300 font-semibold">{roomId}</span> right now.
            Check the code, or open it and become the host.
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={onStart}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 transition-all"
          >
            <Video className="w-4 h-4" />
            Start this meeting as host
          </button>

          <button
            onClick={onCancel}
            className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs flex items-center justify-center gap-2 border border-slate-700 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to lobby
          </button>
        </div>
      </div>
    </div>
  );
};
