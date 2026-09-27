import React, { useState, useEffect } from 'react';
import { Layers, GraduationCap, CheckCircle2, Clock, Calendar, X, RefreshCw, Check, Plus } from 'lucide-react';

export default function SemesterSwitcherModal({ isOpen, onClose, token, isCr, canDelete = false, onSemesterChanged }) {
  const [semesters, setSemesters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activatingId, setActivatingId] = useState(null);
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSem, setNewSem] = useState({ academic_year: '', name: '', start_month: '', end_month: '', active_month: '', continue_student_details: true });
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fetchSemesters = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/semesters');
      if (res.ok) {
        const data = await res.json();
        setSemesters(data);
      }
    } catch (err) {
      console.error('Failed to fetch semesters:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSemesters();
    }
  }, [isOpen]);


  const handleCreate = async (e) => {
    e.preventDefault(); setCreating(true); setMessage('');
    try {
      const res = await fetch('/api/semesters/new', {
        method: 'POST', headers: {'Content-Type':'application/json','Authorization':`Bearer ${token}`},
        body: JSON.stringify(newSem)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to create semester');
      setMessage(`Created ${newSem.name}. ${data.students_copied || 0} student details continued. The current semester was not changed. Switch to the new semester to configure it.`);
      setShowCreate(false); await fetchSemesters();
      window.dispatchEvent(new Event('semester-changed'));
      if (onSemesterChanged) onSemesterChanged(true);
    } catch (err) { alert(err.message); }
    finally { setCreating(false); }
  };

  const handleDeleteSemester = async () => {
    if (!deleteCandidate || deleteConfirmText.trim().toUpperCase() !== 'DELETE SEMESTER') return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/semesters/${deleteCandidate.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ confirmation: deleteConfirmText.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to delete semester');
      setMessage(data.message || 'Semester deleted.');
      setDeleteCandidate(null);
      setDeleteConfirmText('');
      await fetchSemesters();
      window.dispatchEvent(new Event('semester-changed'));
      if (onSemesterChanged) onSemesterChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (!isOpen) return null;

  const handleActivate = async (semId) => {
    setActivatingId(semId);
    setMessage('');
    try {
      const res = await fetch(`/api/semesters/${semId}/activate`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to activate semester');
      
      setMessage(data.message || 'Semester switched successfully!');
      await fetchSemesters();
      window.dispatchEvent(new Event('semester-changed'));
      if (onSemesterChanged) onSemesterChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setActivatingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="relative bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[85vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-700">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Academic Semester Switcher</h3>
              <p className="text-[11px] text-slate-500">Switch between current semester and previous archived semesters</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isCr && <button type="button" onClick={() => setShowCreate(true)} className="px-3 py-1.5 bg-indigo-600 text-white font-bold rounded-xl text-xs flex items-center gap-1"><Plus className="w-3.5 h-3.5"/> New Semester</button>}
            <button 
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {message && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{message}</span>
          </div>
        )}


        {showCreate && (
          <form onSubmit={handleCreate} className="absolute inset-4 z-10 bg-white rounded-2xl border border-slate-200 shadow-xl p-5 space-y-3 overflow-y-auto">
            <div className="flex items-center justify-between"><h4 className="font-black text-slate-900">Create New Semester</h4><button type="button" onClick={()=>setShowCreate(false)}><X className="w-4 h-4"/></button></div>
            <p className="text-[11px] text-slate-500">Creates a separate semester. The current semester stays active. Attendance is never copied.</p>
            <input required placeholder="Academic Year e.g. 2026-2027" value={newSem.academic_year} onChange={e=>setNewSem({...newSem,academic_year:e.target.value})} className="w-full p-2 border rounded-lg"/>
            <input required placeholder="Semester name e.g. B.Tech CSE - 2-2" value={newSem.name} onChange={e=>setNewSem({...newSem,name:e.target.value})} className="w-full p-2 border rounded-lg"/>
            <div className="grid grid-cols-3 gap-2"><input required type="month" value={newSem.start_month} onChange={e=>setNewSem({...newSem,start_month:e.target.value})} className="p-2 border rounded-lg"/><input required type="month" value={newSem.end_month} onChange={e=>setNewSem({...newSem,end_month:e.target.value})} className="p-2 border rounded-lg"/><input required type="month" value={newSem.active_month} onChange={e=>setNewSem({...newSem,active_month:e.target.value})} className="p-2 border rounded-lg"/></div>
            <label className="flex gap-2 items-start text-xs font-semibold"><input type="checkbox" checked={newSem.continue_student_details} onChange={e=>setNewSem({...newSem,continue_student_details:e.target.checked})}/> Continue previous semester student details. Attendance is never copied.</label>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">After creation, Setup Wizard starts at <b>Step 1</b>. Configure the new semester and its new weekly timetable before marking attendance.</div>
            <div className="flex justify-end gap-2"><button type="button" onClick={()=>setShowCreate(false)} className="px-4 py-2 rounded-xl">Cancel</button><button disabled={creating} className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold">{creating?'Creating...':'Create Semester'}</button></div>
          </form>
        )}

        {/* Semesters List */}
        <div className="overflow-y-auto flex-1 space-y-2.5 pr-1">
          {loading && semesters.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
              Loading academic semesters...
            </div>
          ) : (
            semesters.map((s) => {
              const isActive = s.is_active === 1 || s.is_active === true;
              return (
                <div
                  key={s.id}
                  className={`p-4 rounded-2xl border text-xs flex items-center justify-between gap-3 transition ${
                    isActive
                      ? 'bg-indigo-50/50 border-indigo-300 ring-2 ring-indigo-500/20'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <GraduationCap className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                      <span className="font-bold text-slate-900 text-sm">{s.name}</span>
                      {isActive ? (
                        <span className="bg-indigo-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Active
                        </span>
                      ) : (
                        <span className="bg-slate-200 text-slate-600 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Archived
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                      <span>Academic Year: <strong className="text-slate-700">{s.academic_year}</strong></span>
                      <span>•</span>
                      <span>Span: {s.start_month} to {s.end_month}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isCr && !isActive && (
                      <button
                        type="button"
                        onClick={() => handleActivate(s.id)}
                        disabled={activatingId === s.id}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition text-xs shadow-xs cursor-pointer disabled:opacity-50"
                      >
                        {activatingId === s.id ? 'Switching...' : 'Switch'}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => { setDeleteCandidate(s); setDeleteConfirmText(''); }}
                        className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold rounded-xl text-xs"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {deleteCandidate && (
          <div className="absolute inset-0 z-20 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-5 rounded-3xl">
            <div className="w-full max-w-md bg-white rounded-2xl border border-red-200 shadow-2xl p-5 space-y-4">
              <div>
                <h4 className="font-black text-red-700">Delete semester?</h4>
                <p className="text-xs text-slate-600 mt-1">This permanently deletes <b>{deleteCandidate.name}</b> and its semester-specific attendance, students, timetable, subjects and forms.</p>
              </div>
              <p className="text-[11px] font-semibold text-slate-700">Second confirmation: type <b>DELETE SEMESTER</b> exactly.</p>
              <input value={deleteConfirmText} onChange={e=>setDeleteConfirmText(e.target.value)} autoFocus className="w-full p-2.5 border border-red-200 rounded-xl text-sm" placeholder="DELETE SEMESTER" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={()=>{setDeleteCandidate(null);setDeleteConfirmText('')}} className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
                <button type="button" onClick={handleDeleteSemester} disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE SEMESTER'} className="px-4 py-2 rounded-xl bg-red-600 text-white font-black disabled:opacity-40">{deleting ? 'Deleting...' : 'Permanently Delete'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span>AUCE(A) Department of CSE</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-slate-700 font-bold hover:bg-slate-100 rounded-xl cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
