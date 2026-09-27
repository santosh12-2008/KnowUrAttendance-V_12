import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Calendar, User, Shield, GraduationCap, ChevronDown, Edit3 } from 'lucide-react';
import { getAcademicMonthOptions } from '../utils/attendance';

export default function Header({ user, onLogout, activeSemester, currentMonth, onMonthChange, onSemesterUpdated }) {
  const [showEditSemesterModal, setShowEditSemesterModal] = useState(false);
  const [semForm, setSemForm] = useState({
    academic_year: '2026-2027',
    name: 'B.Tech CSE - 3rd Year 1st Sem (3-1)',
    start_month: '2026-07',
    end_month: '2026-11',
    active_month: '2026-09'
  });
  const [savingSem, setSavingSem] = useState(false);

  useEffect(() => {
    if (activeSemester) {
      setSemForm({
        academic_year: activeSemester.academic_year || '2026-2027',
        name: activeSemester.name || 'B.Tech CSE - 3rd Year 1st Sem (3-1)',
        start_month: activeSemester.start_month || '2026-07',
        end_month: activeSemester.end_month || '2026-11',
        active_month: activeSemester.active_month || currentMonth || '2026-09'
      });
    }

    const handleOpenModal = () => handleOpenEdit();
    window.addEventListener('open-academic-period-edit', handleOpenModal);
    return () => window.removeEventListener('open-academic-period-edit', handleOpenModal);
  }, [activeSemester, currentMonth]);

  const handleOpenEdit = () => {
    if (activeSemester) {
      setSemForm({
        academic_year: activeSemester.academic_year || '2026-2027',
        name: activeSemester.name || 'B.Tech CSE - 3rd Year 1st Sem (3-1)',
        start_month: activeSemester.start_month || '2026-07',
        end_month: activeSemester.end_month || '2026-11',
        active_month: activeSemester.active_month || currentMonth || '2026-09'
      });
    }
    setShowEditSemesterModal(true);
  };

  const handleSaveSemester = async (e) => {
    e.preventDefault();
    setSavingSem(true);
    try {
      const res = await fetch('/api/semesters/current', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(semForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update semester details');
      setShowEditSemesterModal(false);
      if (onSemesterUpdated) onSemesterUpdated();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingSem(false);
    }
  };

  // The month list is derived from the active semester's start/end months rather than
  // hardcoded, so the portal keeps working for 3-2, 4-1 and every later semester without
  // anyone having to edit this file. This is shared (utils/attendance.js) with
  // StudentDashboard.jsx so the CR portal and the student portal can never drift apart
  // and show a different set of months again.
  const months = React.useMemo(
    () => getAcademicMonthOptions(activeSemester, currentMonth),
    [activeSemester?.start_month, activeSemester?.end_month, currentMonth]
  );

  return (
    <header className="sticky top-0 z-40 bg-white/95 border-b border-slate-200 shadow-sm">
      {/* IMPORTANT: this outer <header> must never carry `backdrop-blur` (or any other
          transform/filter/backdrop-filter class) itself. Those CSS properties create a new
          "containing block" for any descendant that uses `position: fixed` - so a fixed,
          full-screen modal rendered as a child of this element stops being positioned
          against the viewport and gets squashed into this header's own (short) box instead.
          That was the exact cause of the "Update Academic Period" modal only ever covering
          the top strip of the page instead of the whole screen: the blur lived here, on the
          direct ancestor of the modal markup below.
          The blur look is still applied - just on the two inner wrapper <div>s beneath,
          which sit next to the modal instead of above it, so they can't affect it.
          Belt-and-braces: the modal itself is also rendered through a React portal straight
          into <body> (see the bottom of this file), so even if a future style change adds a
          filter/transform back onto <header>, the modal is no longer a descendant of it at
          all and can't be caught by this again.
          The <header> element itself is the sticky container, so the brand row AND the
          academic bar below it stay pinned for the whole page. (Previously only the inner
          brand row carried `sticky top-0` while <header> flowed normally, so both unpinned
          the moment the header's own box scrolled out - the bar held at the top for a short
          stretch and then vanished.)
          The academic bar sits ~80px down from the viewport edge, below the brand row, so a
          mobile browser's address bar can never overlap the "Edit Academic Period" button. */}
      <div className="bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Left Brand: AU Logo, AUCE(A), KnowUrAttendance, CSE Department */}
          <div className="flex items-center space-x-3.5">
            <div className="relative group">
              <div className="w-14 h-14 rounded-xl p-1 bg-white border border-slate-200 shadow-xs flex items-center justify-center overflow-hidden">
                <img 
                  src="/au-logo.jpg" 
                  alt="Andhra University Logo" 
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    // Fallback to stylized AU crest if file path issue
                    e.target.onerror = null;
                    e.target.src = "https://upload.wikimedia.org/wikipedia/en/thumb/0/05/Andhra_University_logo.png/220px-Andhra_University_logo.png";
                  }}
                />
              </div>
              <span className="absolute -bottom-1 -right-1 bg-amber-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-xs tracking-wider">
                AUCE(A)
              </span>
            </div>

            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-1.5">
                  KnowUrAttendance
                </h1>
                <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-blue-200">
                  CSE Dept
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium truncate max-w-xs sm:max-w-md">
                Andhra University College of Engineering (A) • Computer Science & Engineering
              </p>
            </div>
          </div>

          {/* Right Controls: User Info, Logout */}
          <div className="flex items-center space-x-3">
            {/* User Profile Badge */}
            {user && (
              <div className="flex items-center space-x-2 bg-slate-100/80 px-3 py-1.5 rounded-lg border border-slate-200">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  user.role === 'cr' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {user.role === 'cr' ? <Shield className="w-4 h-4 text-amber-700" /> : <User className="w-4 h-4 text-emerald-700" />}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-xs font-bold text-slate-800 leading-tight">
                    {user.name}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                    <span className="uppercase font-semibold text-blue-700">{user.role}</span>
                    <span>•</span>
                    <span>{user.reg_no}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Logout Button */}
            {user && (
              <button
                onClick={onLogout}
                className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition border border-transparent hover:border-red-200"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>

        </div>
      </div>
      </div>

      {/* ACADEMIC YEAR & SEMESTER BAR
          Previously this bar sat outside the page container and was not pinned, so it
          spanned an inconsistent width and scrolled away after a few pixels. It now:
            - shares the same max-w-7xl container as the brand row above, so both align;
            - sticks at top-20, i.e. directly BELOW the pinned brand row, which keeps it
              permanently reachable without ever sitting flush against the viewport edge
              where a mobile browser's address bar can swallow the tap target;
            - stretches full width and stacks cleanly on narrow screens, so the Edit
              button is never clipped or pushed off-screen. */}
      <div className="w-full bg-slate-100/95 backdrop-blur shadow-2xs">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-2.5
                        flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">

          {/* Left: academic year + semester title (+ edit for CR/LR) */}
          <div className="flex items-center flex-wrap gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                if (user?.role === 'cr' || user?.role === 'lr') {
                  window.dispatchEvent(new Event('open-semester-switcher'));
                }
              }}
              className={`flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs min-w-0 flex-1 sm:flex-initial text-left ${
                (user?.role === 'cr' || user?.role === 'lr') ? 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40 active:scale-[0.99]' : 'cursor-default'
              } transition`}
              title={(user?.role === 'cr' || user?.role === 'lr') ? 'Open Academic Semester Switcher' : undefined}
            >
              <GraduationCap className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="text-xs font-black text-slate-900 tracking-wide shrink-0">
                {activeSemester?.academic_year || "2026-2027"}
              </span>
              <span className="text-slate-300 shrink-0">•</span>
              <span className="text-xs font-bold text-slate-700 truncate">
                {activeSemester?.name || "B.Tech CSE (3-1)"}
              </span>
            </button>

            {(user?.role === 'cr' || user?.role === 'lr') && (
              <button
                type="button"
                onClick={handleOpenEdit}
                className="shrink-0 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl transition flex items-center gap-1.5 shadow-xs cursor-pointer border border-amber-400 active:scale-95"
                title="Edit Academic Year & Semester Details"
              >
                <Edit3 className="w-3.5 h-3.5 text-slate-950" />
                <span className="hidden sm:inline">Edit Academic Period</span>
                <span className="sm:hidden">Edit</span>
              </button>
            )}
          </div>

          {/* Right: persistent academic month selector */}
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs shrink-0 w-full sm:w-auto">
            <Calendar className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-[11px] font-bold text-slate-500 shrink-0">Active Month:</span>
            <select
              value={currentMonth || activeSemester?.active_month || "2026-09"}
              onChange={(e) => onMonthChange && onMonthChange(e.target.value)}
              className="flex-1 sm:flex-initial bg-transparent border-0 text-xs font-black text-slate-800 focus:ring-0 cursor-pointer p-0 min-w-0"
              title="Persistent Academic Month"
            >
              {months.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Edit Academic Year & Semester Modal
          Rendered through a portal directly into document.body (not inline here inside
          <header>), so its `fixed inset-0` always measures against the real viewport no
          matter what classes get added to <header> or any other ancestor later. This is
          what actually fixes the modal being clipped to the header's own height. */}
      {showEditSemesterModal && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-in fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowEditSemesterModal(false); }}
        >
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 my-auto max-h-[90vh] overflow-y-auto">
            <h4 className="text-base font-black text-slate-900 mb-1">Update Academic Period</h4>
            <p className="text-xs text-slate-500 mb-4">
              Update the current academic year, semester title, and active recording month.
            </p>

            <form onSubmit={handleSaveSemester} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Academic Year *
                </label>
                <input
                  type="text"
                  required
                  value={semForm.academic_year}
                  onChange={(e) => setSemForm({ ...semForm, academic_year: e.target.value })}
                  placeholder="e.g. 2026-2027"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Semester Title *
                </label>
                <input
                  type="text"
                  required
                  value={semForm.name}
                  onChange={(e) => setSemForm({ ...semForm, name: e.target.value })}
                  placeholder="e.g. B.Tech CSE - 3rd Year 1st Sem (3-1)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Start Month *
                  </label>
                  <input
                    type="month"
                    required
                    value={semForm.start_month}
                    onChange={(e) => setSemForm({ ...semForm, start_month: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    End Month *
                  </label>
                  <input
                    type="month"
                    required
                    value={semForm.end_month}
                    onChange={(e) => setSemForm({ ...semForm, end_month: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Active Month (Persistent Default) *
                </label>
                <input
                  type="month"
                  required
                  value={semForm.active_month}
                  onChange={(e) => setSemForm({ ...semForm, active_month: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowEditSemesterModal(false)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSem}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs disabled:opacity-50"
                >
                  {savingSem ? 'Saving...' : 'Save Academic Details'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </header>
  );
}
