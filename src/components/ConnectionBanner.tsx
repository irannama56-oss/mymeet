import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isSupabaseReady, RealtimeStatus } from '../lib/supabase';

interface ConnectionBannerProps {
  status?: RealtimeStatus;
}

/**
 * Makes the transport state visible. Without this, a missing realtime backend made the
 * app look like it "created a new room" while the user was actually completely alone.
 */
export const ConnectionBanner: React.FC<ConnectionBannerProps> = ({ status }) => {
  if (!isSupabaseReady()) {
    return (
      <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="text-[11px] leading-relaxed">
          <p className="font-semibold text-amber-200">Realtime backend not configured</p>
          <p className="text-amber-300/80">
            Only tabs in this same browser can see each other. Add{' '}
            <span className="font-mono">VITE_SUPABASE_URL</span> and{' '}
            <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> to <span className="font-mono">.env</span>{' '}
            for meetings between different computers or phones.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300">
        <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
        <p className="text-[11px] font-medium">Realtime connection lost — reconnecting…</p>
      </div>
    );
  }

  return null;
};
