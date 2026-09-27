import React, { useState, useEffect } from 'react';
import { 
  Calendar, Clock, Check, X, Search, Filter, CheckCircle2, 
  AlertCircle, ChevronRight, CheckSquare, Square, Users, Sparkles,
  Ban, Palmtree, AlertTriangle, MessageSquare, PlusCircle, Trash2, ListPlus,
  RotateCcw, Edit3
} from 'lucide-react';
import ReviewConfirmModal from './ReviewConfirmModal';
import { getLocalDateISO } from '../utils/attendance';

export default function AttendanceMarker({ currentMonth, onAttendanceSaved, token }) {
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateISO());
  
  const [dateData, setDateData] = useState({ day_name: '', slots: [], is_holiday: false, holiday_info: null });
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [isEditingMarked, setIsEditingMarked] = useState(false);
  
  const [students, setStudents] = useState([]);
  const [absentIds, setAbsentIds] = useState(new Set());
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Confirmation modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Class Cancellation Modal state
  const [cancelModalSlot, setCancelModalSlot] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingSlot, setCancellingSlot] = useState(false);

  // Holiday Modal state
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ title: '', description: '' });
  const [savingHoliday, setSavingHoliday] = useState(false);

  // Extra Class Modal state
  const [showExtraClassModal, setShowExtraClassModal] = useState(false);
  const [availableSubjects, setAvailableSubjects] = useState([]);
  const [extraClassForm, setExtraClassForm] = useState({
    subject_id: '',
    slot_type: 'Theory',
    batch: 'All',
    start_time: '03:30 PM',
    end_time: '05:10 PM'
  });
  const [savingExtraClass, setSavingExtraClass] = useState(false);

  // Custom Day Timetable Modal state (override slots for historical/custom days)
  const [showCustomDayModal, setShowCustomDayModal] = useState(false);
  const [customSlots, setCustomSlots] = useState([]);
  const [savingCustomDay, setSavingCustomDay] = useState(false);

  // 1. Fetch timetable slots whenever selectedDate changes
  useEffect(() => {
    fetchSlotsForDate(selectedDate);
  }, [selectedDate]);

  const fetchSlotsForDate = async (dateStr) => {
    setLoadingSlots(true);
    setSelectedSlot(null);
    try {
      const res = await fetch(`/api/attendance/slots-for-date?date=${dateStr}`);
      const data = await res.json();
      setDateData(data);
      if (data.is_holiday) {
        // A holiday is a hard stop. Keep timetable visible for reference,
        // but never load a roster or open a marking sheet.
        setSelectedSlot(null);
        setStudents([]);
        setAbsentIds(new Set());
      } else if (data.slots && data.slots.length > 0) {
        // Auto-select first non-cancelled slot, or first slot
        const firstActive = data.slots.find(s => !s.is_cancelled) || data.slots[0];
        handleSelectSlot(firstActive);
      } else {
        setSelectedSlot(null);
        setStudents([]);
        setAbsentIds(new Set());
      }
    } catch (err) {
      console.error('Error fetching slots for date:', err);
    } finally {
      setLoadingSlots(false);
    }
  };

  // 2. Fetch eligible students whenever selectedSlot changes
  const handleSelectSlot = async (slot) => {
    setSelectedSlot(slot);
    setLoadingStudents(true);
    setSuccessMessage('');
    setIsEditingMarked(!slot.is_marked);

    // The timetable slot owns the batch. There is deliberately no client-side
    // "switch lab batch" control. A Lab slot with Batch 2 can only load Batch 2.
    const batchParam = (slot.batch || 'All').trim();

    if (slot.slot_type === 'Lab' && batchParam === 'All') {
      setStudents([]);
      setAbsentIds(new Set());
      setLoadingStudents(false);
      return;
    }

    try {
      const res = await fetch(`/api/attendance/eligible-students?batch=${encodeURIComponent(batchParam)}`);
      const data = await res.json();
      setStudents(data);
      if (slot.is_marked && slot.absent_student_ids && slot.absent_student_ids.length > 0) {
        setAbsentIds(new Set(slot.absent_student_ids));
      } else {
        setAbsentIds(new Set());
      }
    } catch (err) {
      console.error('Error fetching eligible students:', err);
    } finally {
      setLoadingStudents(false);
    }
  };


  // Undo Class Cancellation (Item 1)
  const handleUndoCancellation = async (slot, e) => {
    if (e) e.stopPropagation();
    try {
      const authToken = token || localStorage.getItem('attendance_token') || '';
      const res = await fetch('/api/attendance/uncancel-class', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          date: selectedDate,
          slot_id: slot.id,
          session_id: slot.session_id,
          subject_id: slot.subject_id
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to restore cancelled class');
      setSuccessMessage('Class cancellation undone! Slot is now restored.');
      fetchSlotsForDate(selectedDate);
      if (onAttendanceSaved) onAttendanceSaved();
    } catch (err) {
      alert(err.message);
    }
  };

  // Handle Class Cancellation
  const handleOpenCancelModal = (slot, e) => {
    if (e) e.stopPropagation();
    setCancelModalSlot(slot);
    setCancelReason(slot.cancellation_reason || '');
  };

  const handleConfirmCancelClass = async (e) => {
    e.preventDefault();
    if (!cancelReason.trim()) {
      alert('Please provide a 2-3 line reason for cancelling this class.');
      return;
    }
    setCancellingSlot(true);
    try {
      const authToken = token || localStorage.getItem('attendance_token') || '';
      const res = await fetch('/api/attendance/cancel-slot', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          slot_id: cancelModalSlot.id,
          session_id: cancelModalSlot.session_id || null,
          subject_id: cancelModalSlot.subject_id,
          date: selectedDate,
          day_of_week: dateData.day_name,
          slot_type: cancelModalSlot.slot_type,
          batch: cancelModalSlot.batch,
          month: selectedDate.substring(0, 7),
          description: cancelReason.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to cancel slot');
      setSuccessMessage('Class marked as cancelled. It will not penalize student attendance records.');
      setCancelModalSlot(null);
      setCancelReason('');
      fetchSlotsForDate(selectedDate);
      if (onAttendanceSaved) onAttendanceSaved();
    } catch (err) {
      alert(err.message);
    } finally {
      setCancellingSlot(false);
    }
  };

  // Open Extra Class modal & fetch subjects
  const handleOpenExtraClassModal = async () => {
    try {
      const res = await fetch('/api/subjects');
      const data = await res.json();
      setAvailableSubjects(data);
      if (data.length > 0 && !extraClassForm.subject_id) {
        setExtraClassForm(prev => ({ ...prev, subject_id: data[0].id }));
      }
      setShowExtraClassModal(true);
    } catch (err) {
      console.error('Failed to load subjects for extra class:', err);
    }
  };

  // Save Extra Class
  const handleSaveExtraClass = async (e) => {
    e.preventDefault();
    if (!extraClassForm.subject_id) {
      alert('Please select a subject');
      return;
    }
    setSavingExtraClass(true);
    try {
      const authToken = token || localStorage.getItem('attendance_token') || '';
      const res = await fetch('/api/attendance/extra-class', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          date: selectedDate,
          subject_id: Number(extraClassForm.subject_id),
          slot_type: extraClassForm.slot_type,
          batch: extraClassForm.batch,
          start_time: extraClassForm.start_time,
          end_time: extraClassForm.end_time
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to schedule extra class');
      setShowExtraClassModal(false);
      setSuccessMessage(data.message || `Extra class scheduled for ${selectedDate}!`);
      fetchSlotsForDate(selectedDate);
      if (onAttendanceSaved) onAttendanceSaved();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingExtraClass(false);
    }
  };

  // Handle Holiday Declaration
  const handleSaveHoliday = async (e) => {
    e.preventDefault();
    if (!holidayForm.title.trim()) {
      alert('Holiday title is required');
      return;
    }
    setSavingHoliday(true);
    try {
      const res = await fetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          title: holidayForm.title.trim(),
          description: holidayForm.description.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to declare holiday');
      setShowHolidayModal(false);
      setHolidayForm({ title: '', description: '' });
      fetchSlotsForDate(selectedDate);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingHoliday(false);
    }
  };

  const handleDeleteHoliday = async () => {
    if (!dateData.holiday_info?.id) return;
    if (!window.confirm(`Are you sure you want to remove the holiday "${dateData.holiday_info.title}"?`)) return;
    try {
      const res = await fetch(`/api/holidays/${dateData.holiday_info.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove holiday');
      fetchSlotsForDate(selectedDate);
    } catch (err) {
      alert(err.message);
    }
  };

  // Open Custom Day Schedule modal. When there is no override yet, start from the
  // actual weekly classes for that date so the CR can delete/reorder/retime them instead
  // of having to rebuild the whole day from a blank row.
  const handleOpenCustomDayModal = async () => {
    try {
      let subjects = availableSubjects;
      if (subjects.length === 0) {
        const res = await fetch('/api/subjects');
        subjects = await res.json();
        setAvailableSubjects(subjects);
      }

      const existingCustom = (dateData.slots || []).filter(s => s.is_custom_day);
      const isExistingOverride = Boolean(dateData.has_custom_day);

      if (isExistingOverride) {
        setCustomSlots(existingCustom.map((s, i) => ({
          _key: `session-${s.session_id || i}`,
          subject_id: s.subject_id,
          start_time: s.start_time,
          end_time: s.end_time,
          slot_type: s.slot_type || 'Theory',
          batch: s.batch || 'All',
          _locked: !!s.is_marked
        })));
      } else {
        const editable = (dateData.slots || []).filter(s => !s.is_extra && !s.is_custom_day);
        setCustomSlots(editable.map((s, i) => ({
          _key: `weekly-${s.id || s.session_id || i}`,
          subject_id: s.subject_id,
          start_time: s.start_time,
          end_time: s.end_time,
          slot_type: s.slot_type || 'Theory',
          batch: s.batch || 'All',
          _locked: !!s.is_marked
        })));
      }
      setShowCustomDayModal(true);
    } catch (err) {
      console.error('Failed to prepare custom day slots:', err);
      alert('Could not load the current day schedule. Please refresh and try again.');
    }
  };

  const handleAddCustomSlot = () => {
    const defaultSubId = availableSubjects[0]?.id || (customSlots[0]?.subject_id || 1);
    setCustomSlots(prev => [
      ...prev,
      {
        _key: `custom-${Date.now()}-${prev.length}`,
        subject_id: defaultSubId,
        start_time: prev[prev.length - 1]?.end_time || '08:50 AM',
        end_time: '09:40 AM',
        slot_type: 'Theory',
        batch: 'All'
      }
    ]);
  };

  const handleRemoveCustomSlot = (index) => {
    setCustomSlots(prev => {
      const target = prev[index];
      if (target?._locked) {
        alert('This period already has attendance marked and cannot be removed here. Edit its attendance first if you need to change it.');
        return prev;
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const handleUpdateCustomSlot = (index, field, value) => {
    setCustomSlots(prev => {
      const copy = [...prev];
      const current = copy[index] || {};
      if (current._locked && ['subject_id', 'start_time', 'slot_type', 'batch'].includes(field)) {
        // Changing identity fields of an already-marked period would make it look
        // like a different period to the backend, which would then also refuse to
        // remove the original marked one. Block it here with a clear explanation
        // instead of a confusing save-time failure.
        alert('This period already has attendance marked, so its subject/time/type/batch cannot be changed here. Edit its attendance first if you need to change it.');
        return prev;
      }
      const next = { ...current, [field]: value };
      if (field === 'slot_type') {
        next.batch = value === 'Lab' ? (current.batch === 'All' ? 'Batch 1' : current.batch) : 'All';
      }
      copy[index] = next;
      return copy;
    });
  };

  const handleSaveCustomDay = async (e) => {
    e.preventDefault();
    setSavingCustomDay(true);
    try {
      const authToken = token || localStorage.getItem('attendance_token') || '';
      const res = await fetch('/api/attendance/custom-day-slots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          date: selectedDate,
          slots: customSlots.map(s => ({
            subject_id: Number(s.subject_id),
            start_time: s.start_time,
            end_time: s.end_time,
            slot_type: s.slot_type,
            batch: s.batch
          }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to apply custom day schedule');
      setShowCustomDayModal(false);
      setSuccessMessage(`Custom timetable applied for ${selectedDate}! Standard weekly schedule remains unaffected.`);
      fetchSlotsForDate(selectedDate);
      if (onAttendanceSaved) onAttendanceSaved();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingCustomDay(false);
    }
  };

  // Toggle student between Present and Absent
  const toggleAbsent = (studentId) => {
    const target = students.find(s => s.id === studentId);
    if (target && isStudentLateralBeforeJoin(target)) return;
    setAbsentIds(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const markAllPresent = () => {
    setAbsentIds(new Set());
  };

  // Open confirmation modal
  const handleOpenReview = () => {
    if (!selectedSlot) return;
    setIsModalOpen(true);
  };

  // Submit to backend
  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        date: selectedDate,
        day_of_week: dateData.day_name,
        subject_id: selectedSlot.subject_id,
        slot_id: selectedSlot.id,
        session_id: selectedSlot.session_id || null,
        slot_type: selectedSlot.slot_type,
        batch: selectedSlot.batch || 'All',
        month: selectedDate.substring(0, 7),
        absent_student_ids: Array.from(absentIds)
      };

      const authToken = token || localStorage.getItem('attendance_token') || '';
      const res = await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.detail || 'Failed to submit attendance');
      }

      setIsModalOpen(false);
      setSuccessMessage(
        `Attendance recorded successfully! Total: ${result.total_marked}, Present: ${result.present_count}, Absent: ${result.absent_count}.`
      );

      // Refresh slot marked status & notify parent
      fetchSlotsForDate(selectedDate);
      if (onAttendanceSaved) onAttendanceSaved();
    } catch (err) {
      alert('Submission error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredStudents = students.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return s.name.toLowerCase().includes(q) || s.reg_no.includes(q) || s.reg_no_last3.includes(q);
  });

  const isStudentLateralBeforeJoin = (student) => {
    if (student?.category !== 'Lateral Entry') return false;
    const join = student?.joining_date;
    return Boolean(join && selectedDate < join);
  };
  const markableStudents = students.filter(s => !isStudentLateralBeforeJoin(s));
  const absentList = students.filter(s => absentIds.has(s.id));

  // Helper to map standard AUCE period names
  const getAucePeriodBadge = (startTime, endTime) => {
    const timeStr = `${startTime || ''} - ${endTime || ''}`.trim();
    if (timeStr.includes('09:00') && timeStr.includes('10:40')) return 'AUCE Period 1 (09:00 - 10:40 AM)';
    if (timeStr.includes('10:40') && timeStr.includes('12:20')) return 'AUCE Period 2 (10:40 - 12:20 PM)';
    if (timeStr.includes('01:30') || timeStr.includes('13:30')) return 'AUCE Period 3 (01:30 - 03:10 PM)';
    return `Custom / Extra Slot (${timeStr})`;
  };

  // Check if date is upcoming/future
  const todayStr = getLocalDateISO();
  const isUpcomingDate = selectedDate > todayStr;

  // Sort slots chronologically. Timetable values may be 12-hour (09:00 AM)
  // or 24-hour (13:30), so lexical string sorting is not reliable.
  const timeToMinutes = (value) => {
    if (!value) return 24 * 60;
    const text = String(value).trim().toUpperCase().replace('.', ':');
    let m = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (m) {
      let h = Number(m[1]) % 12;
      if (m[3] === 'PM') h += 12;
      return h * 60 + Number(m[2]);
    }
    m = text.match(/^(\d{1,2}):(\d{2})/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    return 24 * 60;
  };
  const slotIdentity = (slot) => slot?.id != null
    ? `weekly:${slot.id}`
    : `session:${slot?.session_id ?? `${slot?.subject_id}-${slot?.start_time}-${slot?.end_time}-${slot?.batch}`}`;

  const sortedSlots = [...(dateData.slots || [])].sort((a, b) =>
    timeToMinutes(a.start_time) - timeToMinutes(b.start_time) ||
    String(a.subject_name || '').localeCompare(String(b.subject_name || '')) ||
    Number(a.session_id || 0) - Number(b.session_id || 0)
  );

  return (
    <div className="space-y-6">
      
      {/* Date & Day Header Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Calendar className="w-5 h-5 text-amber-600" />
            <span>Mark Daily Attendance</span>
          </h3>
          <p className="text-xs text-slate-500">
            Select date to load scheduled timetable classes for AUCE(A) CSE.
          </p>
        </div>

        {/* Date Selector, Holiday Status & Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 p-1.5 rounded-xl">
            <div className="px-3 py-1 bg-amber-600 text-white font-bold text-xs rounded-lg uppercase tracking-wider shadow-2xs">
              {dateData.day_name || 'Calendar'}
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent border-0 text-xs font-bold text-slate-800 focus:ring-0 cursor-pointer"
            />
          </div>

          {/* Holiday action button */}
          {dateData.is_holiday ? (
            <button
              type="button"
              onClick={handleDeleteHoliday}
              className="px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
              title="Remove declared holiday for this date"
            >
              <Palmtree className="w-3.5 h-3.5 text-rose-600" />
              <span>Holiday Declared (Remove)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setHolidayForm({ title: '', description: '' });
                setShowHolidayModal(true);
              }}
              className="px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
              title="Declare this date as university holiday"
            >
              <Palmtree className="w-3.5 h-3.5 text-slate-500" />
              <span>Declare Holiday</span>
            </button>
          )}

          {/* Customize Day's Timetable Button */}
          <button
            type="button"
            onClick={handleOpenCustomDayModal}
            className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Override or customize timetable slots specifically for this date without altering weekly master schedule"
          >
            <Clock className="w-3.5 h-3.5 text-indigo-600" />
            <span>Customize Day Schedule</span>
          </button>

          {/* Add Extra Class Button */}
          <button
            type="button"
            onClick={handleOpenExtraClassModal}
            className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="Schedule an ad-hoc extra class on this date"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>+ Add Extra Class</span>
          </button>
        </div>
      </div>

      {/* Holiday Alert Card (When date is declared holiday) */}
      {dateData.is_holiday && (
        <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl flex items-start gap-3 shadow-xs animate-in fade-in">
          <div className="w-9 h-9 rounded-xl bg-amber-200/80 flex items-center justify-center shrink-0 text-amber-900 mt-0.5">
            <Palmtree className="w-5 h-5 text-amber-800" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="bg-amber-600 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-wider">
                Official University Holiday
              </span>
              <h4 className="text-sm font-bold text-amber-950">
                {dateData.holiday_info?.title || 'Holiday'}
              </h4>
            </div>
            {dateData.holiday_info?.description && (
              <p className="text-xs text-amber-900/80 mt-1">
                {dateData.holiday_info.description}
              </p>
            )}
            <p className="text-[11px] text-amber-700 font-medium mt-1">
              Note: Attendance is waived for today. No classes are required, and student attendance percentages will not be penalized.
            </p>
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button 
            onClick={() => setSuccessMessage('')}
            className="text-emerald-700 hover:text-emerald-900 font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Slots Available on this Day */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">
            Scheduled Classes for {dateData.day_name} ({sortedSlots.length})
          </h4>
          <span className="text-[11px] text-slate-400 font-medium">Sorted chronologically by AUCE period times</span>
        </div>

        {loadingSlots ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
            <div className="w-6 h-6 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-500">Fetching scheduled classes...</p>
          </div>
        ) : sortedSlots.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
            <p className="text-xs text-slate-500 font-medium">
              No classes scheduled on {dateData.day_name} in the timetable.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {sortedSlots.map((slot) => {
              const isSelected = selectedSlot ? slotIdentity(selectedSlot) === slotIdentity(slot) : false;
              const isCancelled = Boolean(slot.is_cancelled);
              return (
                <div
                  key={slotIdentity(slot)}
                  onClick={() => { if (!dateData.is_holiday) handleSelectSlot(slot); }}
                  className={`text-left p-3.5 rounded-2xl border transition relative overflow-hidden flex flex-col justify-between ${
                    dateData.is_holiday ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  } ${
                    isSelected 
                      ? 'bg-amber-50/90 border-amber-500 ring-2 ring-amber-500/20 shadow-xs' 
                      : isCancelled
                        ? 'bg-rose-50/40 border-rose-200 opacity-90'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div>
                    {/* AUCE Period Badge */}
                    <div className="text-[10px] font-bold text-slate-500 mb-1 flex items-center justify-between">
                      <span className="truncate">{getAucePeriodBadge(slot.start_time, slot.end_time)}</span>
                    </div>

                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-[11px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                        {slot.subject_code}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        slot.slot_type === 'Lab' 
                          ? 'bg-purple-100 text-purple-800' 
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {slot.slot_type} • {slot.batch}
                      </span>
                    </div>

                    <div className="font-bold text-xs text-slate-900 line-clamp-1" title={slot.subject_name}>
                      {slot.subject_name}
                    </div>
                    {slot.faculty_name && (
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        Prof: {slot.faculty_name}
                      </div>
                    )}
                  </div>

                  {/* Cancellation Reason alert if cancelled */}
                  {isCancelled && (
                    <div className="mt-2 p-1.5 bg-rose-100 border border-rose-200 rounded-lg text-[10px] text-rose-800">
                      <div className="font-bold flex items-center gap-1 text-rose-900">
                        <Ban className="w-3 h-3 text-rose-700" />
                        Class Cancelled
                      </div>
                      <p className="line-clamp-2 italic mt-0.5">"{slot.cancellation_reason || 'No reason specified'}"</p>
                    </div>
                  )}

                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1 font-mono text-[10px]">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {slot.start_time} - {slot.end_time}
                    </span>

                    <div className="flex items-center gap-1">
                      {isCancelled ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">
                            Cancelled
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleUndoCancellation(slot, e)}
                            className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 transition cursor-pointer"
                            title="Undo cancellation"
                          >
                            Undo
                          </button>
                        </div>
                      ) : slot.is_marked ? (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" /> Marked
                        </span>
                      ) : (isUpcomingDate || slot.is_upcoming) ? (
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                          Upcoming
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          Pending
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Slot Attendance Sheet */}
      {selectedSlot && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
          
          {/* Slot Info, Cancellation notice and Actions Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-base font-black text-slate-900">
                  {selectedSlot.subject_name}
                </h4>
                <span className="bg-amber-100 text-amber-900 text-xs font-bold px-2 py-0.5 rounded-md">
                  {selectedSlot.slot_type} ({selectedSlot.batch})
                </span>
                {selectedSlot.is_cancelled && (
                  <span className="bg-rose-100 text-rose-800 text-xs font-black px-2 py-0.5 rounded-md flex items-center gap-1">
                    <Ban className="w-3 h-3" /> Class Cancelled
                  </span>
                )}
                {(isUpcomingDate || selectedSlot.is_upcoming) && !selectedSlot.is_cancelled && (
                  <span className="bg-blue-100 text-blue-800 text-xs font-black px-2 py-0.5 rounded-md flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Upcoming Class
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                <span>Time: <strong className="text-slate-800">{selectedSlot.start_time} - {selectedSlot.end_time}</strong></span>
                <span>•</span>
                <span>Roster: <strong className="text-slate-800">{students.length} students</strong></span>
                {selectedSlot.slot_type === 'Lab' && selectedSlot.batch !== 'All' && (
                  <span className="text-purple-700 font-semibold">({selectedSlot.batch} only)</span>
                )}
              </p>
            </div>

            {/* Quick Actions Bar (Absentee Counters, Cancel Class, Reset All) */}
            <div className="flex flex-wrap items-center gap-2.5">
              {!selectedSlot.is_cancelled && !(isUpcomingDate || selectedSlot.is_upcoming) && isEditingMarked ? (
                <>
                  <div className="flex items-center space-x-2 text-xs">
                    <span className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
                      Present: {markableStudents.length - absentIds.size}
                    </span>
                    <span className="px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
                      Absent: {absentIds.size}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={markAllPresent}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Reset All Present
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleOpenCancelModal(selectedSlot, e)}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                    title="Declare class cancelled with official reason"
                  >
                    <Ban className="w-3.5 h-3.5 text-rose-600" />
                    <span>Cancel Class</span>
                  </button>
                </>
              ) : selectedSlot.is_cancelled ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => handleUndoCancellation(selectedSlot, e)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs cursor-pointer"
                    title="Undo mistake and restore this class"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Undo Cancellation</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleOpenCancelModal(selectedSlot, e)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Edit Reason
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {selectedSlot.is_cancelled ? (
            <div className="p-8 text-center bg-rose-50/50 rounded-2xl border border-rose-200 space-y-3">
              <Ban className="w-8 h-8 text-rose-600 mx-auto" />
              <div>
                <h5 className="text-sm font-bold text-rose-950">This class session is marked as cancelled</h5>
                <p className="text-xs text-rose-800 max-w-md mx-auto mt-1 italic">
                  "{selectedSlot.cancellation_reason || 'Class cancelled'}"
                </p>
              </div>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                Cancelled classes are strictly excluded from total conducted count. If this was cancelled by mistake, click below to restore it.
              </p>
              <div>
                <button
                  type="button"
                  onClick={(e) => handleUndoCancellation(selectedSlot, e)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Undo Class Cancellation</span>
                </button>
              </div>
            </div>
          ) : (isUpcomingDate || selectedSlot.is_upcoming) ? (
            <div className="p-8 text-center bg-blue-50/50 rounded-2xl border border-blue-200 space-y-2">
              <Clock className="w-8 h-8 text-blue-600 mx-auto" />
              <h5 className="text-sm font-bold text-blue-950">Upcoming Class Session</h5>
              <p className="text-xs text-blue-800 max-w-md mx-auto">
                This class is scheduled for <strong>{selectedDate}</strong> ({selectedSlot.start_time} - {selectedSlot.end_time}).
              </p>
              <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                Attendance marking will open on or after the scheduled class date. Marking future dates is locked to maintain authentic records.
              </p>
            </div>
          ) : selectedSlot.is_marked && !isEditingMarked ? (
            <div className="p-6 bg-slate-50/80 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div className="flex items-center space-x-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-800">
                    Attendance Recorded & Completed
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingMarked(true)}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer self-start sm:self-auto"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Attendance</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-white rounded-xl border border-slate-200">
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Status</span>
                  <span className="text-emerald-700 font-extrabold text-sm">Conducted</span>
                </div>
                <div className="p-3 bg-white rounded-xl border border-slate-200">
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Present</span>
                  <span className="text-emerald-600 font-extrabold text-sm">{markableStudents.length - absentIds.size} Students</span>
                </div>
                <div className="p-3 bg-white rounded-xl border border-slate-200">
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Absent</span>
                  <span className="text-rose-600 font-extrabold text-sm">{absentIds.size} Students</span>
                </div>
                <div className="p-3 bg-white rounded-xl border border-slate-200">
                  <span className="text-slate-400 text-[10px] uppercase font-bold block">Recorded By</span>
                  <span className="text-slate-800 font-extrabold text-sm truncate block">{selectedSlot.marked_by || 'CR'}</span>
                </div>
              </div>

              {absentIds.size > 0 && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs">
                  <strong className="text-rose-900 block mb-1.5">Recorded Absentees ({absentIds.size}):</strong>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {students.filter(s => absentIds.has(s.id)).map(s => (
                      <span key={s.id} className="bg-white border border-rose-200 text-rose-800 font-mono text-[11px] px-2 py-0.5 rounded-md shadow-2xs">
                        {s.reg_no_last3} - {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Audit notice banner when editing already-marked session */}
              {selectedSlot.is_marked && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span><strong>Editing Mode:</strong> Any changes made to student attendance will be recorded in the official audit log.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingMarked(false)}
                    className="text-amber-800 underline hover:text-amber-950 font-bold ml-2 shrink-0 cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                </div>
              )}

              {/* Search bar & instructions */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-80">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search roll no (e.g. 028) or name..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="text-[11px] text-slate-500 font-medium">
                  💡 <span className="font-bold text-slate-700">Fast Marking:</span> Default is <span className="text-emerald-700 font-bold">Present</span>. Click any student to mark <span className="text-red-700 font-bold">Absent</span>.
                </div>
              </div>

              {/* Student Grid (3-Digit Roll Badge + Full Name) */}
              {loadingStudents ? (
                <div className="p-12 text-center">
                  <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs text-slate-500">Loading student roster...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-[480px] overflow-y-auto p-1">
                  {filteredStudents.map((s) => {
                    const isAbsent = absentIds.has(s.id);
                    const beforeJoining = isStudentLateralBeforeJoin(s);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleAbsent(s.id)}
                        disabled={beforeJoining}
                        className={`text-left p-3 rounded-xl border transition flex items-center justify-between group ${
                          isAbsent
                            ? 'bg-red-50/90 border-red-300 ring-2 ring-red-400/30 shadow-2xs'
                            : beforeJoining
                              ? 'bg-slate-100 border-slate-200 opacity-70 cursor-not-allowed'
                              : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 overflow-hidden">
                          <span className={`w-10 h-8 rounded-lg font-mono font-black flex items-center justify-center text-xs shrink-0 transition ${
                            isAbsent 
                              ? 'bg-red-600 text-white shadow-xs' 
                              : 'bg-slate-100 text-slate-800 group-hover:bg-slate-200'
                          }`}>
                            {s.reg_no_last3}
                          </span>
                          
                          <div className="truncate">
                            <div className="font-bold text-xs text-slate-900 truncate" title={s.name}>
                              {s.name}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono truncate">
                              {s.reg_no}
                            </div>
                            {beforeJoining && (
                              <div className="text-[9px] text-amber-700 font-bold truncate">
                                Lateral • not eligible before joining date
                              </div>
                            )}
                          </div>
                        </div>

                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
                          isAbsent 
                            ? 'bg-red-100 text-red-700 font-extrabold' 
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {beforeJoining ? `Starts ${s.joining_date}` : (isAbsent ? 'Absent' : 'Present')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Submit Attendance Button Bar */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-600">
                  Selected: <span className="font-bold text-slate-900">{markableStudents.length}</span> eligible students • 
                  Marked Absent: <span className="font-bold text-red-700">{absentIds.size}</span>
                </div>

                <button
                  type="button"
                  onClick={handleOpenReview}
                  disabled={markableStudents.length === 0}
                  className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
                >
                  <span>{selectedSlot.is_marked ? 'Review & Save Modified Attendance' : 'Review & Submit Attendance'}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

        </div>
      )}

      {/* Confirmation Modal */}
      <ReviewConfirmModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleConfirmSubmit}
        slot={selectedSlot}
        date={selectedDate}
        dayName={dateData.day_name}
        absentStudents={absentList}
        totalEligible={students.length}
        submitting={submitting}
      />

      {/* Class Cancellation Modal (2-3 Line Explanation) */}
      {cancelModalSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-700 shrink-0">
                <Ban className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">Declare Class Cancellation</h4>
                <p className="text-xs text-slate-500">
                  {cancelModalSlot.subject_name} • {cancelModalSlot.start_time} - {cancelModalSlot.end_time}
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
              <strong>Attendance Impact:</strong> Cancelling a class strictly excludes it from total conducted classes, so student attendance percentages remain 100% fair and unpenalized.
            </div>

            <form onSubmit={handleConfirmCancelClass} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Cancellation Reason / Description (2–3 Lines) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g., Faculty on university official duty for NAAC committee. Extra tutorial class will be scheduled next week as replacement."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelModalSlot(null)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-bold"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={cancellingSlot}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs transition disabled:opacity-50"
                >
                  {cancellingSlot ? 'Saving...' : 'Confirm Class Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Holiday Declaration Modal */}
      {showHolidayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                <Palmtree className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">Declare University Holiday</h4>
                <p className="text-xs text-slate-500">
                  Date: <strong className="text-slate-800">{selectedDate}</strong> ({dateData.day_name})
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveHoliday} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Holiday Name / Title *
                </label>
                <input
                  type="text"
                  required
                  value={holidayForm.title}
                  onChange={(e) => setHolidayForm({ ...holidayForm, title: e.target.value })}
                  placeholder="e.g. Gandhi Jayanti / Andhra University Foundation Day"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Description / Remarks (Optional)
                </label>
                <textarea
                  rows={2}
                  value={holidayForm.description}
                  onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })}
                  placeholder="e.g. Declared university holiday as per AU registrar notification."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowHolidayModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingHoliday}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {savingHoliday ? 'Saving...' : 'Save Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extra Class Scheduling Modal */}
      {showExtraClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-100 flex items-center justify-center text-purple-700 shrink-0">
                <PlusCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">Schedule Extra Class</h4>
                <p className="text-xs text-slate-500">
                  Date: <strong className="text-slate-800">{selectedDate}</strong> ({dateData.day_name})
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveExtraClass} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Subject *
                </label>
                <select
                  required
                  value={extraClassForm.subject_id}
                  onChange={(e) => setExtraClassForm({ ...extraClassForm, subject_id: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {availableSubjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.code} - {sub.name} ({sub.type}) • {sub.faculty_name || 'Faculty'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Slot Type
                  </label>
                  <select
                    value={extraClassForm.slot_type}
                    onChange={(e) => setExtraClassForm({ ...extraClassForm, slot_type: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:ring-0"
                  >
                    <option value="Theory">Theory</option>
                    <option value="Lab">Lab</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Target Batch
                  </label>
                  <select
                    value={extraClassForm.batch}
                    onChange={(e) => setExtraClassForm({ ...extraClassForm, batch: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:ring-0"
                  >
                    <option value="All">All Students</option>
                    <option value="Batch 1">Batch 1</option>
                    <option value="Batch 2">Batch 2</option>
                    <option value="Batch 3">Batch 3</option>
                  </select>
                </div>
              </div>

              {/* AUCE Time Presets */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  AUCE Class Timing Preset
                </label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setExtraClassForm({ ...extraClassForm, start_time: '09:00 AM', end_time: '10:40 AM' })}
                    className="p-2 text-left bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-[11px] font-semibold transition"
                  >
                    Period 1: 09:00 - 10:40 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtraClassForm({ ...extraClassForm, start_time: '10:40 AM', end_time: '12:20 PM' })}
                    className="p-2 text-left bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-[11px] font-semibold transition"
                  >
                    Period 2: 10:40 - 12:20 PM
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtraClassForm({ ...extraClassForm, start_time: '01:30 PM', end_time: '03:10 PM' })}
                    className="p-2 text-left bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-[11px] font-semibold transition"
                  >
                    Period 3: 01:30 - 03:10 PM
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtraClassForm({ ...extraClassForm, start_time: '03:30 PM', end_time: '05:10 PM' })}
                    className="p-2 text-left bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-lg text-[11px] font-semibold transition"
                  >
                    Extra: 03:30 - 05:10 PM
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Start Time
                  </label>
                  <input
                    type="text"
                    required
                    value={extraClassForm.start_time}
                    onChange={(e) => setExtraClassForm({ ...extraClassForm, start_time: e.target.value })}
                    placeholder="e.g. 03:30 PM"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    End Time
                  </label>
                  <input
                    type="text"
                    required
                    value={extraClassForm.end_time}
                    onChange={(e) => setExtraClassForm({ ...extraClassForm, end_time: e.target.value })}
                    placeholder="e.g. 05:10 PM"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExtraClassModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingExtraClass}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {savingExtraClass ? 'Scheduling...' : 'Confirm Extra Class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customize Day Schedule Modal */}
      {showCustomDayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900">Customize Day Timetable</h4>
                  <p className="text-xs text-slate-500">
                    Date: <strong className="text-slate-800 font-mono">{selectedDate}</strong> ({dateData.day_name}) • Historical / Custom Override
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCustomDayModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              <p className="font-bold">Independent Day Schedule:</p>
              <p className="text-[11px] mt-0.5 text-amber-800">
                You can define the exact subjects and timing slots for this specific date (e.g., if classes differed in earlier months due to revisions). Your standard weekly master timetable will NOT be affected.
              </p>
            </div>

            {/* Slots List */}
            <form onSubmit={handleSaveCustomDay} className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
              <div className="space-y-2.5">
                {customSlots.length === 0 && (
                  <div className="p-5 rounded-2xl border border-dashed border-slate-300 bg-white text-center">
                    <p className="text-xs font-bold text-slate-700">No classes will be scheduled on this date.</p>
                    <p className="text-[11px] text-slate-500 mt-1">Save this empty schedule to hide the normal weekly timetable for this date.</p>
                  </div>
                )}
                {customSlots.map((slot, idx) => (
                  <div key={slot._key || `custom-${idx}`} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                        Period {idx + 1}
                        {slot._locked && (
                          <span className="normal-case font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full text-[9px]">
                            Attendance marked • locked
                          </span>
                        )}
                      </span>
                      {!slot._locked && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomSlot(idx)}
                          className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          title="Remove period"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      {/* Subject */}
                      <div className="sm:col-span-4">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Subject</label>
                        <select
                          value={slot.subject_id}
                          onChange={(e) => handleUpdateCustomSlot(idx, 'subject_id', e.target.value)}
                          disabled={slot._locked}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          {availableSubjects.map((sub) => (
                            <option key={sub.id} value={sub.id}>
                              {sub.code} - {sub.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Start Time */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Start Time</label>
                        <input
                          type="text"
                          value={slot.start_time}
                          onChange={(e) => handleUpdateCustomSlot(idx, 'start_time', e.target.value)}
                          placeholder="08:00 AM"
                          disabled={slot._locked}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-medium disabled:bg-slate-100 disabled:text-slate-500"
                        />
                      </div>

                      {/* End Time */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">End Time</label>
                        <input
                          type="text"
                          value={slot.end_time}
                          onChange={(e) => handleUpdateCustomSlot(idx, 'end_time', e.target.value)}
                          placeholder="08:50 AM"
                          disabled={slot._locked}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-medium disabled:bg-slate-100 disabled:text-slate-500"
                        />
                      </div>

                      {/* Type */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Type</label>
                        <select
                          value={slot.slot_type}
                          onChange={(e) => handleUpdateCustomSlot(idx, 'slot_type', e.target.value)}
                          disabled={slot._locked}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          <option value="Theory">Theory</option>
                          <option value="Lab">Lab</option>
                        </select>
                      </div>

                      {/* Batch */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Batch</label>
                        <select
                          value={slot.batch || 'All'}
                          onChange={(e) => handleUpdateCustomSlot(idx, 'batch', e.target.value)}
                          disabled={slot.slot_type === 'Theory' || slot._locked}
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          <option value="All">All</option>
                          <option value="Batch 1">Batch 1</option>
                          <option value="Batch 2">Batch 2</option>
                          <option value="Batch 3">Batch 3</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Period Button */}
              <button
                type="button"
                onClick={handleAddCustomSlot}
                className="w-full py-2.5 border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/40 hover:bg-indigo-50 text-indigo-700 font-bold rounded-2xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <PlusCircle className="w-4 h-4 text-indigo-600" />
                <span>+ Add Another Period to this Day</span>
              </button>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCustomDayModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCustomDay}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs transition disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
                >
                  {savingCustomDay ? 'Applying...' : 'Save & Apply Day Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
