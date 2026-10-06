import React, { useState, useEffect, useCallback } from 'react';
import { 
  Shield, Users, Video, VideoOff, PhoneOff, Trash2, Plus, 
  RefreshCw, LogOut, Copy, Check, Lock, Unlock, ExternalLink,
  Search, Crown, ArrowLeft, Radio, Clock, AlertTriangle, Sparkles
} from 'lucide-react';
import { 
  adminGetAllRooms, 
  adminCloseRoom, 
  adminDeleteRoom, 
  adminCreateRoom, 
  adminGetStats, 
  adminLogout 
} from '../../lib/adminAuth';
import { AdminUser, AdminRoomSummary, AdminSystemStats, cleanRoomCode } from '../../lib/types';
import { sounds } from '../../lib/sound';

interface AdminDashboardProps {
  admin: AdminUser;
  onLogout: () => void;
  onJoinAsSuperAdmin: (roomCode: string) => void;
  onBackToApp: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  admin,
  onLogout,
  onJoinAsSuperAdmin,
  onBackToApp,
}) => {
  const [rooms, setRooms] = useState<AdminRoomSummary[]>([]);
  const [stats, setStats] = useState<AdminSystemStats>({
    totalRooms: 0,
    activeRooms: 0,
    closedRooms: 0,
    activeParticipants: 0,
    totalParticipants: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Create Room Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newRoomCode, setNewRoomCode] = useState('');
  const [newHostName, setNewHostName] = useState('Super Admin');
  const [newIsLocked, setNewIsLocked] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  // Action confirmations
  const [closingCode, setClosingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);

  const generateRandomCode = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const randStr = (len: number) => {
      let res = '';
      for (let i = 0; i < len; i++) {
        res += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return res;
    };
    return `${randStr(3)}-${randStr(4)}-${randStr(3)}`;
  };

  const loadData = useCallback(async (showIndicator = false) => {
    if (showIndicator) setRefreshing(true);
    try {
      const [fetchedRooms, fetchedStats] = await Promise.all([
        adminGetAllRooms(),
        adminGetStats(),
      ]);
      setRooms(fetchedRooms);
      setStats(fetchedStats);
    } catch (err) {
      console.warn('Error loading admin dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => {
      loadData(false);
    }, 6000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleCopyLink = (code: string) => {
    sounds.playClick();
    const url = `${window.location.origin}/${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleCloseMeeting = async (code: string) => {
    sounds.playClick();
    setClosingCode(code);
    try {
      await adminCloseRoom(code);
      sounds.playLeaveChime();
      await loadData(false);
    } finally {
      setClosingCode(null);
    }
  };

  const handleDeleteMeeting = async (code: string) => {
    sounds.playClick();
    setDeletingCode(code);
    try {
      await adminDeleteRoom(code);
      await loadData(false);
    } finally {
      setDeletingCode(null);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent, joinImmediately = false) => {
    e.preventDefault();
    setCreateLoading(true);
    sounds.playClick();

    const code = newRoomCode.trim() || generateRandomCode();
    try {
      const res = await adminCreateRoom({
        code,
        hostName: newHostName.trim() || 'Super Admin',
        isLocked: newIsLocked,
      });

      if (res.success) {
        setIsCreateModalOpen(false);
        setNewRoomCode('');
        await loadData(false);

        if (joinImmediately) {
          onJoinAsSuperAdmin(res.code);
        }
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const filteredRooms = rooms.filter((r) => {
    const matchesSearch =
      r.code.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
      r.hostName.toLowerCase().includes(searchQuery.toLowerCase().trim());
    if (!matchesSearch) return false;
    if (statusFilter === 'active') return r.status === 'active';
    if (statusFilter === 'closed') return r.status === 'closed';
    return true;
  });

  const formatTimestamp = (ts: string) => {
    if (!ts) return 'Unknown';
    try {
      const date = new Date(ts);
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-dark-950 via-dark-900 to-dark-950 text-slate-100 flex flex-col select-none">
      
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 glass-panel border-b border-slate-800/80 px-4 sm:px-8 py-3.5 flex items-center justify-between shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-600/25 border border-amber-400/30">
            <Shield className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-white">Aura Meet</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30 uppercase">
                Super Admin
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">{admin.email}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => {
              sounds.playClick();
              setNewRoomCode(generateRandomCode());
              setIsCreateModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Meeting</span>
          </button>

          <button
            onClick={() => {
              sounds.playClick();
              loadData(true);
            }}
            disabled={refreshing}
            className="p-2 rounded-xl glass-card text-slate-300 hover:text-white border border-slate-700/60 transition-all cursor-pointer"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            onClick={onBackToApp}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-card text-slate-300 hover:text-white text-xs font-medium border border-slate-700/60 transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Client Lobby</span>
          </button>

          <button
            onClick={() => {
              sounds.playLeaveChime();
              adminLogout();
              onLogout();
            }}
            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-all cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        
        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
          <div className="p-4 sm:p-5 rounded-3xl glass-panel border border-slate-800/90 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Live Meetings</span>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-white font-mono">
              {stats.activeRooms}
            </div>
            <p className="text-[11px] text-emerald-400 font-medium">Currently active & open</p>
          </div>

          <div className="p-4 sm:p-5 rounded-3xl glass-panel border border-slate-800/90 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Users</span>
              <Users className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-white font-mono">
              {stats.activeParticipants}
            </div>
            <p className="text-[11px] text-indigo-300 font-medium">Connected participants</p>
          </div>

          <div className="p-4 sm:p-5 rounded-3xl glass-panel border border-slate-800/90 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Rooms</span>
              <Video className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-white font-mono">
              {stats.totalRooms}
            </div>
            <p className="text-[11px] text-slate-400">Total sessions recorded</p>
          </div>

          <div className="p-4 sm:p-5 rounded-3xl glass-panel border border-slate-800/90 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Closed Sessions</span>
              <Clock className="w-4 h-4 text-slate-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-slate-300 font-mono">
              {stats.closedRooms}
            </div>
            <p className="text-[11px] text-slate-500">Ended meetings archive</p>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-4 rounded-3xl glass-panel border border-slate-800 flex flex-col sm:flex-row gap-3 items-center justify-between shadow-xl">
          
          {/* Search box */}
          <div className="relative flex items-center w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by code or host..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-dark-900/90 border border-slate-700/80 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
            />
          </div>

          {/* Status Tabs */}
          <div className="flex p-1 bg-dark-950/90 rounded-2xl border border-slate-800 w-full sm:w-auto">
            <button
              onClick={() => {
                sounds.playClick();
                setStatusFilter('all');
              }}
              className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-semibold rounded-xl transition-all ${
                statusFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({rooms.length})
            </button>
            <button
              onClick={() => {
                sounds.playClick();
                setStatusFilter('active');
              }}
              className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-semibold rounded-xl transition-all ${
                statusFilter === 'active'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Live Only ({rooms.filter((r) => r.status === 'active').length})
            </button>
            <button
              onClick={() => {
                sounds.playClick();
                setStatusFilter('closed');
              }}
              className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-semibold rounded-xl transition-all ${
                statusFilter === 'closed'
                  ? 'bg-slate-700 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Closed ({rooms.filter((r) => r.status === 'closed').length})
            </button>
          </div>
        </div>

        {/* Meeting Rooms Table */}
        <div className="rounded-3xl glass-panel border border-slate-800/90 shadow-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/90 bg-dark-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4 sm:px-6">Room Code</th>
                  <th className="py-3.5 px-4">Host Name</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Access</th>
                  <th className="py-3.5 px-4">Participants</th>
                  <th className="py-3.5 px-4">Created</th>
                  <th className="py-3.5 px-4 sm:px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                        <span>Loading meetings data...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredRooms.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500">
                      <VideoOff className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="font-semibold text-slate-400">No meetings found</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Create a meeting or wait for users to start one.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredRooms.map((room) => {
                    const isActive = room.status === 'active';
                    return (
                      <tr
                        key={room.id || room.code}
                        className="hover:bg-slate-800/40 transition-colors"
                      >
                        {/* Code */}
                        <td className="py-4 px-4 sm:px-6 font-mono font-bold text-indigo-300">
                          <div className="flex items-center space-x-2">
                            <span>{room.code}</span>
                            <button
                              onClick={() => handleCopyLink(room.code)}
                              className="p-1 rounded-lg hover:bg-slate-700/80 text-slate-400 hover:text-white transition-colors cursor-pointer"
                              title="Copy room link"
                            >
                              {copiedCode === room.code ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Host */}
                        <td className="py-4 px-4 font-medium text-slate-200">
                          <div className="flex items-center space-x-1.5">
                            <span className="truncate max-w-[140px]">{room.hostName}</span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-4 px-4">
                          {isActive ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold border border-emerald-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Live
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 text-[11px] font-medium border border-slate-700">
                              Ended
                            </span>
                          )}
                        </td>

                        {/* Access */}
                        <td className="py-4 px-4">
                          {room.isLocked ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                              <Lock className="w-3.5 h-3.5" />
                              Locked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                              <Unlock className="w-3.5 h-3.5" />
                              Open
                            </span>
                          )}
                        </td>

                        {/* Participants */}
                        <td className="py-4 px-4">
                          <div className="flex items-center space-x-1.5 text-slate-300 font-mono">
                            <Users className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="font-bold">{room.activeParticipantsCount}</span>
                            <span className="text-slate-500 text-[11px]">active</span>
                          </div>
                        </td>

                        {/* Created At */}
                        <td className="py-4 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                          {formatTimestamp(room.createdAt)}
                        </td>

                        {/* Actions */}
                        <td className="py-4 px-4 sm:px-6 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            {/* Join as Super Admin */}
                            <button
                              onClick={() => {
                                sounds.playJoinChime();
                                onJoinAsSuperAdmin(room.code);
                              }}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
                              title="Join meeting directly with Super Admin privileges"
                            >
                              <Crown className="w-3.5 h-3.5 text-amber-200" />
                              <span>Join as Super Admin</span>
                            </button>

                            {/* End Meeting */}
                            {isActive && (
                              <button
                                onClick={() => handleCloseMeeting(room.code)}
                                disabled={closingCode === room.code}
                                className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 transition-all cursor-pointer"
                                title="Force close meeting"
                              >
                                <PhoneOff className="w-4 h-4" />
                              </button>
                            )}

                            {/* Delete Meeting */}
                            <button
                              onClick={() => handleDeleteMeeting(room.code)}
                              disabled={deletingCode === room.code}
                              className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/80 text-slate-400 hover:text-rose-400 border border-slate-700 transition-all cursor-pointer"
                              title="Delete meeting record"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Create Meeting Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-md p-6 sm:p-7 rounded-3xl glass-panel border border-slate-700/80 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Create Meeting (Admin)</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => handleCreateSubmit(e, false)} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Room Code
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewRoomCode(generateRandomCode())}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    Randomize
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. team-sync or abc-defg-hij"
                  value={newRoomCode}
                  onChange={(e) => setNewRoomCode(cleanRoomCode(e.target.value))}
                  className="w-full px-3.5 py-2.5 bg-dark-900 border border-slate-700/80 rounded-xl text-xs text-indigo-300 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Host Name
                </label>
                <input
                  type="text"
                  placeholder="Super Admin"
                  value={newHostName}
                  onChange={(e) => setNewHostName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-dark-900 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="p-3.5 rounded-2xl bg-dark-900/80 border border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-white">Require Host Approval</p>
                  <p className="text-[11px] text-slate-400">Lock room on creation</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewIsLocked(!newIsLocked)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    newIsLocked ? 'bg-amber-500' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                      newIsLocked ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={(e) => handleCreateSubmit(e, true)}
                  disabled={createLoading}
                  className="py-3 px-3 rounded-2xl bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  <Crown className="w-3.5 h-3.5 text-amber-200" />
                  <span>Create & Join</span>
                </button>

                <button
                  type="submit"
                  disabled={createLoading}
                  className="py-3 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-semibold text-xs transition-all border border-slate-700 cursor-pointer"
                >
                  <span>Create Only</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
