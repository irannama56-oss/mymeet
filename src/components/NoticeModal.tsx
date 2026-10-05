import React from 'react';
import { AlertCircle } from 'lucide-react';
import { sounds } from '../lib/sound';

interface NoticeModalProps {
  title: string;
  message: string;
  onClose: () => void;
}

export const NoticeModal: React.FC<NoticeModalProps> = ({ title, message, onClose }) => {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-dark-950/85 backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150">
      <div className="w-full max-w-sm p-6 sm:p-7 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl text-center space-y-5">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-xl shadow-rose-500/20">
          <AlertCircle className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <p className="text-xs text-slate-400 leading-relaxed">{message}</p>
        </div>

        <button
          onClick={() => {
            sounds.playClick();
            onClose();
          }}
          className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/30 cursor-pointer"
        >
          Understood
        </button>
      </div>
    </div>
  );
};
