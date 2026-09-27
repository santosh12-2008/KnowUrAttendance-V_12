import React, { useState } from 'react';
import { Database, Download, Upload, CheckCircle2, AlertTriangle, X, FileJson, Server, HardDrive } from 'lucide-react';

export default function DatabaseBackupModal({ isOpen, onClose, token, onRestored }) {
  const [restoring, setRestoring] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleDownloadDb = () => {
    // Download SQLite binary file using token
    fetch('/api/backup/download-db', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Database download failed');
        return res.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_auce_cse_${new Date().toISOString().slice(0, 10)}.db`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(err => alert(err.message));
  };

  const handleDownloadJson = () => {
    fetch('/api/backup/download-json', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('JSON backup download failed');
        return res.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(err => alert(err.message));
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setRestoring(true);
        setErrorMsg('');
        setSuccessMsg('');
        const parsed = JSON.parse(event.target.result);

        const res = await fetch('/api/backup/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(parsed)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Restore failed');

        setSuccessMsg('Database successfully restored from JSON backup!');
        if (onRestored) onRestored();
      } catch (err) {
        setErrorMsg('Error restoring backup: ' + err.message);
      } finally {
        setRestoring(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-5">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Database Backup & Portability</h3>
              <p className="text-[11px] text-slate-500">1-click export, sharing with a friend & cloud restore</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback alerts */}
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Download Section */}
        <div className="space-y-3">
          <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500">
            Export Database Backups
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleDownloadDb}
              className="p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl text-left transition flex flex-col justify-between group cursor-pointer"
            >
              <div>
                <HardDrive className="w-6 h-6 text-indigo-600 mb-2 group-hover:scale-110 transition" />
                <div className="font-bold text-xs text-slate-900">SQLite Database (.db)</div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Full binary database file. Drop directly into any laptop's backend directory.
                </p>
              </div>
              <div className="mt-3 text-indigo-600 text-xs font-bold flex items-center gap-1">
                <Download className="w-3.5 h-3.5" />
                <span>Download .db</span>
              </div>
            </button>

            <button
              type="button"
              onClick={handleDownloadJson}
              className="p-4 bg-emerald-50/50 hover:bg-emerald-50 border border-emerald-200 rounded-2xl text-left transition flex flex-col justify-between group cursor-pointer"
            >
              <div>
                <FileJson className="w-6 h-6 text-emerald-600 mb-2 group-hover:scale-110 transition" />
                <div className="font-bold text-xs text-emerald-950">JSON Complete Backup</div>
                <p className="text-[11px] text-slate-600 mt-1">
                  Cross-platform structured JSON backup containing all 14 database tables.
                </p>
              </div>
              <div className="mt-3 text-emerald-700 text-xs font-bold flex items-center gap-1">
                <Download className="w-3.5 h-3.5" />
                <span>Download JSON</span>
              </div>
            </button>
          </div>
        </div>

        {/* Restore Section */}
        <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200 space-y-3">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-amber-700" />
            <h4 className="text-xs font-bold text-amber-950">Restore from JSON Backup</h4>
          </div>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            Upload a previously exported JSON backup file to seamlessly restore the full database on Render cloud or any computer.
          </p>

          <label className="block">
            <span className="sr-only">Choose backup JSON</span>
            <input
              type="file"
              accept=".json"
              disabled={restoring}
              onChange={handleFileUpload}
              className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-amber-600 file:text-white hover:file:bg-amber-700 file:cursor-pointer cursor-pointer"
            />
          </label>
        </div>

        {/* Footer info */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>AUCE(A) CSE • Automated Cloud Recovery</span>
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
