import React, { useState, useEffect } from 'react';
import { X, History, UserCheck, Search, Calendar, ShieldCheck, ArrowRight, Clock, AlertCircle } from 'lucide-react';

export default function AttendanceAuditLogsModal({ isOpen, onClose, regNo = null }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const query = regNo ? `?reg_no=${encodeURIComponent(regNo)}` : '';
      const res = await fetch(`/api/attendance/audit-logs${query}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch attendance audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, regNo]);

  if (!isOpen) return null;

  const filteredLogs = logs.filter(l => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    const changer = l.changed_by || l.changer_name || '';
    return (
      (l.student_name && l.student_name.toLowerCase().includes(q)) ||
      (l.student_reg_no && l.student_reg_no.includes(q)) ||
      (l.subject_name && l.subject_name.toLowerCase().includes(q)) ||
      (changer.toLowerCase().includes(q)) ||
      (l.date && l.date.includes(q))
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">Attendance Modification Audit Logs</h3>
              <p className="text-[11px] text-slate-400">
                {regNo ? `Audit trail for Roll ${regNo}` : 'System-wide record of attendance corrections and edits'}
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

        {/* Filter Toolbar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by student roll, name, subject, or editor..."
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <span className="text-xs font-bold text-slate-500 font-mono">
            {filteredLogs.length} Records Logged
          </span>
        </div>

        {/* Content Table / Feed */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs font-medium text-slate-500">Loading audit history...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto opacity-70" />
              <p className="text-sm font-bold text-slate-600">No attendance edits recorded yet</p>
              <p className="text-xs text-slate-400">
                Whenever an already-marked attendance session is edited, the changer and status changes will be securely logged here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-black tracking-wider text-[10px]">
                    <th className="py-2.5 px-3 whitespace-nowrap">Class Date</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Subject</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Student</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Status Change</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Changed By</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLogs.map((log) => {
                    const prevStatus = (log.previous_status || log.old_status || 'Absent').toString();
                    const newStatus = (log.new_status || 'Present').toString();
                    const isRemoved = newStatus.toUpperCase() === 'REMOVED';
                    const isPrevPresent = prevStatus.toUpperCase() === 'PRESENT';
                    const isNowPresent = newStatus.toUpperCase() === 'PRESENT';
                    const changer = log.changed_by || log.changer_name || 'CR/LR';
                    return (
                      <tr key={log.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                          {log.date}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-800 whitespace-nowrap">
                          {log.subject_name || 'Subject'}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-bold text-slate-900">{log.student_name}</div>
                          <div className="text-[10px] font-mono text-slate-400">{log.student_reg_no}</div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center space-x-1.5 font-bold font-mono text-xs">
                            <span className={`px-2 py-0.5 rounded ${
                              isPrevPresent ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {prevStatus.toUpperCase()}
                            </span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span className={`px-2 py-0.5 rounded ${
                              isRemoved ? 'bg-slate-200 text-slate-700' : (isNowPresent ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800')
                            }`}>
                              {newStatus.toUpperCase()}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center space-x-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            <span className="font-bold text-slate-800">{changer}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Protected AUCE(A) CSE Attendance Modification Ledger</span>
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
