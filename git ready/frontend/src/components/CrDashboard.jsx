import React, { useState, useEffect } from 'react';
import { 
  Users, CalendarCheck, Clock, Layers, Award, AlertTriangle, 
  CheckCircle2, XCircle, TrendingUp, X, Sparkles, BookOpen, 
  Wand2, RotateCcw, PlusCircle, Settings, Menu, FileSpreadsheet,
  FileSearch, Palmtree, ChevronRight, ShieldAlert, BarChart2, History,
  KeyRound, MessageSquare, Database, Shield, Edit3, Radio, Mail
} from 'lucide-react';
import AttendanceMarker from './AttendanceMarker';
import TimetableManager from './TimetableManager';
import StudentManager from './StudentManager';
import StudentDashboard from './StudentDashboard';
import CrSetupWizard from './CrSetupWizard';
import DepartmentFormsManager from './DepartmentFormsManager';
import DateAttendanceAuditor from './DateAttendanceAuditor';
import ClassStatisticsModal from './ClassStatisticsModal';
import AttendanceAuditLogsModal from './AttendanceAuditLogsModal';
import RecentSessionsFeedModal from './RecentSessionsFeedModal';
import SendAttendanceAlertsModal from './SendAttendanceAlertsModal';
import AdminPasswordModal from './AdminPasswordModal';
import StudentPasswordRequestsModal from './StudentPasswordRequestsModal';
import StudentHelpdeskCrModal from './StudentHelpdeskCrModal';
import DatabaseBackupModal from './DatabaseBackupModal';
import SemesterSwitcherModal from './SemesterSwitcherModal';
import { formatAttendancePercentage, getLocalDateISO } from '../utils/attendance';

