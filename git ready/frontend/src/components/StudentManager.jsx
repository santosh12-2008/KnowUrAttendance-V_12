import React, { useState, useEffect } from 'react';
import { formatAttendancePercentage, getLocalDateISO } from '../utils/attendance';
import { 
  Users, UserPlus, Sliders, Search, Mail, Phone, Layers, CheckCircle2, 
  AlertCircle, Eye, Edit3, Calendar, GraduationCap, UserMinus, RotateCcw, UserX, AlertTriangle,
  Percent, ClipboardList, Check, ArrowRight
} from 'lucide-react';

export default function StudentManager({ onStudentAdded, onViewStudentDetail, currentMonth }) {
  const [students, setStudents] = useState([]);
  const [batchRanges, setBatchRanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'dropped' | 'all'
  
  // Real attendance calculation toggle (Item 2)
  const [showPercentages, setShowPercentages] = useState(false);

  // Smart Universal Paste / Bulk import state (Item 8)
  const [showSmartImportModal, setShowSmartImportModal] = useState(false);
  const [smartImportText, setSmartImportText] = useState('');
  const [smartImportOverwrite, setSmartImportOverwrite] = useState(false);
  const [smartImporting, setSmartImporting] = useState(false);
  const [smartImportResult, setSmartImportResult] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchRangeModal, setShowBatchRangeModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);

  // Drop student modal state
  const [dropModalStudent, setDropModalStudent] = useState(null);
  const [dropReason, setDropReason] = useState('Left College / Discontinued');
  const [dropDate, setDropDate] = useState(getLocalDateISO());
  const [dropping, setDropping] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  
  // New student form
  const [newStudent, setNewStudent] = useState({
    reg_no: '',
    name: '',
    batch: 'Batch 1',
    mobile: '',
    email: '',
    category: 'EAPCET Admission',
    admission_no: '',
    joining_date: ''
  });

  // Lateral Entry default joining date control
  const [lateralJoiningDate, setLateralJoiningDate] = useState('');
  const [updatingLateralDate, setUpdatingLateralDate] = useState(false);
  const [showLateralDateModal, setShowLateralDateModal] = useState(false);

  const isLateralReg = (regNo) => {
    const digits = String(regNo || '').replace(/\D/g, '');
    return digits.length >= 3 && Number(digits.slice(-3)) >= 125;
  };

  // Batch ranges edit form
  const [editRanges, setEditRanges] = useState({
    b1_start: '999999000001',
    b1_end: '999999000047',
    b2_start: '999999000048',
    b2_end: '999999000094',
    b3_start: '999999000095',
    b3_end: '999999000140'
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const monthQuery = currentMonth ? `?month=${encodeURIComponent(currentMonth)}` : '';
      const [stuRes, brRes, semRes] = await Promise.all([
        fetch(`/api/students${monthQuery}`),
        fetch('/api/batch-ranges'),
        fetch('/api/semesters/active')
      ]);
      const stuData = await stuRes.json();
      const brData = await brRes.json();
      if (semRes.ok) {
        const semData = await semRes.json();
        // Always fall back to a real date, even if the semester record has none yet -
        // otherwise this field stays '' forever and the "Update All Lateral Entries"
        // button (disabled while empty) can look permanently broken until someone
        // manually types a date into it first.
        setLateralJoiningDate(semData.lateral_joining_date || '2026-08-02');
      }
      setStudents(stuData);
      setBatchRanges(brData);

      if (brData && brData.length >= 3) {
        setEditRanges({
          b1_start: brData[0]?.start_reg_no || '',
          b1_end: brData[0]?.end_reg_no || '',
          b2_start: brData[1]?.start_reg_no || '',
          b2_end: brData[1]?.end_reg_no || '',
          b3_start: brData[2]?.start_reg_no || '',
          b3_end: brData[2]?.end_reg_no || ''
        });
      }
    } catch (err) {
      console.error('Error fetching students:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentMonth]);

  const handleAddStudent = async (e) => {
    e.preventDefault();
    if (newStudent.reg_no.length !== 12) {
      alert('Registration Number must be exactly 12 digits');
      return;
    }

    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStudent)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to add student');
      
      setShowAddModal(false);
      setNewStudent({
        reg_no: '',
        name: '',
        batch: 'Batch 1',
        mobile: '',
        email: '',
        category: 'EAPCET Admission',
        admission_no: '',
        joining_date: ''
      });
      fetchData();
      if (onStudentAdded) onStudentAdded();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveStudentEdit = async (e) => {
    e.preventDefault();
    if (!editingStudent) return;
    try {
      const res = await fetch(`/api/students/${editingStudent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingStudent.name,
          batch: editingStudent.batch,
          mobile: editingStudent.mobile,
          email: editingStudent.email,
          category: editingStudent.category,
          admission_no: editingStudent.admission_no,
          joining_date: isLateralReg(editingStudent.reg_no) ? (editingStudent.joining_date || lateralJoiningDate || null) : null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update student details');
      
      setEditingStudent(null);
      fetchData();
      if (onStudentAdded) onStudentAdded();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUpdateAllLateralDate = async () => {
    // Confirmation happens via the dedicated modal (see showLateralDateModal) rather than
    // a native browser confirm(), so this can be called directly from that modal's button.
    setUpdatingLateralDate(true);
    try {
      const res = await fetch('/api/students/lateral-joining-date', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joining_date: lateralJoiningDate })
      });
      let data = {};
      try { data = await res.json(); } catch (parseErr) { /* handled below via !res.ok */ }
      if (!res.ok) throw new Error(data.detail || `Failed to update lateral joining date (server returned ${res.status}).`);
      alert(data.message || 'Lateral entry joining dates updated successfully!');
      fetchData();
      if (onStudentAdded) onStudentAdded();
    } catch (err) {
      alert('Could not update Lateral Entry dates: ' + err.message);
    } finally {
      setUpdatingLateralDate(false);
    }
  };

  const handleSaveBatchRanges = async (e) => {
    e.preventDefault();
    try {
      const payload = [
        { batch_name: 'Batch 1', start_reg_no: editRanges.b1_start, end_reg_no: editRanges.b1_end },
        { batch_name: 'Batch 2', start_reg_no: editRanges.b2_start, end_reg_no: editRanges.b2_end },
        { batch_name: 'Batch 3', start_reg_no: editRanges.b3_start, end_reg_no: editRanges.b3_end }
      ];

      const res = await fetch('/api/batch-ranges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to update batch ranges');
      setShowBatchRangeModal(false);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleConfirmDrop = async (e) => {
    e.preventDefault();
    if (!dropModalStudent) return;
    setDropping(true);
    try {
      const res = await fetch(`/api/students/${dropModalStudent.id}/drop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: dropReason,
          date: dropDate
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to mark student as dropped');
      setDropModalStudent(null);
      fetchData();
      if (onStudentAdded) onStudentAdded();
    } catch (err) {
      alert(err.message);
    } finally {
      setDropping(false);
    }
  };

  const handleRestoreStudent = async (student) => {
    if (!window.confirm(`Are you sure you want to restore ${student.name} (${student.reg_no}) back to active class roster?`)) return;
    setRestoringId(student.id);
    try {
      const res = await fetch(`/api/students/${student.id}/restore`, {
        method: 'PUT'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to restore student');
      fetchData();
      if (onStudentAdded) onStudentAdded();
    } catch (err) {
      alert(err.message);
    } finally {
      setRestoringId(null);
    }
  };

  const handleSmartImportSubmit = async (e) => {
    e.preventDefault();
    if (!smartImportText.trim()) {
      alert('Please paste or enter student roster text');
      return;
    }
    setSmartImporting(true);
    setSmartImportResult(null);
    try {
      const authToken = localStorage.getItem('attendance_token') || '';
      const res = await fetch('/api/students/smart-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          raw_text: smartImportText,
          overwrite_existing: smartImportOverwrite
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Smart import failed');
      setSmartImportResult(data);
      fetchData();
      if (onStudentAdded) onStudentAdded();
    } catch (err) {
      alert(err.message);
    } finally {
      setSmartImporting(false);
    }
  };

  const activeCount = students.filter(s => !s.is_dropped).length;
  const droppedCount = students.filter(s => s.is_dropped).length;

  const filteredStudents = students.filter(s => {
    const isDropped = Boolean(s.is_dropped);
    if (statusFilter === 'active' && isDropped) return false;
    if (statusFilter === 'dropped' && !isDropped) return false;
    const matchesBatch = batchFilter === 'All' || s.batch === batchFilter;
    const q = search.toLowerCase().trim();
    const matchesSearch = !q || s.name.toLowerCase().includes(q) || s.reg_no.includes(q);
    return matchesBatch && matchesSearch;
  });

  return (
    <div className="space-y-6">
      
      {/* Top Banner: Batch Ranges & Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-600" />
            <span>Class Roster & Lab Batch Allocations</span>
          </h3>
          <p className="text-xs text-slate-500">
            Total of {students.length} students allocated into 3 batches for lab attendance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Item 2: Real attendance toggle button */}
          <button
            type="button"
            onClick={() => setShowPercentages(prev => !prev)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer ${
              showPercentages 
                ? 'bg-indigo-600 text-white shadow-xs' 
                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200'
            }`}
            title="Toggle between Attended/Conducted classes count and calculated percentage"
          >
            <Percent className="w-3.5 h-3.5" />
            <span>{showPercentages ? 'Showing Calculated %' : 'Calculate & Show %'}</span>
          </button>

          {/* Item 8: Universal Paste / Smart Ingestion button */}
          <button
            type="button"
            onClick={() => {
              setShowSmartImportModal(true);
              setSmartImportText('');
              setSmartImportResult(null);
            }}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
            title="Paste unstructured text from WhatsApp, Excel, or CSV to auto-import students"
          >
            <ClipboardList className="w-3.5 h-3.5 text-slate-600" />
            <span>Smart Universal Paste</span>
          </button>

          <button
            type="button"
            onClick={() => setShowBatchRangeModal(true)}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Configure Batch Ranges</span>
          </button>

          {/* Lateral Entry default joining/attendance start date control */}
          <button
            type="button"
            onClick={() => setShowLateralDateModal(true)}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5 cursor-pointer"
            title="Set the attendance start date used for all Lateral Entry students"
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Lateral Entry Start Date</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center space-x-1.5 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Student</span>
          </button>
        </div>
      </div>

      {/* Batch summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {['Batch 1', 'Batch 2', 'Batch 3'].map((bname, idx) => {
          const count = students.filter(s => s.batch === bname).length;
          const range = batchRanges.find(r => r.batch_name === bname);
          return (
            <div key={bname} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-800">{bname}</span>
                <span className="font-mono text-xs font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                  {count} Students
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 font-mono">
                Range: {range ? `${range.start_reg_no.slice(-3)} to ${range.end_reg_no.slice(-3)}` : 'Custom'}
              </div>
              <div className="text-[10px] text-slate-400">
                Full: {range?.start_reg_no} — {range?.end_reg_no}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto flex-1">
          {/* Search */}
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or reg no (e.g. 028)..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Status Filter (Active vs Dropped) */}
          <div className="flex items-center space-x-1 p-1 bg-slate-100 rounded-xl self-start sm:self-auto shrink-0">
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                statusFilter === 'active'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              onClick={() => setStatusFilter('dropped')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                statusFilter === 'dropped'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-rose-700 hover:bg-rose-50'
              }`}
            >
              <UserX className="w-3.5 h-3.5" />
              <span>Dropped ({droppedCount})</span>
            </button>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({students.length})
            </button>
          </div>
        </div>

        {/* Batch Filter Buttons */}
        <div className="flex items-center space-x-1.5 self-end lg:self-auto shrink-0">
          {['All', 'Batch 1', 'Batch 2', 'Batch 3'].map((b) => (
            <button
              key={b}
              onClick={() => setBatchFilter(b)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                batchFilter === b
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Student Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-black tracking-wider text-[10px]">
                <th className="py-3 px-4 whitespace-nowrap">Roll (Last 3)</th>
                <th className="py-3 px-4 whitespace-nowrap">Reg. No</th>
                <th className="py-3 px-4 whitespace-nowrap">Student Name</th>
                <th className="py-3 px-4 whitespace-nowrap">Batch</th>
                <th className="py-3 px-4 whitespace-nowrap">Category & Joining</th>
                <th className="py-3 px-4 whitespace-nowrap">Mobile & Email</th>
                <th className="py-3 px-4 whitespace-nowrap">{showPercentages ? 'Attendance %' : 'Attendance (Attended / Conducted)'}</th>
                <th className="py-3 px-4 text-center whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudents.map((s) => {
                const isDropped = Boolean(s.is_dropped);
                let badgeColor = "bg-emerald-100 text-emerald-800 border-emerald-200";
                if (s.percentage <= 90.0 && s.percentage > 75.0) {
                  badgeColor = "bg-amber-100 text-amber-800 border-amber-200";
                } else if (s.percentage <= 75.0) {
                  badgeColor = "bg-red-100 text-red-800 border-red-200";
                }

                return (
                  <tr key={s.id} className={`transition ${isDropped ? 'bg-rose-50/40 hover:bg-rose-50/70' : 'hover:bg-slate-50/80'}`}>
                    <td className="py-2.5 px-4 font-mono font-black text-slate-800 whitespace-nowrap">
                      <span className="px-2 py-1 bg-slate-100 rounded-lg">
                        {s.reg_no_last3}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 font-medium whitespace-nowrap">
                      {s.reg_no}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-900 max-w-[200px]" title={s.name}>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{s.name}</span>
                        {isDropped && (
                          <span className="bg-rose-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase tracking-wider shrink-0 shadow-2xs">
                            DROPPED
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100 whitespace-nowrap">
                        {s.batch}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
                          s.category === 'Foreigners' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                          s.category === 'Sweden Batch' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          s.category === 'Lateral Entry' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {s.category || 'EAPCET Admission'}
                        </span>
                        {isDropped ? (
                          <span className="text-[10px] text-rose-700 font-medium flex items-center gap-1 whitespace-nowrap" title={s.dropped_reason || 'Dropped'}>
                            <UserX className="w-3 h-3 text-rose-600 shrink-0" />
                            Dropped: {s.dropped_date || 'N/A'}
                          </span>
                        ) : s.category === 'Lateral Entry' ? (
                          <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1 whitespace-nowrap">
                            <Calendar className="w-3 h-3 text-amber-500 shrink-0" />
                            Joined: {s.joining_date || lateralJoiningDate || 'Not set'}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">
                      <div className="whitespace-nowrap">{s.mobile || '—'}</div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[150px] font-mono">{s.email || '—'}</div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {showPercentages ? (
                        <div className="flex items-center space-x-2">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-extrabold border ${badgeColor}`}>
                            {formatAttendancePercentage(s.percentage)}%
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            ({s.attended}/{s.conducted})
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1.5">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                            {s.attended} / {s.conducted}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">attended</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center space-x-1">
                        {isDropped ? (
                          <button
                            onClick={() => handleRestoreStudent(s)}
                            disabled={restoringId === s.id}
                            className="p-1 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                            title="Restore Student to Active Roster"
                          >
                            <RotateCcw className="w-4 h-4 text-emerald-600" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setDropModalStudent(s);
                              setDropReason('Left College / Discontinued');
                              setDropDate(getLocalDateISO());
                            }}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title="Mark Student as Dropped from College"
                          >
                            <UserMinus className="w-4 h-4 text-rose-500" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingStudent({ ...s })}
                          className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition cursor-pointer"
                          title="Edit Student Details"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onViewStudentDetail && onViewStudentDetail(s.reg_no)}
                          className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                          title="View Full Student Dashboard"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-xl border border-slate-200">
            <h4 className="text-base font-black text-slate-900 mb-4">Add Student Record</h4>
            <form onSubmit={handleAddStudent} className="space-y-3.5 text-xs">
              
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Registration Number (12 digits) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={12}
                  minLength={12}
                  value={newStudent.reg_no}
                  onChange={(e) => {
                    const reg = e.target.value;
                    setNewStudent({
                      ...newStudent,
                      reg_no: reg,
                      category: isLateralReg(reg) ? 'Lateral Entry' : newStudent.category,
                      joining_date: isLateralReg(reg) ? lateralJoiningDate : ''
                    });
                  }}
                  placeholder="e.g. 999999000141"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Student Name (Up to 100 characters) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={newStudent.name}
                  onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                  placeholder="e.g. Kondeti Sai Teja"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Batch *</label>
                  <select
                    value={newStudent.batch}
                    onChange={(e) => setNewStudent({ ...newStudent, batch: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="Batch 1">Batch 1</option>
                    <option value="Batch 2">Batch 2</option>
                    <option value="Batch 3">Batch 3</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Mobile Number</label>
                  <input
                    type="text"
                    value={newStudent.mobile}
                    onChange={(e) => setNewStudent({ ...newStudent, mobile: e.target.value })}
                    placeholder="+91 90000..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Student Email</label>
                <input
                  type="email"
                  value={newStudent.email}
                  onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                  placeholder="student@example.edu"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Admission Category *</label>
                  <select
                    value={isLateralReg(newStudent.reg_no) ? 'Lateral Entry' : newStudent.category}
                    disabled={isLateralReg(newStudent.reg_no)}
                    onChange={(e) => setNewStudent({ 
                      ...newStudent, 
                      category: e.target.value,
                      joining_date: e.target.value === 'Lateral Entry' ? (newStudent.joining_date || lateralJoiningDate || '') : null
                    })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="EAPCET Admission">EAPCET Admission (001-062)</option>
                    <option value="Foreigners">Foreigners (063-117)</option>
                    <option value="Sweden Batch">Sweden Batch (118-124)</option>
                    <option value="Lateral Entry">Lateral Entry (125+)</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Admission Number</label>
                  <input
                    type="text"
                    value={newStudent.admission_no}
                    onChange={(e) => setNewStudent({ ...newStudent, admission_no: e.target.value })}
                    placeholder="TEST-CSE-2026-..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              {(newStudent.category === 'Lateral Entry' || isLateralReg(newStudent.reg_no)) && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                  <label className="block font-bold text-amber-800 uppercase tracking-wider text-[11px]">
                    Lateral Entry Attendance Start Date
                  </label>
                  <div className="w-full px-3 py-2 bg-amber-100/60 border border-amber-200 rounded-lg font-mono text-xs font-black text-amber-900">
                    {lateralJoiningDate || '2026-08-02'}
                  </div>
                  <p className="text-[10px] text-amber-700">Semester default for new/unspecified lateral students. Individual joining dates can be edited in each student record.</p>
                </div>
              )}

              <div className="pt-3 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Save Student
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Configure Batch Ranges Modal */}
      {showBatchRangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-xl border border-slate-200">
            <h4 className="text-base font-black text-slate-900 mb-2">Configure Lab Batch Ranges</h4>
            <p className="text-xs text-slate-500 mb-4">
              Specify registration number ranges for Batch 1, Batch 2, and Batch 3 (used for lab attendance filtering).
            </p>

            <form onSubmit={handleSaveBatchRanges} className="space-y-4 text-xs">
              {/* Batch 1 */}
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <span className="font-black text-slate-800 uppercase block">Batch 1 Allocation</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    value={editRanges.b1_start}
                    onChange={(e) => setEditRanges({ ...editRanges, b1_start: e.target.value })}
                    placeholder="Start Reg No"
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                  <input
                    type="text"
                    required
                    value={editRanges.b1_end}
                    onChange={(e) => setEditRanges({ ...editRanges, b1_end: e.target.value })}
                    placeholder="End Reg No"
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              {/* Batch 2 */}
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <span className="font-black text-slate-800 uppercase block">Batch 2 Allocation</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    value={editRanges.b2_start}
                    onChange={(e) => setEditRanges({ ...editRanges, b2_start: e.target.value })}
                    placeholder="Start Reg No"
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                  <input
                    type="text"
                    required
                    value={editRanges.b2_end}
                    onChange={(e) => setEditRanges({ ...editRanges, b2_end: e.target.value })}
                    placeholder="End Reg No"
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              {/* Batch 3 */}
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <span className="font-black text-slate-800 uppercase block">Batch 3 Allocation</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    value={editRanges.b3_start}
                    onChange={(e) => setEditRanges({ ...editRanges, b3_start: e.target.value })}
                    placeholder="Start Reg No"
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                  <input
                    type="text"
                    required
                    value={editRanges.b3_end}
                    onChange={(e) => setEditRanges({ ...editRanges, b3_end: e.target.value })}
                    placeholder="End Reg No"
                    className="px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowBatchRangeModal(false)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Save Batch Ranges
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lateral Entry default joining/attendance start date modal */}
      {showLateralDateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-xl border border-slate-200">
            <h4 className="text-base font-black text-slate-900 mb-1 flex items-center space-x-2">
              <GraduationCap className="w-4.5 h-4.5 text-amber-600" />
              <span>Lateral Entry Attendance Start Date</span>
            </h4>
            <p className="text-xs text-slate-500 mb-4">
              This is the date from which attendance starts counting for Lateral Entry
              students (125+ series). Classes held before this date will not affect their
              percentage. Updating it applies to <span className="font-bold text-slate-700">every</span> current
              Lateral Entry student and becomes the default for new ones.
            </p>

            <label className="text-[11px] font-black text-slate-500 uppercase block mb-1.5">
              Effective Start Date
            </label>
            <input
              type="date"
              value={lateralJoiningDate}
              onChange={(e) => setLateralJoiningDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl font-mono text-sm mb-4"
            />

            <div className="pt-2 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowLateralDateModal(false)}
                className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl"
                disabled={updatingLateralDate}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleUpdateAllLateralDate();
                  setShowLateralDateModal(false);
                }}
                disabled={updatingLateralDate || !lateralJoiningDate}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-xs flex items-center space-x-1.5"
              >
                {updatingLateralDate ? (
                  <span>Updating...</span>
                ) : (
                  <span>Update All Lateral Entries</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Student Details Modal */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-xl border border-slate-200">
            <h4 className="text-base font-black text-slate-900 mb-1">Edit Student Record</h4>
            <p className="text-xs text-slate-500 mb-4 font-mono">
              Roll: <span className="font-bold text-slate-800">{editingStudent.reg_no}</span>
            </p>
            <form onSubmit={handleSaveStudentEdit} className="space-y-3.5 text-xs">
              
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Student Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={editingStudent.name}
                  onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Batch *</label>
                  <select
                    value={editingStudent.batch}
                    onChange={(e) => setEditingStudent({ ...editingStudent, batch: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="Batch 1">Batch 1</option>
                    <option value="Batch 2">Batch 2</option>
                    <option value="Batch 3">Batch 3</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Mobile Number</label>
                  <input
                    type="text"
                    value={editingStudent.mobile || ''}
                    onChange={(e) => setEditingStudent({ ...editingStudent, mobile: e.target.value })}
                    placeholder="+91 90000..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Student Email</label>
                <input
                  type="email"
                  value={editingStudent.email || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, email: e.target.value })}
                  placeholder="student@example.edu"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Admission Category *</label>
                  <select
                    value={isLateralReg(editingStudent.reg_no) ? 'Lateral Entry' : (editingStudent.category || 'EAPCET Admission')}
                    disabled={isLateralReg(editingStudent.reg_no)}
                    onChange={(e) => setEditingStudent({ 
                      ...editingStudent, 
                      category: e.target.value,
                      joining_date: e.target.value === 'Lateral Entry' ? (editingStudent.joining_date || lateralJoiningDate || '') : null
                    })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="EAPCET Admission">EAPCET Admission (001-062)</option>
                    <option value="Foreigners">Foreigners (063-117)</option>
                    <option value="Sweden Batch">Sweden Batch (118-124)</option>
                    <option value="Lateral Entry">Lateral Entry (125+)</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Admission Number</label>
                  <input
                    type="text"
                    value={editingStudent.admission_no || ''}
                    onChange={(e) => setEditingStudent({ ...editingStudent, admission_no: e.target.value })}
                    placeholder="TEST-CSE-2026-..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              {isLateralReg(editingStudent.reg_no) && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                  <label className="block font-bold text-amber-800 uppercase tracking-wider text-[11px]">
                    Individual Lateral Entry Joining Date
                  </label>
                  <input
                    type="date"
                    value={editingStudent.joining_date || lateralJoiningDate || '2026-08-02'}
                    onChange={(e) => setEditingStudent({ ...editingStudent, joining_date: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg font-mono text-xs font-black text-amber-900"
                  />
                  <p className="text-[10px] text-amber-700">
                    This date applies only to this lateral student. The semester date above remains the default for new lateral students.
                  </p>
                </div>
              )}

              <div className="pt-3 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Save Changes
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Drop Student Confirmation Modal */}
      {dropModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <UserMinus className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">Mark Student as Dropped</h4>
                <p className="text-xs text-slate-500">
                  {dropModalStudent.name} • Roll: {dropModalStudent.reg_no}
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              <p className="font-semibold">Note on dropped status:</p>
              <p className="text-[11px] mt-0.5 text-amber-800 leading-relaxed">
                Dropped students will no longer appear on daily attendance marking sheets and are excluded from class average calculations. You can restore this student back to the active class roster at any time.
              </p>
            </div>

            <form onSubmit={handleConfirmDrop} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Reason for Dropping *
                </label>
                <select
                  value={dropReason}
                  onChange={(e) => setDropReason(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium mb-1.5"
                >
                  <option value="Left College / Discontinued">Left College / Discontinued</option>
                  <option value="Transferred / Branch Transfer">Transferred / Branch Transfer</option>
                  <option value="Seat Cancelled / Admission Withdrawn">Seat Cancelled / Admission Withdrawn</option>
                  <option value="Other">Other Reason</option>
                </select>
                {dropReason === 'Other' && (
                  <input
                    type="text"
                    required
                    placeholder="Specify reason..."
                    onChange={(e) => setDropReason(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Effective Drop Date *
                </label>
                <input
                  type="date"
                  required
                  value={dropDate}
                  onChange={(e) => setDropDate(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDropModalStudent(null)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dropping}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs transition disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
                >
                  {dropping ? 'Dropping...' : 'Confirm Drop Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Smart Universal Paste / Bulk Ingestion Modal (Item 8) */}
      {showSmartImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">Smart Universal Paste & Ingestion</h4>
                <p className="text-xs text-slate-500">
                  Paste unstructured student roster text from WhatsApp, Excel, CSV, or documents in any format.
                </p>
              </div>
            </div>

            <div className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-xl text-xs text-indigo-900 leading-relaxed">
              💡 <strong>Two ways to paste:</strong> (1) Select the whole column block straight out of Excel/Sheets
              (<span className="font-mono">Name of the Candidate, Registration Number, Mobile Number, Admn.No, Email Address, Category of admission</span> —
              any order, with or without the header row, blanks are fine) and paste it as-is. (2) Or paste unstructured
              notes (WhatsApp text, one student per line) — the engine finds 12-digit AU roll numbers, names, phone
              numbers, emails and batches automatically.
            </div>

            {smartImportResult && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 font-medium space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-emerald-950 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Import Summary</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="p-2 bg-white rounded-lg border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Added</span>
                    <strong className="text-emerald-700 text-sm font-mono">{smartImportResult.added}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Updated</span>
                    <strong className="text-blue-700 text-sm font-mono">{smartImportResult.updated}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Already Existed</span>
                    <strong className="text-amber-700 text-sm font-mono">{smartImportResult.skipped}</strong>
                  </div>
                </div>
                {smartImportResult.unparsed_rows && smartImportResult.unparsed_rows.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[11px] font-bold text-red-700 mb-1">
                      {smartImportResult.unparsed_rows.length} row(s) couldn't be read:
                    </div>
                    <ul className="ml-4 list-disc text-[11px] text-red-700 space-y-0.5">
                      {smartImportResult.unparsed_rows.slice(0, 15).map((r, i) => <li key={i}>{r}</li>)}
                      {smartImportResult.unparsed_rows.length > 15 && (
                        <li>…and {smartImportResult.unparsed_rows.length - 15} more.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleSmartImportSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Paste Raw Student Text *
                </label>
                <textarea
                  required
                  rows={8}
                  value={smartImportText}
                  onChange={(e) => setSmartImportText(e.target.value)}
                  placeholder={`Paste a whole Excel column block directly, e.g.:
Name of the Candidate\tRegistration Number\tMobile Number\tAdmn.No\tEmail Address\tCategory of admission
Example Student\t999999000001\t9000000001\t\tstudent@example.edu\tConvener (EAPCET)

...or unstructured notes, one student per line:
999999000001 Example Student 9000000001 Batch 1
999999000002 Example Student student@example.edu
999999000126 Ravi Kumar (Lateral Entry)`}
                  className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center space-x-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <input
                  type="checkbox"
                  id="overwriteExistingCheck"
                  checked={smartImportOverwrite}
                  onChange={(e) => setSmartImportOverwrite(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="overwriteExistingCheck" className="text-xs text-slate-700 font-medium cursor-pointer">
                  <strong>Overwrite / update existing student details</strong> if roll number already exists in database (otherwise skip duplicates)
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSmartImportModal(false)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={smartImporting}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs transition disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer"
                >
                  {smartImporting ? 'Processing & Ingesting...' : 'Parse & Ingest Students'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
