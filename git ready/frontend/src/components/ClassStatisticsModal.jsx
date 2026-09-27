import React, { useState, useEffect } from 'react';
import { formatAttendancePercentage, getAcademicMonthOptions } from '../utils/attendance';
import { 
  X, BarChart3, TrendingUp, Users, BookOpen, 
  CheckCircle2, AlertTriangle, XCircle, Award, Calendar, Layers
} from 'lucide-react';
import CircularProgress from './CircularProgress';

export default function ClassStatisticsModal({ isOpen, onClose, currentMonth, onMonthChange, activeSemester }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth || '2026-09');

  const fetchStats = async (month) => {
    setLoading(true);
    try {
      const monthQuery = month ? `?month=${month}` : '';
      const res = await fetch(`/api/attendance/statistics${monthQuery}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch class statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentMonth && currentMonth !== selectedMonth) {
      setSelectedMonth(currentMonth);
    }
  }, [currentMonth]);

  useEffect(() => {
    if (isOpen) {
      fetchStats(selectedMonth);
    }
  }, [isOpen, selectedMonth]);

  if (!isOpen) return null;

  const months = getAcademicMonthOptions(activeSemester, selectedMonth);

  const classAvg = stats?.class_average || 0;
  let statusBadge = {
    title: "Class Average Healthy (>90%)",
    border: "border-emerald-200",
    bg: "bg-emerald-50 text-emerald-800",
    color: "green"
  };
  if (classAvg <= 90.0 && classAvg > 75.0) {
    statusBadge = {
      title: "Class Average Satisfactory (75% - 90%)",
      border: "border-amber-200",
      bg: "bg-amber-50 text-amber-800",
      color: "orange"
    };
  } else if (classAvg <= 75.0) {
    statusBadge = {
      title: "Class Average Below Cutoff (<75%)",
      border: "border-rose-200",
      bg: "bg-rose-50 text-rose-800",
      color: "red"
    };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center font-black text-white shadow-xs">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight">Class Attendance Statistics & Analytics</h3>
                <span className="bg-amber-500/20 text-amber-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border border-amber-500/30">
                  AUCE(A) CSE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Transparent class performance, subject-wise attendance, and admission category distribution.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Month Filter */}
            <div className="flex items-center space-x-1.5 bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-xl text-xs">
              <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <select
                value={selectedMonth}
                onChange={(e) => {
                  setSelectedMonth(e.target.value);
                  if (onMonthChange) onMonthChange(e.target.value);
                }}
                className="bg-transparent border-0 text-xs font-bold text-white focus:ring-0 cursor-pointer p-0"
              >
                {months.map(m => (
                  <option key={m.value} value={m.value} className="bg-slate-900 text-white">{m.label}</option>
                ))}
              </select>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-500">Calculating comprehensive class statistics...</p>
            </div>
          ) : !stats ? (
            <div className="py-16 text-center text-slate-500 text-xs">
              No statistics available for the selected month.
            </div>
          ) : (
            <>
              {/* Top Row: Overall Class Average & KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center bg-slate-50/80 rounded-2xl border border-slate-200/80 p-5">
                
                {/* Left: Big Circular Gauge for Class Average */}
                <div className="md:col-span-4 flex flex-col items-center justify-center text-center border-b md:border-b-0 md:border-r border-slate-200 pb-4 md:pb-0 md:pr-4">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                    Overall Class Average
                  </span>
                  <CircularProgress
                    percentage={stats.class_average}
                    colorToken={stats.color}
                    size={130}
                    strokeWidth={11}
                  />
                  <div className={`mt-3 px-3 py-1 rounded-full text-[11px] font-bold border ${statusBadge.bg} ${statusBadge.border}`}>
                    {statusBadge.title}
                  </div>
                </div>

                {/* Right: Key Summary Statistics */}
                <div className="md:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-white rounded-xl border border-slate-200/90 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total Enrolled</span>
                    <span className="text-xl font-black text-slate-900 font-mono mt-0.5 block">{stats.total_students}</span>
                    <span className="text-[10px] text-slate-500 font-medium">B.Tech CSE 3-1</span>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200/90 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Conducted Sessions</span>
                    <span className="text-xl font-black text-blue-700 font-mono mt-0.5 block">{stats.total_distinct_sessions}</span>
                    <span className="text-[10px] text-slate-500 font-medium">Classes Held</span>
                  </div>

                  <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">&gt; 90% Safe</span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                    <span className="text-xl font-black text-emerald-800 font-mono mt-0.5 block">{stats.distribution.safe_above_90}</span>
                    <span className="text-[10px] text-emerald-700 font-medium">Safe from Condonation</span>
                  </div>

                  <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">75% - 90% Satisfactory</span>
                      <TrendingUp className="w-3.5 h-3.5 text-amber-600" />
                    </div>
                    <span className="text-xl font-black text-amber-800 font-mono mt-0.5 block">{stats.distribution.moderate_75_90}</span>
                    <span className="text-[10px] text-amber-700 font-medium">Eligible for Exams</span>
                  </div>

                  <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-200 shadow-2xs col-span-2 sm:col-span-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">&lt; 75% Shortage</span>
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    </div>
                    <span className="text-xl font-black text-rose-800 font-mono mt-0.5 block">{stats.distribution.shortage_below_75}</span>
                    <span className="text-[10px] text-rose-700 font-medium">Condonation Risk</span>
                  </div>
                </div>

              </div>

              {/* 2. Subject-Wise Class Average Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-blue-600" />
                    <span>Subject-Wise Class Average Attendance</span>
                  </h4>
                  <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                    {stats.subjects.length} Subjects
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="py-2.5 px-3">Subject Code & Name</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Faculty Incharge</th>
                          <th className="py-2.5 px-3 text-center">Sessions Conducted</th>
                          <th className="py-2.5 px-3 text-right">Class Avg %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {stats.subjects.map((sub) => {
                          const badgeColor = sub.average_percentage > 90.0
                            ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                            : sub.average_percentage > 75.0
                              ? 'text-amber-800 bg-amber-50 border-amber-200'
                              : 'text-rose-800 bg-rose-50 border-rose-200';
                          return (
                            <tr key={sub.id} className="hover:bg-slate-50/60 transition">
                              <td className="py-2.5 px-3">
                                <span className="font-mono font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded mr-2 text-[11px]">
                                  {sub.code}
                                </span>
                                <span className="font-bold text-slate-800">{sub.name}</span>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                  sub.type === 'Lab' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {sub.type}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 truncate max-w-[180px]">
                                {sub.faculty_name}
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-700">
                                {sub.sessions_count}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border font-mono font-black text-xs ${badgeColor}`}>
                                  {formatAttendancePercentage(sub.average_percentage)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 3. Batch-Wise Lab Groups Breakdown */}
              {stats.batches && stats.batches.length > 0 && (
                <div className="bg-slate-50/60 rounded-2xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-blue-600" />
                      <span>Batch-Wise Lab Groups Performance</span>
                    </h5>
                    <span className="text-[10px] text-slate-400 font-mono">{stats.batches.length} Practical Batches</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {stats.batches.map((b, idx) => (
                      <div key={idx} className="p-3 bg-white rounded-xl border border-slate-200/80 flex items-center justify-between text-xs shadow-xs">
                        <div>
                          <span className="font-bold text-slate-800 block">{b.batch}</span>
                          <span className="text-[10px] text-slate-400 font-medium">({b.student_count} Students)</span>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg font-mono font-black text-xs border ${
                          b.average_percentage >= 75.0
                            ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                            : b.average_percentage >= 65.0
                              ? 'text-amber-800 bg-amber-50 border-amber-200'
                              : 'text-rose-800 bg-rose-50 border-rose-200'
                        }`}>
                          {formatAttendancePercentage(b.average_percentage)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Official AUCE(A) CSE Attendance Analytics • Dynamically Calculated</span>
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
