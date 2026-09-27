import React, { useState, useEffect } from 'react';
import { X, Radio, Clock, Calendar, CheckCircle2, XCircle, Trash2, Loader2 } from 'lucide-react';

export default function RecentSessionsFeedModal({ isOpen, onClose, token, user }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState('');

  const canManage = user && (user.role === 'cr' || user.role === 'lr' || user.role === 'admin');

  const fetchRecent = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/student/recent-sessions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch recent attendance sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRecent();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRemove = async (session) => {
    const label = `${session.subject_code} • ${session.date}`;
    if (!window.confirm(
      `Remove this marked session (${label})?\n\nThis permanently deletes the attendance records for every student in this class and cannot be undone. The removal will be written to the Attendance Change Log.`
    )) {
      return;
    }
    setError('');
    setRemovingId(session.session_id);
    try {
      const res = await fetch(`/api/attendance/session/${session.session_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Failed to remove session');
      setSessions(prev => prev.filter(s => s.session_id !== session.session_id));
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">Recent Attendance Live Feed</h3>
              <p className="text-[11px] text-slate-400">
                Live stream of latest classes marked by your CR / LR
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-3">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs font-medium text-slate-500">Checking latest updates...</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <Clock className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-600">No attendance sessions recorded yet</p>
              <p className="text-xs text-slate-400">
                When your CR or LR marks attendance for a class, it will appear here immediately.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sessions.map((s) => {
                const isPresent = s.status === 'PRESENT';
                const isRemoving = removingId === s.session_id;
                return (
                  <div 
                    key={s.session_id} 
                    className="p-4 bg-slate-50/70 hover:bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black text-slate-900">{s.subject_code}</span>
                        <span className="text-xs font-bold text-slate-800">• {s.subject_name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {s.date}
                        </span>
                        <span>{s.start_time} - {s.end_time}</span>
                        <span className="text-indigo-600 font-medium">
                          Marked by: <strong className="text-indigo-900">{s.marked_by}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0 self-start sm:self-auto flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-black font-mono flex items-center gap-1.5 border ${
                        isPresent 
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                          : 'bg-rose-100 text-rose-800 border-rose-300'
                      }`}>
                        {isPresent ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        <span>{s.status}</span>
                      </span>

                      {canManage && (
                        <button
                          onClick={() => handleRemove(s)}
                          disabled={isRemoving}
                          title="Remove this marked session for everyone (logged in Attendance Change Log)"
                          className="w-8 h-8 rounded-full border border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:border-rose-400 flex items-center justify-center transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isRemoving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>
            Real-time AUCE(A) Attendance Feed
            {canManage && <span className="hidden sm:inline"> • Tap <Trash2 className="w-3 h-3 inline -mt-0.5 text-rose-500" /> to remove a wrongly marked session</span>}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
