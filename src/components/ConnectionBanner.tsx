import React from 'react';
import { RefreshCw, Globe, CheckCircle2, Cloud } from 'lucide-react';
import { isSupabaseReady, RealtimeStatus } from '../lib/supabase';

interface ConnectionBannerProps {
  status?: RealtimeStatus;
}

export const ConnectionBanner: React.FC<ConnectionBannerProps> = ({ status }) => {
  if (!isSupabaseReady()) {
    return (
      <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/25 text-indigo-300 shadow-sm">
        <Globe className="w-4 h-4 mt-0.5 shrink-0 text-indigo-400" />
        <div className="text-[11px] leading-relaxed">
          <p className="font-semibold text-indigo-200">Local Mesh Mode (Active)</p>
          <p className="text-slate-400 mt-0.5">
            Zero-latency cross-tab signaling is enabled.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 shadow-sm animate-in fade-in duration-150">
        <RefreshCw className="w-4 h-4 shrink-0 animate-spin text-rose-400" />
        <p className="text-xs font-medium">Realtime connection lost — reconnecting to cloud…</p>
      </div>
    );
  }

  if (status === 'connected') {
    return (
      <div className="flex items-center justify-between p-2.5 px-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/25 text-emerald-300 shadow-sm text-xs animate-in fade-in duration-150">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold text-emerald-200">Cloud Realtime Connected</span>
        </div>
        <span className="text-[11px] text-emerald-400/80 font-mono">P2P Mesh + Supabase</span>
      </div>
    );
  }

  return null;
};
