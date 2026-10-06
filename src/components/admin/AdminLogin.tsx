import React, { useState } from 'react';
import { Shield, Key, Mail, Eye, EyeOff, ArrowRight, ArrowLeft, Lock, Sparkles, Radio } from 'lucide-react';
import { adminLogin } from '../../lib/adminAuth';
import { AdminUser } from '../../lib/types';
import { sounds } from '../../lib/sound';

interface AdminLoginProps {
  onSuccess: (admin: AdminUser) => void;
  onBackToApp: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onSuccess, onBackToApp }) => {
  const [email, setEmail] = useState('mohammad.m.sadeghi98@gmail.com');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setLoading(true);
    setErrorMessage('');
    sounds.playClick();

    try {
      const res = await adminLogin(email.trim(), password);
      if (res.success && res.admin) {
        sounds.playJoinChime();
        onSuccess(res.admin);
      } else {
        sounds.playErrorTone();
        setErrorMessage(res.error || 'Invalid credentials');
      }
    } catch (err: any) {
      sounds.playErrorTone();
      setErrorMessage(err.message || 'Authentication error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 bg-gradient-to-br from-dark-950 via-dark-900 to-dark-950 overflow-hidden select-none">
      {/* Ambient background glows */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Back button */}
      <button
        onClick={onBackToApp}
        className="absolute top-6 left-6 flex items-center gap-2 px-3.5 py-2 rounded-2xl glass-panel text-slate-300 hover:text-white text-xs font-medium border border-slate-700/60 transition-all cursor-pointer shadow-lg"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Meet</span>
      </button>

      {/* Login Card */}
      <div className="w-full max-w-md p-7 sm:p-9 rounded-3xl glass-panel border border-slate-700/60 shadow-2xl space-y-6 relative animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-tr from-amber-500 via-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-xl shadow-indigo-600/30 border border-white/20">
            <Shield className="w-8 h-8 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white">Super Admin</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30 uppercase">
                Panel
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Authenticate to manage live rooms, participants & server controls
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium animate-in fade-in duration-150 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Admin Email
            </label>
            <div className="relative flex items-center">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none" />
              <input
                type="email"
                required
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3.5 bg-dark-900/90 border border-slate-700/80 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Password
            </label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-11 py-3.5 bg-dark-900/90 border border-slate-700/80 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-xs"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-indigo-600 to-violet-600 hover:from-amber-400 hover:to-violet-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xl shadow-indigo-600/30 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer group"
          >
            {loading ? (
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <>
                <span>Sign In to Admin Console</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

        <div className="pt-2 text-center text-[11px] text-slate-500">
          <span>Protected with SHA-256 secure hash verification</span>
        </div>
      </div>
    </div>
  );
};