export default function CrDashboard({ user, token, currentMonth, activeSemester }) {
  const [activeTab, setActiveTab] = useState('mark'); // 'mark', 'roster', 'timetable', 'forms', 'audit', 'wizard'
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [selectedStudentReg, setSelectedStudentReg] = useState(null);
  
  // Guarded Menu, Statistics & Reset State
  const [showCrMenu, setShowCrMenu] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showAuditLogsModal, setShowAuditLogsModal] = useState(false);
  const [showRecentSessionsModal, setShowRecentSessionsModal] = useState(false);
  const [showSendAlertsModal, setShowSendAlertsModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // New CR Management Modals State
  const [showAdminPasswordModal, setShowAdminPasswordModal] = useState(false);
  const [showPasswordRequestsModal, setShowPasswordRequestsModal] = useState(false);
  const [showHelpdeskModal, setShowHelpdeskModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showSemesterSwitcherModal, setShowSemesterSwitcherModal] = useState(false);
  const [pendingPasswordCount, setPendingPasswordCount] = useState(0);
  const [pendingHelpdeskCount, setPendingHelpdeskCount] = useState(0);

  const fetchOverview = async () => {
    try {
      const month = currentMonth || activeSemester?.active_month || 'all';
      const query = month ? `?month=${encodeURIComponent(month)}` : '';
      const res = await fetch(`/api/attendance/overview${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to load class overview');
      setOverview(data);
    } catch (err) {
      console.error('Error fetching class overview:', err);
    } finally {
      setLoadingOverview(false);
    }
  };

  const fetchPendingCounts = async () => {
    try {
      if (token) {
        const [pwdRes, helpRes] = await Promise.all([
          fetch('/api/auth/password-requests', { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/api/requests/all?status=PENDING', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        if (pwdRes.ok) {
          const pwds = await pwdRes.json();
          setPendingPasswordCount(pwds.filter(p => p.status === 'PENDING').length);
        }
        if (helpRes.ok) {
          const helps = await helpRes.json();
          setPendingHelpdeskCount(helps.length);
        }
      }
    } catch (e) {
      console.error('Failed to fetch pending counts', e);
    }
  };

  useEffect(() => {
    fetchOverview();
    fetchPendingCounts();
    const openSwitcher = () => setShowSemesterSwitcherModal(true);
    window.addEventListener('open-semester-switcher', openSwitcher);
    return () => window.removeEventListener('open-semester-switcher', openSwitcher);
  }, [currentMonth, token, activeSemester?.active_month]);

  const handleResetDatabase = async () => {
    setIsResetting(true);
    try {
      const res = await fetch('/api/setup/reset', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reset database');
      setShowResetConfirm(false);
      await fetchOverview();
      setActiveTab('wizard');
    } catch (err) {
      alert('Error resetting database: ' + err.message);
    } finally {
      setIsResetting(false);
    }
  };

  const handleWizardComplete = () => {
    setActiveTab('mark');
    fetchOverview();
  };

  const classAvg = overview?.class_average || 0;
  let avgColor = "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (classAvg <= 90.0 && classAvg > 75.0) {
    avgColor = "text-amber-700 bg-amber-50 border-amber-200";
  } else if (classAvg <= 75.0) {
    avgColor = "text-red-700 bg-red-50 border-red-200";
  }

  const isClassEmpty = !overview || overview.total_students === 0;
  const totalPendingNotifications = pendingPasswordCount + pendingHelpdeskCount;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* 1. TOP METRICS BAR: CLASS AVERAGE ATTENDANCE & DISTRIBUTION */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
          
          <div>
            <div className="flex items-center space-x-3 mb-1">
              {/* Top-Left CR Menu Trigger Button */}
              <button
                type="button"
                onClick={() => setShowCrMenu(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer relative"
                title="Open CR Menu & Advanced Actions"
              >
                <Menu className="w-4 h-4 text-amber-400" />
                <span>CR Menu</span>
                {totalPendingNotifications > 0 && (
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900 animate-pulse" />
                )}
              </button>

              <span className="bg-amber-100 text-amber-900 text-xs font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                CR Control Center
              </span>
              <span className="text-xs text-slate-400 font-medium">• CSE Dept, AUCE(A)</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Class Representative Portal
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Authoritative source for timetable, student allocations, cancellation logs, and department data gathering.
            </p>
          </div>

          {/* Header Actions & Class Average Callout */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Show Launch Setup Wizard ONLY if class is empty */}
            {isClassEmpty && (
              <button
                onClick={() => setActiveTab('wizard')}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Wand2 className="w-4 h-4" />
                <span>Launch Setup Wizard</span>
              </button>
            )}

            {/* CLASS STATISTICS BUTTON & AVERAGE CALLOUT */}
            <button
              type="button"
              onClick={() => setShowStatsModal(true)}
              className="flex items-center space-x-2 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-2xl text-xs font-bold transition shadow-2xs cursor-pointer"
              title="View comprehensive subject and batch statistics"
            >
              <BarChart2 className="w-4 h-4 text-indigo-600" />
              <span>Class Statistics</span>
            </button>

            <div 
              onClick={() => setShowStatsModal(true)}
              className="flex items-center space-x-3 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 px-4 py-2 rounded-2xl cursor-pointer transition shadow-2xs group"
              title="Click to view detailed Class Attendance Statistics & Analytics"
            >
              <div className="text-right">
                <span className="block text-[9px] font-black text-slate-400 group-hover:text-indigo-600 uppercase tracking-wider transition">
                  Class Avg
                </span>
                <span className="text-[11px] text-slate-500 font-medium font-mono">{overview?.total_students || 0} Students</span>
              </div>
              <div className={`px-3 py-1 rounded-xl border font-mono text-xl font-black ${avgColor}`}>
                {formatAttendancePercentage(classAvg)}%
              </div>
            </div>
          </div>

        </div>

        {/* 4 Summary Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Enrolled</span>
              <Users className="w-4 h-4 text-blue-600" />
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 font-mono">
              {overview?.total_students || 0}
            </div>
            <span className="text-[10px] text-slate-500 font-medium">Divided into 3 Batches</span>
          </div>

          <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-100">
            <div className="flex items-center justify-between">
              <span className="text-emerald-700 text-xs font-bold uppercase tracking-wider">&gt; 90% Safe</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2 text-2xl font-black text-emerald-800 font-mono">
              {overview?.distribution?.safe_above_90 || 0}
            </div>
            <span className="text-[10px] text-emerald-700 font-medium">Safe from Condonation</span>
          </div>

          <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-100">
            <div className="flex items-center justify-between">
              <span className="text-amber-700 text-xs font-bold uppercase tracking-wider">75% - 90% Avg</span>
              <TrendingUp className="w-4 h-4 text-amber-600" />
            </div>
            <div className="mt-2 text-2xl font-black text-amber-800 font-mono">
              {overview?.distribution?.moderate_75_90 || 0}
            </div>
            <span className="text-[10px] text-amber-700 font-medium">Satisfactory</span>
          </div>

          <div className="p-4 bg-red-50/60 rounded-2xl border border-red-100">
            <div className="flex items-center justify-between">
              <span className="text-red-700 text-xs font-bold uppercase tracking-wider">&lt; 75% Shortage</span>
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <div className="mt-2 text-2xl font-black text-red-800 font-mono">
              {overview?.distribution?.shortage_below_75 || 0}
            </div>
            <span className="text-[10px] text-red-700 font-medium">Requires Condonation Fee</span>
          </div>
        </div>

      </div>

      {/* Empty State Callout if no students */}
      {isClassEmpty && activeTab !== 'wizard' && (
        <div className="p-8 bg-amber-50 border-2 border-dashed border-amber-300 rounded-3xl text-center space-y-3">
          <Wand2 className="w-10 h-10 text-amber-600 mx-auto" />
          <h3 className="text-lg font-black text-amber-950">Welcome Class Representative!</h3>
          <p className="text-xs text-amber-800 max-w-lg mx-auto">
            Your attendance database is currently empty. Launch the 5-step Setup Wizard to define your semester, subjects, weekly timetable, batch ranges, and students roster.
          </p>
          <button
            onClick={() => setActiveTab('wizard')}
            className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-md transition inline-flex items-center space-x-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Start 5-Step Class Setup Wizard</span>
          </button>
        </div>
      )}

      {/* 2. TABBED NAVIGATION BAR */}
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('mark')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
            activeTab === 'mark'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <CalendarCheck className="w-4 h-4" />
          <span>Mark Attendance</span>
        </button>

        <button
          onClick={() => setActiveTab('roster')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
            activeTab === 'roster'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Students & Batches ({overview?.total_students || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('timetable')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
            activeTab === 'timetable'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Timetable & Schedule</span>
        </button>

        <button
          onClick={() => setActiveTab('forms')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
            activeTab === 'forms'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Department Forms (Excel)</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileSearch className="w-4 h-4" />
          <span>Attendance Auditor</span>
        </button>

        {isClassEmpty && (
          <button
            onClick={() => setActiveTab('wizard')}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
              activeTab === 'wizard'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            <span>Setup Wizard</span>
          </button>
        )}
      </div>

      {/* 3. TAB CONTENT */}
      <div>
        {activeTab === 'wizard' && (
          <CrSetupWizard 
            onSetupComplete={handleWizardComplete} 
            onCancel={() => setActiveTab('mark')} 
          />
        )}

        {activeTab === 'mark' && (
          <AttendanceMarker 
            currentMonth={currentMonth} 
            token={token}
            onAttendanceSaved={fetchOverview} 
          />
        )}

        {activeTab === 'roster' && (
          <StudentManager 
            currentMonth={currentMonth}
            onStudentAdded={fetchOverview}
            onViewStudentDetail={(regNo) => setSelectedStudentReg(regNo)}
          />
        )}

        {activeTab === 'timetable' && (
          <TimetableManager 
            onTimetableUpdated={fetchOverview}
          />
        )}

        {activeTab === 'forms' && (
          <DepartmentFormsManager />
        )}

        {activeTab === 'audit' && (
          <DateAttendanceAuditor defaultDate={getLocalDateISO()} />
        )}
      </div>

      {/* TOP-LEFT CR DRAWER MENU */}
      {showCrMenu && (
        <div className="fixed inset-0 z-50 flex animate-in fade-in">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" 
            onClick={() => setShowCrMenu(false)}
          />

          {/* Drawer Sidebar */}
          <div className="relative w-84 max-w-[90vw] h-full max-h-screen bg-white shadow-2xl flex flex-col z-10 animate-in slide-in-from-left overflow-hidden">
            {/* Drawer Header */}
            <div className="shrink-0 p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center font-black text-xs">
                  CR
                </div>
                <div>
                  <h4 className="text-sm font-black">CR Portal Menu</h4>
                  <p className="text-[10px] text-slate-400">AUCE(A) Computer Science</p>
                </div>
              </div>
              <button 
                onClick={() => setShowCrMenu(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Menu Navigation Items (Scrollable Container) */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 text-xs overscroll-contain">
              <button
                onClick={() => { setActiveTab('mark'); setShowCrMenu(false); }}
                className={`w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer ${
                  activeTab === 'mark' ? 'bg-amber-50 text-amber-900 font-black' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <CalendarCheck className="w-4 h-4 text-amber-600" />
                <span>Mark Daily Attendance</span>
              </button>

              <button
                onClick={() => { setActiveTab('roster'); setShowCrMenu(false); }}
                className={`w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer ${
                  activeTab === 'roster' ? 'bg-amber-50 text-amber-900 font-black' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Users className="w-4 h-4 text-blue-600" />
                <span>Students & Batches Roster</span>
              </button>

              <button
                onClick={() => { setActiveTab('timetable'); setShowCrMenu(false); }}
                className={`w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer ${
                  activeTab === 'timetable' ? 'bg-amber-50 text-amber-900 font-black' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Clock className="w-4 h-4 text-purple-600" />
                <span>Weekly Timetable & Schedule</span>
              </button>

              <button
                onClick={() => { setActiveTab('wizard'); setShowCrMenu(false); }}
                className={`w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer ${
                  activeTab === 'wizard' ? 'bg-amber-50 text-amber-900 font-black' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-600" />
                <span>New Semester Setup Wizard</span>
              </button>

              <button
                onClick={() => { setActiveTab('forms'); setShowCrMenu(false); }}
                className={`w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer ${
                  activeTab === 'forms' ? 'bg-amber-50 text-amber-900 font-black' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Department Forms (Excel Gatherer)</span>
              </button>

              <button
                onClick={() => { setActiveTab('audit'); setShowCrMenu(false); }}
                className={`w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer ${
                  activeTab === 'audit' ? 'bg-amber-50 text-amber-900 font-black' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <FileSearch className="w-4 h-4 text-indigo-600" />
                <span>Attendance History Auditor</span>
              </button>

              <button
                onClick={() => { setShowStatsModal(true); setShowCrMenu(false); }}
                className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <BarChart2 className="w-4 h-4 text-amber-600" />
                <span>Class Statistics & Analytics</span>
              </button>

              <button
                onClick={() => { setShowAuditLogsModal(true); setShowCrMenu(false); }}
                className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <History className="w-4 h-4 text-emerald-600" />
                <span>Attendance Change Logs</span>
              </button>

              <button
                onClick={() => { setShowRecentSessionsModal(true); setShowCrMenu(false); }}
                className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <Radio className="w-4 h-4 text-rose-500" />
                <span>Recent Classes Live Feed</span>
              </button>

              <div className="pt-2 pb-1 border-t border-slate-100">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2.5">
                  Student Notifications
                </span>
              </div>

              <button
                onClick={() => { setShowSendAlertsModal(true); setShowCrMenu(false); }}
                className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <Mail className="w-4 h-4 text-red-600" />
                <span>Attendance Email Centre</span>
              </button>

              <div className="pt-2 pb-1 border-t border-slate-100">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2.5">
                  Academic Year & Semester
                </span>
              </div>

              <button
                onClick={() => { 
                  window.dispatchEvent(new CustomEvent('open-academic-period-edit'));
                  setShowCrMenu(false); 
                }}
                className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <Edit3 className="w-4 h-4 text-amber-600" />
                <span>Edit Academic Year & Semester</span>
              </button>

              <div className="pt-2 pb-1 border-t border-slate-100">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-2.5">
                  Administration & Portability
                </span>
              </div>

              <button
                onClick={() => { setShowPasswordRequestsModal(true); setShowCrMenu(false); }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <div className="flex items-center space-x-2.5">
                  <KeyRound className="w-4 h-4 text-amber-600" />
                  <span>Student Password Requests</span>
                </div>
                {pendingPasswordCount > 0 && (
                  <span className="bg-amber-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {pendingPasswordCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => { setShowHelpdeskModal(true); setShowCrMenu(false); }}
                className="w-full flex items-center justify-between p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <div className="flex items-center space-x-2.5">
                  <MessageSquare className="w-4 h-4 text-blue-600" />
                  <span>Student Helpdesk Tickets</span>
                </div>
                {pendingHelpdeskCount > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {pendingHelpdeskCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => { setShowAdminPasswordModal(true); setShowCrMenu(false); }}
                className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <Shield className="w-4 h-4 text-purple-600" />
                <span>CR & LR Account Passwords</span>
              </button>

              <button
                onClick={() => { setShowBackupModal(true); setShowCrMenu(false); }}
                className="w-full flex items-center space-x-2.5 p-2.5 rounded-xl font-bold transition text-left cursor-pointer text-slate-700 hover:bg-slate-50"
              >
                <Database className="w-4 h-4 text-emerald-600" />
                <span>Backup & Restore Database</span>
              </button>

              {/* Guarded Danger Zone inside the scrollable drawer */}
              <div className="mt-4 pt-3 border-t-2 border-rose-200 bg-rose-50/60 p-3 rounded-2xl">
                <div className="text-[10px] font-black uppercase tracking-wider text-rose-700 flex items-center gap-1 mb-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                  <span>Protected Danger Zone</span>
                </div>
                <p className="text-[11px] text-slate-600 mb-2.5 leading-relaxed">
                  Resetting academic data is locked behind safety confirmation to prevent accidental loss.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowCrMenu(false);
                    setResetConfirmText('');
                    setShowResetConfirm(true);
                  }}
                  className="w-full py-2.5 px-3 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition flex items-center justify-center space-x-1.5 shadow-sm cursor-pointer active:scale-95"
                >
                  <RotateCcw className="w-4 h-4 text-white" />
                  <span>Reset All Academic Data</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. GUARDED RESET CONFIRMATION MODAL */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border-2 border-rose-300 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-black text-slate-900">Safety Verification: Reset All Data?</h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                This action erases all timetable slots, subjects, student records, department form submissions, and marked attendance.
              </p>
            </div>

            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-900">
              Please type <strong className="font-mono bg-white px-1.5 py-0.5 rounded border border-rose-300">RESET</strong> below to confirm.
            </div>

            <div>
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="Type RESET to confirm"
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs font-bold text-center uppercase tracking-widest focus:bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false);
                  setResetConfirmText('');
                }}
                disabled={isResetting}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetDatabase}
                disabled={isResetting || resetConfirmText.trim().toUpperCase() !== 'RESET'}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1.5 disabled:opacity-40 cursor-pointer"
              >
                {isResetting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>Wipe and Reset All Data</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. STUDENT DETAIL MODAL */}
      {selectedStudentReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-slate-50 w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-lg font-mono">
                  {selectedStudentReg}
                </span>
                <span className="text-xs font-bold text-slate-600">Student Attendance Detail</span>
              </div>
              <button
                onClick={() => setSelectedStudentReg(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <StudentDashboard 
                user={{ reg_no: selectedStudentReg, role: 'cr' }}
                token={token}
                currentMonth={currentMonth}
              />
            </div>
          </div>
        </div>
      )}

      {/* 6. CLASS STATISTICS & ANALYTICS MODAL */}
      <ClassStatisticsModal
        isOpen={showStatsModal}
        onClose={() => setShowStatsModal(false)}
        currentMonth={currentMonth}
        activeSemester={activeSemester}
      />

      {/* 7. ATTENDANCE AUDIT LOGS MODAL */}
      <AttendanceAuditLogsModal
        isOpen={showAuditLogsModal}
        onClose={() => setShowAuditLogsModal(false)}
      />

      {/* 7b. RECENT CLASSES LIVE FEED MODAL (CR/LR can remove wrongly-marked sessions here) */}
      <RecentSessionsFeedModal
        isOpen={showRecentSessionsModal}
        onClose={() => setShowRecentSessionsModal(false)}
        token={token}
        user={user}
      />

      {/* 7c. SEND LOW-ATTENDANCE ALERT EMAILS MODAL */}
      <SendAttendanceAlertsModal
        isOpen={showSendAlertsModal}
        onClose={() => setShowSendAlertsModal(false)}
        token={token}
        currentMonth={currentMonth}
      />

      {/* 8. ADMIN PASSWORDS MODAL */}
      <AdminPasswordModal
        isOpen={showAdminPasswordModal}
        onClose={() => setShowAdminPasswordModal(false)}
        token={token}
        currentUser={user}
      />

      {/* 9. STUDENT PASSWORD REQUESTS MODAL */}
      <StudentPasswordRequestsModal
        isOpen={showPasswordRequestsModal}
        onClose={() => setShowPasswordRequestsModal(false)}
        token={token}
        onRequestsUpdated={(reqs) => {
          setPendingPasswordCount(reqs.filter(r => r.status === 'PENDING').length);
        }}
      />

      {/* 10. STUDENT HELPDESK / INQUIRIES MODAL */}
      <StudentHelpdeskCrModal
        isOpen={showHelpdeskModal}
        onClose={() => setShowHelpdeskModal(false)}
        token={token}
        onRequestsUpdated={(reqs) => {
          setPendingHelpdeskCount(reqs.filter(r => r.status === 'PENDING').length);
        }}
      />

      {/* 11. DATABASE BACKUP & RESTORE MODAL */}
      <DatabaseBackupModal
        isOpen={showBackupModal}
        onClose={() => setShowBackupModal(false)}
        token={token}
        onRestored={() => {
          fetchOverview();
          fetchPendingCounts();
        }}
      />

      {/* 12. SEMESTER ARCHIVE SWITCHER */}
      <SemesterSwitcherModal
        isOpen={showSemesterSwitcherModal}
        onClose={() => setShowSemesterSwitcherModal(false)}
        token={token}
        isCr={true}
        canDelete={user?.role === 'cr' || user?.role === 'admin'}
        onSemesterChanged={() => {
          fetchOverview();
        }}
      />

    </div>
  );
}
