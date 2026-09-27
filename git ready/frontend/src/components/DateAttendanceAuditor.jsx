import React, { useState, useEffect } from 'react';
import { 
  Calendar, Clock, Check, X, Search, Ban, Palmtree, 
  Users, CheckCircle2, AlertCircle, FileSearch
} from 'lucide-react';
import { getLocalDateISO } from '../utils/attendance';

export default function DateAttendanceAuditor({ defaultDate }) {
  const [selectedDate, setSelectedDate] = useState(() => {
    if (defaultDate) return defaultDate;
    return getLocalDateISO();
  });

  const [auditData, setAuditData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAudit = async (dateStr) => {
    setLoading(true);
    setSelectedSessionId(null);
    try {
      const res = await fetch(`/api/attendance/date-audit?date=${dateStr}`);
      const data = await res.json();
      setAuditData(data);
      if (data.sessions && data.sessions.length > 0) {
        setSelectedSessionId(data.sessions[0].id);
      }
    } catch (err) {
      console.error('Error fetching date audit:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit(selectedDate);
  }, [selectedDate]);

  const selectedSession = auditData?.sessions?.find(s => s.id === selectedSessionId) || auditData?.sessions?.[0];

  const filteredRecords = (selectedSession?.records || []).filter(r => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return r.name.toLowerCase().includes(q) || r.reg_no.includes(q);
  });

  return (
    <div className="space-y-6">
      
      {/* Date Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-blue-600" />
            <span>Attendance History & Date Auditor</span>
          </h3>
          <p className="text-xs text-slate-500">
            Audit marked attendance, conducted sessions, and cancelled classes for any day in the academic calendar.
          </p>
        </div>

        {/* Date Selector */}
        <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 p-1.5 rounded-xl">
          <Calendar className="w-4 h-4 text-blue-600 ml-2" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent border-0 text-xs font-bold text-slate-800 focus:ring-0 cursor-pointer"
          />
        </div>
      </div>

      {/* Holiday Notification if declared */}
      {auditData?.holiday && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-200 flex items-center justify-center text-amber-800 shrink-0">
            <Palmtree className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-amber-950 flex items-center gap-2">
              <span>Official Holiday: {auditData.holiday.title}</span>
            </div>
            {auditData.holiday.description && (
              <p className="text-xs text-amber-800/80 mt-0.5">{auditData.holiday.description}</p>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-16 text-center bg-white rounded-2xl border border-slate-200">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Auditing attendance logs for {selectedDate}...</p>
        </div>
      ) : !auditData || auditData.sessions.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
          <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
          <h4 className="text-sm font-bold text-slate-700">No attendance sessions recorded on this date</h4>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Classes may not have been scheduled or marked on {selectedDate}. Pick another date from the calendar above.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Recorded Sessions List */}
          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">
              Recorded Classes ({auditData.sessions.length})
            </h4>

            <div className="space-y-2">
              {auditData.sessions.map((sess) => {
                const isSelected = sess.id === selectedSessionId;
                const isCancelled = Boolean(sess.is_cancelled);
                return (
                  <div
                    key={sess.id}
                    onClick={() => setSelectedSessionId(sess.id)}
                    className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-blue-50/80 border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                        : isCancelled
                          ? 'bg-rose-50/40 border-rose-200'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-[10px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                          {sess.subject_code}
                        </span>
                        {isCancelled ? (
                          <span className="text-[10px] font-black text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                            Cancelled
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            {sess.present_count} / {sess.total_marked} Present
                          </span>
                        )}
                      </div>

                      <div className="font-bold text-xs text-slate-900 line-clamp-1">
                        {sess.subject_name}
                      </div>

                      {sess.faculty_name && (
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          Prof: {sess.faculty_name}
                        </div>
                      )}

                      {/* Who Marked This Session (CR / LR) */}
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 truncate max-w-[140px]">
                          👤 {sess.marked_by || 'CR'}
                        </span>
                        {sess.is_extra ? (
                          <span className="text-[10px] font-black text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                            ✨ Extra
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {isCancelled && sess.cancellation_reason && (
                      <div className="mt-2 p-1.5 bg-rose-100/70 rounded-lg text-[10px] text-rose-800 line-clamp-2">
                        Reason: {sess.cancellation_reason}
                      </div>
                    )}

                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span>{sess.slot_type} ({sess.batch})</span>
                      <span>{sess.start_time || 'Period'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Attendance Records for Selected Session */}
          <div className="lg:col-span-2">
            {selectedSession ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
                
                {/* Session Summary Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h4 className="text-base font-black text-slate-900">
                      {selectedSession.subject_name}
                    </h4>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">
                        {selectedSession.slot_type} • {selectedSession.batch} • {selectedDate} ({selectedSession.day_of_week})
                      </span>
                      <span className="text-[11px] font-bold text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                        <span>👤 Marked by: {selectedSession.marked_by || 'Authenticated staff'}</span>
                      </span>
                      {selectedSession.is_extra && (
                        <span className="text-[10px] font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                          ✨ Extra Class
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedSession.is_cancelled ? (
                    <div className="px-3 py-1.5 bg-rose-100 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-1.5">
                      <Ban className="w-4 h-4 text-rose-600" />
                      <span>Class Cancelled (Excluded from totals)</span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2 text-xs font-bold">
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl">
                        Present: {selectedSession.present_count}
                      </span>
                      <span className="px-3 py-1 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl">
                        Absent: {selectedSession.absent_count}
                      </span>
                    </div>
                  )}
                </div>

                {selectedSession.is_cancelled && (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-1">
                    <strong>Official Cancellation Reason:</strong>
                    <p className="italic">{selectedSession.cancellation_reason || 'No description entered'}</p>
                    <p className="text-[11px] text-rose-700/80 pt-1">
                      No attendance was charged against students for this session.
                    </p>
                  </div>
                )}

                {!selectedSession.is_cancelled && (
                  <>
                    {/* Search student in this session */}
                    <div className="relative w-full sm:w-72">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search student roll no or name..."
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    {/* Student List */}
                    <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-[440px]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50 text-slate-700 font-bold uppercase tracking-wider text-[10px] sticky top-0 border-b border-slate-200">
                          <tr>
                            <th className="p-2.5 font-mono">Reg. No</th>
                            <th className="p-2.5">Name</th>
                            <th className="p-2.5">Batch</th>
                            <th className="p-2.5 text-right">Attendance Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-800">
                          {filteredRecords.map((rec) => {
                            const isPresent = rec.status === 'Present';
                            return (
                              <tr key={rec.reg_no} className="hover:bg-slate-50/70 transition">
                                <td className="p-2.5 font-mono font-bold text-blue-700 whitespace-nowrap">
                                  {rec.reg_no}
                                </td>
                                <td className="p-2.5 font-semibold whitespace-nowrap">
                                  {rec.name}
                                </td>
                                <td className="p-2.5 text-slate-500 text-[11px] whitespace-nowrap">
                                  {rec.batch}
                                </td>
                                <td className="p-2.5 text-right whitespace-nowrap">
                                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                    isPresent 
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                      : 'bg-rose-100 text-rose-700 font-extrabold'
                                  }`}>
                                    {isPresent ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                    {rec.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

              </div>
            ) : null}
          </div>

        </div>
      )}

    </div>
  );
}
