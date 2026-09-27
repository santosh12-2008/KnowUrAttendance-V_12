import React, { useState, useEffect } from 'react';
import { Clock, Plus, Trash2, BookOpen, Layers, CheckCircle2, AlertCircle, Edit3, UserCheck } from 'lucide-react';

export default function TimetableManager({ onTimetableUpdated }) {
  const [timetable, setTimetable] = useState({ grouped: {}, all_slots: [] });
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddSubjectModal, setShowAddSubjectModal] = useState(false);
  const [showManageSubjectsModal, setShowManageSubjectsModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null);

  // New slot form state
  const [newSlot, setNewSlot] = useState({
    day_of_week: 'Monday',
    start_time: '09:00 AM',
    end_time: '09:50 AM',
    subject_id: '',
    slot_type: 'Theory',
    batch: 'All'
  });

  // New subject form state
  const [newSubject, setNewSubject] = useState({
    code: '',
    name: '',
    type: 'Theory',
    faculty_name: ''
  });

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ttRes, subRes] = await Promise.all([
        fetch('/api/timetable'),
        fetch('/api/subjects')
      ]);
      const ttData = await ttRes.json();
      const subData = await subRes.json();
      setTimetable(ttData);
      setSubjects(subData);
      if (subData.length > 0 && !newSlot.subject_id) {
        setNewSlot(prev => ({ ...prev, subject_id: subData[0].id }));
      }
    } catch (err) {
      console.error('Error fetching timetable/subjects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddSlot = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newSlot,
          subject_id: parseInt(newSlot.subject_id, 10)
        })
      });
      if (!res.ok) throw new Error('Failed to add timetable slot');
      setShowAddModal(false);
      fetchData();
      if (onTimetableUpdated) onTimetableUpdated();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteSlot = async (slotId) => {
    if (!window.confirm('Delete this timetable slot?')) return;
    try {
      const res = await fetch(`/api/timetable/${slotId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete slot');
      fetchData();
      if (onTimetableUpdated) onTimetableUpdated();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAddSubject = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSubject)
      });
      if (!res.ok) throw new Error('Failed to add subject');
      setShowAddSubjectModal(false);
      setNewSubject({ code: '', name: '', type: 'Theory', faculty_name: '' });
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveSubjectEdit = async (e) => {
    e.preventDefault();
    if (!editingSubject) return;
    try {
      const res = await fetch(`/api/subjects/${editingSubject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: editingSubject.code,
          name: editingSubject.name,
          type: editingSubject.type,
          faculty_name: editingSubject.faculty_name
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update subject');
      setEditingSubject(null);
      fetchData();
      if (onTimetableUpdated) onTimetableUpdated();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteSubject = async (subjectId) => {
    if (!window.confirm('Are you sure you want to delete this subject?')) return;
    try {
      const res = await fetch(`/api/subjects/${subjectId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete subject');
      fetchData();
      if (onTimetableUpdated) onTimetableUpdated();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <span>Weekly Timetable & Schedule</span>
          </h3>
          <p className="text-xs text-slate-500">
            Configure Theory and Batch-wise Lab classes for Monday through Saturday.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setShowManageSubjectsModal(true)}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center space-x-1.5"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Manage Subjects & Faculty ({subjects.length})</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add Time Slot</span>
          </button>
        </div>
      </div>

      {/* Weekly Schedule Days Grid */}
      {loading ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
          <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading weekly timetable...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {days.map((day) => {
            const slots = timetable.grouped?.[day] || [];
            return (
              <div key={day} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs flex flex-col">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-black text-xs uppercase tracking-wider text-slate-800">{day}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                    {slots.length} Classes
                  </span>
                </div>

                <div className="p-3 space-y-2 flex-1">
                  {slots.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 font-medium">
                      No classes scheduled
                    </div>
                  ) : (
                    slots.map((s) => (
                      <div 
                        key={s.id} 
                        className="p-3 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition flex items-start justify-between gap-2 group"
                      >
                        <div className="overflow-hidden">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-mono text-[10px] font-black text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                              {s.subject_code}
                            </span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                              s.slot_type === 'Lab' ? 'bg-purple-100 text-purple-800' : 'bg-slate-200 text-slate-700'
                            }`}>
                              {s.slot_type} ({s.batch})
                            </span>
                          </div>
                          <div className="font-bold text-xs text-slate-800 truncate" title={s.subject_name}>
                            {s.subject_name}
                          </div>
                          <div className="text-[10px] text-blue-700 font-medium truncate flex items-center gap-1 mt-0.5" title={s.faculty_name || 'Department Faculty'}>
                            <UserCheck className="w-3 h-3 text-blue-500 shrink-0" />
                            <span>{s.faculty_name || 'Department Faculty'}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {s.start_time} - {s.end_time}
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeleteSlot(s.id)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 p-1 rounded transition"
                          title="Delete slot"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Slot Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-xl border border-slate-200">
            <h4 className="text-base font-black text-slate-900 mb-4">Add Timetable Slot</h4>
            <form onSubmit={handleAddSlot} className="space-y-3.5 text-xs">
              
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Day of Week</label>
                <select
                  value={newSlot.day_of_week}
                  onChange={(e) => setNewSlot({ ...newSlot, day_of_week: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                >
                  {days.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Subject</label>
                <select
                  value={newSlot.subject_id}
                  onChange={(e) => {
                    const sub = subjects.find(s => s.id === parseInt(e.target.value, 10));
                    setNewSlot({ 
                      ...newSlot, 
                      subject_id: e.target.value,
                      slot_type: sub ? sub.type : 'Theory'
                    });
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                >
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>{s.code} - {s.name} ({s.type})</option>
                  ))}
                </select>
              </div>

              {/* AUCE Standard Time Presets */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  AUCE Standard Time Slots
                </label>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  <button
                    type="button"
                    onClick={() => setNewSlot({ ...newSlot, start_time: '09:00 AM', end_time: '10:40 AM' })}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold text-center transition ${
                      newSlot.start_time === '09:00 AM' && newSlot.end_time === '10:40 AM'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div>Period 1</div>
                    <div className="text-[10px] font-mono opacity-85">9:00 - 10:40</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewSlot({ ...newSlot, start_time: '10:40 AM', end_time: '12:20 PM' })}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold text-center transition ${
                      newSlot.start_time === '10:40 AM' && newSlot.end_time === '12:20 PM'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div>Period 2</div>
                    <div className="text-[10px] font-mono opacity-85">10:40 - 12:20</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewSlot({ ...newSlot, start_time: '01:30 PM', end_time: '03:10 PM' })}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold text-center transition ${
                      newSlot.start_time === '01:30 PM' && newSlot.end_time === '03:10 PM'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div>Period 3</div>
                    <div className="text-[10px] font-mono opacity-85">1:30 - 3:10</div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Start Time (Custom / Extra)</label>
                  <input
                    type="text"
                    value={newSlot.start_time}
                    onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                    placeholder="e.g. 09:00 AM"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">End Time</label>
                  <input
                    type="text"
                    value={newSlot.end_time}
                    onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
                    placeholder="e.g. 10:40 AM"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Type</label>
                  <select
                    value={newSlot.slot_type}
                    onChange={(e) => setNewSlot({ 
                      ...newSlot, 
                      slot_type: e.target.value,
                      batch: e.target.value === 'Lab' ? 'Batch 1' : 'All'
                    })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="Theory">Theory Class</option>
                    <option value="Lab">Lab Practical</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Target Batch</label>
                  <select
                    value={newSlot.batch}
                    onChange={(e) => setNewSlot({ ...newSlot, batch: e.target.value })}
                    disabled={newSlot.slot_type === 'Theory'}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium disabled:opacity-50"
                  >
                    <option value="All">All Students (Full Class)</option>
                    <option value="Batch 1">Batch 1</option>
                    <option value="Batch 2">Batch 2</option>
                    <option value="Batch 3">Batch 3</option>
                  </select>
                </div>
              </div>

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
                  Save Slot
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Add Subject Modal */}
      {showAddSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-xl border border-slate-200">
            <h4 className="text-base font-black text-slate-900 mb-4">Add Semester Subject</h4>
            <form onSubmit={handleAddSubject} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Subject Code</label>
                <input
                  type="text"
                  required
                  value={newSubject.code}
                  onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value })}
                  placeholder="e.g. CS3109"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Subject Name</label>
                <input
                  type="text"
                  required
                  value={newSubject.name}
                  onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })}
                  placeholder="e.g. Artificial Intelligence"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Type</label>
                  <select
                    value={newSubject.type}
                    onChange={(e) => setNewSubject({ ...newSubject, type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="Theory">Theory</option>
                    <option value="Lab">Lab</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Faculty Name</label>
                  <input
                    type="text"
                    value={newSubject.faculty_name}
                    onChange={(e) => setNewSubject({ ...newSubject, faculty_name: e.target.value })}
                    placeholder="e.g. Prof. Rao"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddSubjectModal(false)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Save Subject
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Subjects & Faculty Modal */}
      {showManageSubjectsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-xl border border-slate-200 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div>
                <h4 className="text-base font-black text-slate-900">Manage Semester Subjects & Faculty</h4>
                <p className="text-xs text-slate-500">View and update faculty incharge or subject details anytime.</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowAddSubjectModal(true)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add New</span>
                </button>
                <button
                  onClick={() => setShowManageSubjectsModal(false)}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs rounded-xl"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 uppercase font-black text-[10px]">
                    <th className="py-2.5 px-3">Code</th>
                    <th className="py-2.5 px-3">Subject Name</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Faculty / Professor</th>
                    <th className="py-2.5 px-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subjects.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{sub.code}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">{sub.name}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          sub.type === 'Lab' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {sub.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-medium">
                        {sub.faculty_name || <span className="text-slate-400 italic">Not set</span>}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            onClick={() => setEditingSubject({ ...sub })}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Edit Subject & Faculty"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteSubject(sub.id)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Delete Subject"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Edit Subject Modal */}
      {editingSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-xl border border-slate-200">
            <h4 className="text-base font-black text-slate-900 mb-4">Edit Course / Professor Details</h4>
            <form onSubmit={handleSaveSubjectEdit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Subject Code *</label>
                <input
                  type="text"
                  required
                  value={editingSubject.code}
                  onChange={(e) => setEditingSubject({ ...editingSubject, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono uppercase"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Subject Name *</label>
                <input
                  type="text"
                  required
                  value={editingSubject.name}
                  onChange={(e) => setEditingSubject({ ...editingSubject, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Type</label>
                  <select
                    value={editingSubject.type}
                    onChange={(e) => setEditingSubject({ ...editingSubject, type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="Theory">Theory</option>
                    <option value="Lab">Lab</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Professor / Faculty Name *</label>
                  <input
                    type="text"
                    required
                    value={editingSubject.faculty_name || ''}
                    onChange={(e) => setEditingSubject({ ...editingSubject, faculty_name: e.target.value })}
                    placeholder="e.g. Dr. K. Srinivasa Rao"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingSubject(null)}
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

    </div>
  );
}
