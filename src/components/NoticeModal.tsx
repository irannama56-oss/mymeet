import React from 'react';
import { AlertCircle } from 'lucide-react';

interface NoticeModalProps {
  title: string;
  message: string;
  onClose: () => void;
}

/**
 * Replaces `window.alert()`, which blocks the whole page (including the WebRTC event
 * loop) and freezes the UI while a call is being torn down.
 */
export const NoticeModal: React.FC<NoticeModalProps> = ({ title, message, onClose }) => {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-dark-950/85 backdrop-blur-xl">
      <div className="w-full max-w-sm p-6 sm:p-7 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl text-center space-y-5">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-rose-400">
          <AlertCircle className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <p className="text-xs text-slate-400 leading-relaxed">{message}</p>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/25"
        >
          OK
        </button>
      </div>
    </div>
  );
};
