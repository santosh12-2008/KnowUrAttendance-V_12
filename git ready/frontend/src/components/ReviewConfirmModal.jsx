import React from 'react';
import { AlertCircle, CheckCircle, X, ShieldAlert, Clock, Calendar } from 'lucide-react';

export default function ReviewConfirmModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  slot, 
  date, 
  dayName, 
  absentStudents, 
  totalEligible, 
  submitting 
}) {
  if (!isOpen) return null;

  const presentCount = totalEligible - absentStudents.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-5 bg-amber-50 border-b border-amber-200/80 flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center font-black shadow-xs">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">
                Confirm Attendance Submission
              </h3>
              <p className="text-xs text-amber-900 font-medium">
                Please review marked absentees before final submission to database.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-white/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          
          {/* Slot Metadata Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs space-y-2">
            <div className="flex items-center justify-between font-bold text-slate-800">
              <span className="text-sm font-black text-slate-900">{slot?.subject_name}</span>
              <span className="font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{slot?.subject_code}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-slate-500 font-medium pt-1">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {date} ({dayName})
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                {slot?.start_time} – {slot?.end_time}
              </span>
              <span>•</span>
              <span className="bg-slate-200 px-1.5 py-0.5 rounded font-bold text-[10px] text-slate-700 uppercase">
                {slot?.slot_type} ({slot?.batch})
              </span>
            </div>
          </div>

          {/* Counts summary bar */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2.5 bg-slate-100 rounded-xl">
              <span className="block text-[10px] font-bold text-slate-400 uppercase">Total Eligible</span>
              <span className="text-base font-black text-slate-800 font-mono">{totalEligible}</span>
            </div>
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
              <span className="block text-[10px] font-bold text-emerald-600 uppercase">Present</span>
              <span className="text-base font-black text-emerald-800 font-mono">{presentCount}</span>
            </div>
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl">
              <span className="block text-[10px] font-bold text-red-600 uppercase">Marked Absent</span>
              <span className="text-base font-black text-red-800 font-mono">{absentStudents.length}</span>
            </div>
          </div>

          {/* List of Marked Absentees */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
                Absentees List ({absentStudents.length})
              </h4>
              {absentStudents.length === 0 && (
                <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> 100% Attendance (No Absentees)
                </span>
              )}
            </div>

            {absentStudents.length > 0 ? (
              <div className="bg-red-50/50 border border-red-200 rounded-2xl p-3 max-h-52 overflow-y-auto divide-y divide-red-100">
                {absentStudents.map((s) => (
                  <div key={s.id} className="py-2 px-1 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2.5">
                      <span className="w-9 h-7 rounded-lg bg-red-600 text-white font-mono font-black flex items-center justify-center text-xs shadow-2xs">
                        {s.reg_no_last3}
                      </span>
                      <div>
                        <div className="font-bold text-slate-900">{s.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{s.reg_no}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                      Absent
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center">
                <p className="text-xs text-slate-500 font-medium">
                  All {totalEligible} students are marked <span className="font-bold text-emerald-600">Present</span>.
                </p>
              </div>
            )}
          </div>

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-white transition"
          >
            Back to Edit
          </button>
          
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-sm flex items-center space-x-1.5 disabled:opacity-50"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Confirm & Commit to Database</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
