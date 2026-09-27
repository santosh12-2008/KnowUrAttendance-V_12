import React, { useState, useEffect } from 'react';
import { 
  User, Mail, Phone, Award, FileText, CheckCircle2, 
  XCircle, AlertTriangle, BookOpen, Clock, Calendar, RefreshCw, ChevronRight,
  FileSpreadsheet, Ban, Check, Send, X, FileSearch, BarChart2,
  Menu, Radio, History, ShieldCheck, AlertCircle, HelpCircle, KeyRound
} from 'lucide-react';
import CircularProgress from './CircularProgress';
import { getAcademicMonthOptions } from '../utils/attendance';
import DateAttendanceAuditor from './DateAttendanceAuditor';
import ClassStatisticsModal from './ClassStatisticsModal';
import RecentSessionsFeedModal from './RecentSessionsFeedModal';
import AttendanceAuditLogsModal from './AttendanceAuditLogsModal';
import StudentHelpdeskModal from './StudentHelpdeskModal';
import StudentChangePasswordModal from './StudentChangePasswordModal';

export default function StudentDashboard({ user, token, currentMonth, activeSemester }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(currentMonth || 'all');

  // Keep the dashboard's own month selection in sync with the semester's active month
  // whenever it changes upstream (e.g. the CR updates it in the header, or the active
  // semester itself changes). Previously this state was only ever initialised once on
  // mount, so a CR-side semester/span change never reached an already-open student
  // dashboard - this effect is what actually fixes that.
  useEffect(() => {
    if (currentMonth && currentMonth !== selectedMonth) {
      setSelectedMonth(currentMonth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth]);

  // The selectable months always reflect the real semester span (start_month..end_month)
  // configured in the CR portal, instead of a fixed/hardcoded list - so the dashboard
  // never has "missing" months again when a CR extends or changes the semester.
  const monthOptions = React.useMemo(
    () => getAcademicMonthOptions(activeSemester, selectedMonth),
    [activeSemester?.start_month, activeSemester?.end_month, selectedMonth]
  );

  // Department Forms State
  const [activeForms, setActiveForms] = useState([]);
  const [selectedFormToFill, setSelectedFormToFill] = useState(null);
  const [formResponses, setFormResponses] = useState({});
  const [submittingForm, setSubmittingForm] = useState(false);
  const [formSuccessMsg, setFormSuccessMsg] = useState('');
  const [showAuditor, setShowAuditor] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showStudentMenu, setShowStudentMenu] = useState(false);
  const [showRecentSessions, setShowRecentSessions] = useState(false);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [showHelpdeskModal, setShowHelpdeskModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);

  const fetchActiveForms = async () => {
    try {
      const res = await fetch('/api/forms/active', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const forms = await res.json();
        setActiveForms(forms);
      }
    } catch (err) {
      console.error('Error fetching active department forms:', err);
    }
  };

  const fetchDashboardData = async (month) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (month) params.append('month', month);
      if (user?.reg_no) params.append('reg_no', user.reg_no);
      const queryString = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/student/dashboard${queryString}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error('Failed to load attendance records');
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData(selectedMonth);
    fetchActiveForms();
  }, [selectedMonth, user?.reg_no]);

  const handleOpenFormModal = (form) => {
    setSelectedFormToFill(form);
    setFormResponses(form.my_response || {});
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (!selectedFormToFill) return;
    setSubmittingForm(true);
    try {
      const res = await fetch(`/api/forms/${selectedFormToFill.id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ responses: formResponses })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to submit form responses');
      setFormSuccessMsg(`Response for "${selectedFormToFill.title}" submitted successfully to CR for Excel records!`);
      setSelectedFormToFill(null);
      fetchActiveForms();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmittingForm(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold text-slate-600">Calculating real-time attendance for {user.reg_no}...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 bg-red-50 border border-red-200 rounded-2xl text-center">
        <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-2" />
        <h3 className="text-base font-bold text-red-800">Error Loading Attendance</h3>
        <p className="text-xs text-red-600 mt-1">{error || 'Could not retrieve attendance data'}</p>
        <button 
          onClick={() => fetchDashboardData(selectedMonth)} 
          className="mt-4 px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-lg shadow-xs hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  const { student, overall, subjects, recent_sessions } = data;

  // Status message and color tokens based on dynamic overall percentage
  let statusBadge = {
    title: "Safe & Eligible",
    desc: "Your attendance is well above the required threshold (>90%). Excellent consistency!",
    border: "border-emerald-200",
    bg: "bg-emerald-50/70",
    text: "text-emerald-800",
    badgeBg: "bg-emerald-600",
    icon: CheckCircle2
  };

  if (overall.percentage <= 90.0 && overall.percentage > 75.0) {
    statusBadge = {
      title: "Average Attendance",
      desc: `You have satisfied the minimum university 75% cutoff. Attend ${overall.classes_for_90} more consecutive classes to reach 90%!`,
      border: "border-amber-200",
      bg: "bg-amber-50/70",
      text: "text-amber-800",
      badgeBg: "bg-amber-600",
      icon: AlertTriangle
    };
  } else if (overall.percentage <= 75.0) {
    statusBadge = {
      title: "Attendance Shortage (Critical)",
      desc: `Attendance is below university mandatory 75% cutoff. You need ${overall.classes_for_75} consecutive classes to clear condonation!`,
      border: "border-red-200",
      bg: "bg-red-50/70",
      text: "text-red-800",
      badgeBg: "bg-red-600",
      icon: XCircle
    };
  }

  const StatusIcon = statusBadge.icon;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

      {/* Department Data Collection Notice */}
      {activeForms && activeForms.length > 0 && (
        <div className="space-y-3">
          {activeForms.map((form) => (
            <div 
              key={form.id} 
              className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs ${
                form.submitted 
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' 
                  : 'bg-amber-50 border-amber-300 text-amber-950 ring-2 ring-amber-400/20'
              }`}
            >
              <div className="flex items-start space-x-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  form.submitted ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'
                }`}>
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-wider ${
                      form.submitted ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
                    }`}>
                      {form.submitted ? 'Submitted to CR' : 'Department Action Required'}
                    </span>
                    <h4 className="text-sm font-bold">{form.title}</h4>
                  </div>
                  {form.description && (
                    <p className="text-xs opacity-85 mt-0.5">{form.description}</p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleOpenFormModal(form)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shrink-0 cursor-pointer shadow-xs ${
                  form.submitted 
                    ? 'bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300' 
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
              >
                {form.submitted ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                <span>{form.submitted ? 'View / Edit My Response' : 'Fill Details for Department'}</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Form Submission Success Alert */}
      {formSuccessMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{formSuccessMsg}</span>
          </div>
          <button onClick={() => setFormSuccessMsg('')} className="text-emerald-700 hover:text-emerald-900 font-bold cursor-pointer">
            Dismiss
          </button>
        </div>
      )}
      {/* Dropped Student Alert Banner */}
      {student.is_dropped && (
        <div className="p-4 bg-rose-50 border-2 border-rose-300 text-rose-900 rounded-2xl flex items-start gap-3 shadow-xs">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-rose-800 flex items-center gap-2">
              <span>Student Dropped from College</span>
              <span className="bg-rose-600 text-white text-[9px] px-2 py-0.2 rounded-full">INACTIVE</span>
            </h4>
            <p className="text-xs text-rose-700">
              This student is officially recorded as dropped from the college on <strong>{student.dropped_date || 'N/A'}</strong> (Reason: <em>"{student.dropped_reason || 'Left College'}"</em>). Future attendance marking is suspended and this student is excluded from class average analytics.
            </p>
          </div>
        </div>
      )}

      {/* 1. Student Profile Details Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center text-2xl font-black shadow-md">
              {student.name.charAt(0)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 whitespace-nowrap">{student.name}</h2>
                {student.is_dropped ? (
                  <span className="bg-rose-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 shadow-2xs">
                    DROPPED
                  </span>
                ) : null}
                <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0">
                  {student.batch}
                </span>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                  student.category === 'Foreigners' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                  student.category === 'Sweden Batch' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  student.category === 'Lateral Entry' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                  'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                  {student.category || 'EAPCET Admission'}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5 whitespace-nowrap">
                Reg No: <span className="font-bold text-slate-800">{student.reg_no}</span>
              </p>
            </div>
          </div>

          {/* Student Menu Drawer Trigger & Month Selector */}
          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            {/* Student Menu Trigger Button */}
            <button
              type="button"
              onClick={() => setShowStudentMenu(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
              title="Open Student Menu & Live Feed"
            >
              <Menu className="w-4 h-4 text-blue-400" />
              <span>Student Menu</span>
            </button>

            {/* Quick Live Feed Button */}
            <button
              onClick={() => setShowRecentSessions(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap"
              title="View live feed of recent marked sessions"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse shrink-0" />
              <span>Live Feed</span>
            </button>

            {/* Class Stats Button */}
            <button
              onClick={() => setShowStatsModal(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap"
              title="View class-wide averages and statistics"
            >
              <BarChart2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Class Stats</span>
            </button>

            {/* Month Selector */}
            <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
              <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Month:</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent border-0 text-xs font-bold text-slate-800 focus:ring-0 cursor-pointer"
              >
                {monthOptions.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Auditor Component when toggled */}
        {showAuditor && (
          <div className="pt-6 pb-2 border-b border-slate-200 animate-in fade-in">
            <DateAttendanceAuditor defaultDate={getLocalDateISO()} />
          </div>
        )}

        {/* Details Grid: Reg.no, name, email, mobile, batch, category, admission no */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-5 text-xs">
          <div className="p-3 bg-slate-50/70 rounded-xl border border-slate-100">
            <span className="block text-slate-400 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap">Registration No</span>
            <span className="font-mono font-bold text-slate-800 text-sm whitespace-nowrap">{student.reg_no}</span>
          </div>

          <div className="p-3 bg-slate-50/70 rounded-xl border border-slate-100">
            <span className="block text-slate-400 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap">Full Name</span>
            <span className="font-bold text-slate-800 truncate block text-sm" title={student.name}>{student.name}</span>
          </div>

          <div className="p-3 bg-slate-50/70 rounded-xl border border-slate-100">
            <span className="block text-slate-400 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap">Student Email</span>
            <span className="font-medium text-slate-700 truncate block text-xs font-mono" title={student.email}>{student.email || 'N/A'}</span>
          </div>

          <div className="p-3 bg-slate-50/70 rounded-xl border border-slate-100">
            <span className="block text-slate-400 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap">Mobile Number</span>
            <span className="font-medium text-slate-700 text-xs whitespace-nowrap">{student.mobile || 'N/A'}</span>
          </div>

          <div className="p-3 bg-slate-50/70 rounded-xl border border-slate-100">
            <span className="block text-slate-400 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap">Batch & Lab Group</span>
            <span className="font-bold text-indigo-700 text-sm whitespace-nowrap">{student.batch}</span>
          </div>

          <div className="p-3 bg-slate-50/70 rounded-xl border border-slate-100">
            <span className="block text-slate-400 font-bold uppercase tracking-wider text-[10px] whitespace-nowrap">Admission & Joining</span>
            <span className="font-bold text-slate-800 block truncate text-xs" title={`${student.category || 'EAPCET Admission'} • ${student.admission_no || ''}`}>
              {student.category || 'EAPCET Admission'}
            </span>
            {student.category === 'Lateral Entry' ? (
              <span className="text-[10px] text-amber-700 font-medium flex items-center gap-1 mt-0.5 whitespace-nowrap" title="Attendance is calculated starting from this joining date">
                <Calendar className="w-3 h-3 text-amber-600 shrink-0" />
                Joined: {student.joining_date || '2026-09-01'}
              </span>
            ) : (
              <span className="text-[10px] text-slate-400 font-mono block truncate">{student.admission_no || 'AUCE-CSE'}</span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Main Attendance Layout: Subject-wise on LEFT, Big Overall on RIGHT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT SIDE (8 cols on lg): Subject-wise Attendance with Small Circles */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-600" />
                <span>Subject-Wise Attendance</span>
              </h3>
              <p className="text-xs text-slate-500">
                Live calculated breakdown based on conducted and attended class sessions.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
              {subjects.length} Subjects
            </span>
          </div>

          {/* Grid of Subject Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {subjects.map((sub) => (
              <div 
                key={sub.id} 
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                          {sub.code}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                          sub.type === 'Lab' 
                            ? 'bg-purple-50 text-purple-700 border border-purple-200' 
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {sub.type}
                        </span>
                      </div>
                      <h4 className="font-bold text-sm text-slate-900 mt-1.5 truncate" title={sub.name}>
                        {sub.name}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate" title={sub.faculty_name}>
                        {sub.faculty_name}
                      </p>
                    </div>

                    {/* Small Circular Animation Progress Meter */}
                    <div className="shrink-0 ml-2">
                      <CircularProgress
                        percentage={sub.percentage}
                        size={68}
                        strokeWidth={6}
                        color={sub.color}
                        showPercentage={true}
                      />
                    </div>
                  </div>
                </div>

                {/* Subject Statistics Pills */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
                  <div className="bg-slate-50 p-1.5 rounded-lg">
                    <span className="block text-[9px] font-bold uppercase text-slate-400">Conducted</span>
                    <span className="font-mono font-bold text-xs text-slate-800">{sub.conducted}</span>
                  </div>
                  <div className="bg-emerald-50 p-1.5 rounded-lg">
                    <span className="block text-[9px] font-bold uppercase text-emerald-600">Attended</span>
                    <span className="font-mono font-bold text-xs text-emerald-800">{sub.attended}</span>
                  </div>
                  <div className="bg-red-50 p-1.5 rounded-lg">
                    <span className="block text-[9px] font-bold uppercase text-red-600">Missed</span>
                    <span className="font-mono font-bold text-xs text-red-800">{sub.missed}</span>
                  </div>
                </div>

              </div>
            ))}
          </div>

          {/* Recent Attendance Session Logs */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs mt-6">
            <h4 className="font-bold text-sm text-slate-900 mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <span>Recent Class Log ({recent_sessions.length} records)</span>
            </h4>
            
            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto pr-1">
              {recent_sessions.map((rec) => {
                const sub = subjects.find(s => s.id === rec.subject_id) || {};
                const isPresent = rec.status === 'Present';
                return (
                  <div key={rec.session_id} className="py-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        isPresent ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {isPresent ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      </div>
                      <div>
                        <div className="font-bold text-slate-800">
                          {sub.name || 'Subject'} <span className="font-mono font-normal text-slate-400">({sub.code})</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {rec.date} • {rec.day_of_week} • <span className="uppercase text-[10px] font-semibold">{rec.slot_type}</span>
                        </div>
                      </div>
                    </div>

                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      isPresent ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {rec.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cancelled Class Sessions (Excluded from totals) */}
          {data.cancelled_sessions && data.cancelled_sessions.length > 0 && (
            <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-5 shadow-xs mt-6">
              <h4 className="font-bold text-sm text-rose-900 mb-2 flex items-center gap-2">
                <Ban className="w-4 h-4 text-rose-700" />
                <span>Cancelled Class Sessions ({data.cancelled_sessions.length})</span>
              </h4>
              <p className="text-[11px] text-rose-700 mb-3">
                These classes were officially cancelled by the CR with declared reasons and are strictly excluded from your conducted count so your attendance percentage is not affected.
              </p>
              <div className="space-y-2">
                {data.cancelled_sessions.map((cs) => (
                  <div key={cs.id} className="p-3 bg-white rounded-xl border border-rose-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900">{cs.subject_name} ({cs.subject_code})</div>
                      <div className="text-[11px] text-slate-500">{cs.date} • {cs.day_of_week} • {cs.start_time} - {cs.end_time}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">Cancelled</span>
                      <div className="text-[11px] text-slate-600 italic mt-0.5">"{cs.cancellation_reason || 'Class cancelled'}"</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* RIGHT SIDE (4 cols on lg): Overall Attendance with BIG CIRCLE ANIMATION */}
        <div className="lg:col-span-4 space-y-6">
          
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col items-center text-center relative overflow-hidden">
            
            {/* Header */}
            <div className="mb-2">
              <span className="text-[11px] font-black tracking-widest text-slate-400 uppercase">
                Overall Metric
              </span>
              <h3 className="text-xl font-black text-slate-900">Total Attendance</h3>
            </div>

            {/* BIG CIRCULAR ANIMATION METER */}
            <div className="my-6 relative">
              <CircularProgress
                percentage={overall.percentage}
                size={230}
                strokeWidth={18}
                color={overall.color}
                label="Overall"
                sublabel={`${overall.attended} / ${overall.conducted} classes`}
              />
            </div>

            {/* Dynamic Status Alert Box */}
            <div className={`w-full p-4 rounded-2xl border ${statusBadge.border} ${statusBadge.bg} text-left mb-5`}>
              <div className="flex items-center space-x-2">
                <StatusIcon className={`w-5 h-5 ${statusBadge.text} shrink-0`} />
                <h5 className={`font-bold text-xs ${statusBadge.text}`}>{statusBadge.title}</h5>
              </div>
              <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
                {statusBadge.desc}
              </p>
            </div>

            {/* Detailed Aggregate Numbers */}
            <div className="w-full grid grid-cols-3 gap-2 text-center">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Conducted</span>
                <span className="text-lg font-black text-slate-900 font-mono">{overall.conducted}</span>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Attended</span>
                <span className="text-lg font-black text-emerald-800 font-mono">{overall.attended}</span>
              </div>
              <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider block">Missed</span>
                <span className="text-lg font-black text-red-800 font-mono">{overall.missed}</span>
              </div>
            </div>

            {/* University Regulations Notice */}
            <div className="mt-6 pt-4 border-t border-slate-100 text-[11px] text-slate-400 text-left w-full space-y-1">
              <div className="font-bold text-slate-600">AUCE(A) Regulations:</div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>&gt; 90%: Eligible with Honours/Distinction</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>75% – 90%: Standard Examination Eligibility</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span>&lt; 75%: Condonation Shortage / Debarment Risk</span>
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* Form Filling Modal */}
      {selectedFormToFill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">{selectedFormToFill.title}</h4>
                <p className="text-xs text-slate-500">Student: {student.name} ({student.reg_no})</p>
              </div>
            </div>

            {selectedFormToFill.description && (
              <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
                {selectedFormToFill.description}
              </p>
            )}

            <form onSubmit={handleSubmitForm} className="space-y-4 text-xs">
              {selectedFormToFill.fields?.map((field) => (
                <div key={field.key}>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={field.type || "text"}
                    required={field.required}
                    value={formResponses[field.key] || ''}
                    onChange={(e) => setFormResponses({ ...formResponses, [field.key]: e.target.value })}
                    placeholder={`Enter ${field.label}...`}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              ))}

              <div className="pt-2 flex items-center justify-end space-x-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedFormToFill(null)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingForm}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {submittingForm ? 'Submitting...' : 'Submit to CR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STUDENT MENU DRAWER */}
      {showStudentMenu && (
        <div className="fixed inset-0 z-50 flex animate-in fade-in">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" 
            onClick={() => setShowStudentMenu(false)}
          />

          {/* Drawer Sidebar */}
          <div className="relative w-80 max-w-full bg-white shadow-2xl flex flex-col justify-between z-10 animate-in slide-in-from-left">
            <div>
              {/* Drawer Header */}
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-black text-sm">
                    {student.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-sm font-black truncate max-w-[170px]">{student.name}</h4>
                    <p className="text-[10px] text-slate-400 font-mono">{student.reg_no}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowStudentMenu(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Menu Navigation Items */}
              <div className="p-3 space-y-1.5 text-xs">
                {/* 1. Live Feed */}
                <button
                  onClick={() => { setShowRecentSessions(true); setShowStudentMenu(false); }}
                  className="w-full flex items-center justify-between p-3 rounded-xl font-bold transition text-left cursor-pointer bg-emerald-50/60 text-emerald-900 hover:bg-emerald-100/70 border border-emerald-200/60"
                >
                  <div className="flex items-center space-x-2.5">
                    <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
                    <span>Recent Classes Live Feed</span>
                  </div>
                  <span className="text-[9px] bg-emerald-600 text-white font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Live
                  </span>
                </button>

                {/* 2. Class Statistics */}
                <button
                  onClick={() => { setShowStatsModal(true); setShowStudentMenu(false); }}
                  className="w-full flex items-center space-x-2.5 p-3 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-200"
                >
                  <BarChart2 className="w-4 h-4 text-indigo-600" />
                  <span>Class Statistics & Analytics</span>
                </button>

                {/* 3. Attendance Auditor */}
                <button
                  onClick={() => { setShowAuditor(!showAuditor); setShowStudentMenu(false); }}
                  className="w-full flex items-center space-x-2.5 p-3 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-200"
                >
                  <FileSearch className="w-4 h-4 text-blue-600" />
                  <span>{showAuditor ? 'Close Date Auditor' : 'Audit Specific Date'}</span>
                </button>

                {/* 4. My Attendance Edit Logs */}
                <button
                  onClick={() => { setShowAuditLogs(true); setShowStudentMenu(false); }}
                  className="w-full flex items-center space-x-2.5 p-3 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-200"
                >
                  <History className="w-4 h-4 text-amber-600" />
                  <span>My Attendance Change Logs</span>
                </button>

                {/* 5. Department Forms */}
                {activeForms && activeForms.length > 0 && (
                  <button
                    onClick={() => { setShowStudentMenu(false); }}
                    className="w-full flex items-center justify-between p-3 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-200"
                  >
                    <div className="flex items-center space-x-2.5">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      <span>Department Forms</span>
                    </div>
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full font-mono">
                      {activeForms.length}
                    </span>
                  </button>
                )}

                {/* 6. Student Helpdesk / Requests to CR */}
                <button
                  onClick={() => { setShowHelpdeskModal(true); setShowStudentMenu(false); }}
                  className="w-full flex items-center space-x-2.5 p-3 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-200"
                >
                  <HelpCircle className="w-4 h-4 text-blue-600" />
                  <span>Helpdesk / Request to CR</span>
                </button>

                {/* 7. Change Password */}
                <button
                  onClick={() => { setShowChangePasswordModal(true); setShowStudentMenu(false); }}
                  className="w-full flex items-center space-x-2.5 p-3 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-200"
                >
                  <KeyRound className="w-4 h-4 text-indigo-600" />
                  <span>Change My Password</span>
                </button>

              </div>
            </div>

            {/* Bottom Student Info */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 space-y-1">
              <div className="font-bold text-slate-700">AUCE(A) CSE Student Portal</div>
              <div className="text-[11px] text-slate-400">Roll: {student.reg_no} • {student.batch}</div>
            </div>
          </div>
        </div>
      )}

      {/* Class Statistics & Analytics Modal */}
      <ClassStatisticsModal
        isOpen={showStatsModal}
        onClose={() => setShowStatsModal(false)}
        currentMonth={selectedMonth}
        activeSemester={activeSemester}
      />

      {/* Recent Sessions Live Feed Modal */}
      <RecentSessionsFeedModal
        isOpen={showRecentSessions}
        onClose={() => setShowRecentSessions(false)}
        token={token}
        user={user}
      />

      {/* Attendance Modification Audit Logs Modal */}
      <AttendanceAuditLogsModal
        isOpen={showAuditLogs}
        onClose={() => setShowAuditLogs(false)}
        regNo={student.reg_no}
      />

      {/* Student Helpdesk / Requests Modal */}
      <StudentHelpdeskModal
        isOpen={showHelpdeskModal}
        onClose={() => setShowHelpdeskModal(false)}
        token={token}
        student={student}
      />

      {/* Student Change Password Modal */}
      <StudentChangePasswordModal
        isOpen={showChangePasswordModal}
        onClose={() => setShowChangePasswordModal(false)}
        token={token}
      />

    </div>
  );
}
