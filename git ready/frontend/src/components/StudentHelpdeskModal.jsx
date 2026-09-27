import React, { useState, useEffect } from 'react';
import { HelpCircle, Send, MessageSquare, CheckCircle2, Clock, AlertTriangle, X, RefreshCw, ChevronRight } from 'lucide-react';

export default function StudentHelpdeskModal({ isOpen, onClose, token, student }) {
  const [activeTab, setActiveTab] = useState('new'); // 'new', 'history'
  const [category, setCategory] = useState('Attendance Correction');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [myRequests, setMyRequests] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const categories = [
    'Attendance Correction',
    'Bonafide / Certificate',
    'Leave / Permission',
    'Subject / Lab Allocation',
    'General Inquiry'
  ];

  const fetchMyRequests = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/requests/my', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMyRequests(data);
      }
    } catch (err) {
      console.error('Failed to load my requests:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMyRequests();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ category, subject, message })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to submit request');

      setSuccessMsg('Your request has been submitted to CR/LR team! They will respond shortly.');
      setSubject('');
      setMessage('');
      fetchMyRequests();
      setActiveTab('history');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white w-full max-w-xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-700">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Student Helpdesk & Requests</h3>
              <p className="text-[11px] text-slate-500">Contact CR for attendance clarification, permissions, certificates</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="grid grid-cols-2 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('new')}
            className={`py-2 px-3 rounded-xl font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'new'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Submit New Request</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('history'); fetchMyRequests(); }}
            className={`py-2 px-3 rounded-xl font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>My Past Tickets ({myRequests.length})</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-1.5 shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Tab 1: New Form */}
        {activeTab === 'new' ? (
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs overflow-y-auto flex-1 pr-1">
            <div>
              <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1 text-[11px]">
                Request Category *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1 text-[11px]">
                Subject / Brief Title *
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Attendance discrepancy on Sept 14th Period 2"
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1 text-[11px]">
                Detailed Message / Explanation *
              </label>
              <textarea
                rows={4}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your situation in detail. Mention date, subject, reason, or attachment reference..."
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-600 hover:text-slate-800 font-bold rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition text-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {submitting ? 'Submitting...' : 'Submit Request to CR'}
              </button>
            </div>
          </form>
        ) : (
          /* Tab 2: My Tickets History */
          <div className="overflow-y-auto flex-1 space-y-3 pr-1">
            {loadingHistory && myRequests.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                Loading your requests...
              </div>
            ) : myRequests.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                You haven't submitted any inquiries to the CR yet.
              </div>
            ) : (
              myRequests.map((req) => {
                const isPending = req.status?.toUpperCase() === 'PENDING';
                const isInProgress = req.status?.toUpperCase() === 'IN_PROGRESS';
                const isResolved = req.status?.toUpperCase() === 'RESOLVED';

                return (
                  <div
                    key={req.id}
                    className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{req.subject}</span>
                        <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold">
                          {req.category}
                        </span>
                      </div>

                      <span
                        className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          isPending
                            ? 'bg-blue-100 text-blue-800'
                            : isInProgress
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>

                    <p className="text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200/80 leading-relaxed text-[11px]">
                      {req.message}
                    </p>

                    {req.cr_note && (
                      <div className="bg-emerald-50/70 p-2.5 rounded-xl border border-emerald-200 text-[11px] text-emerald-900 space-y-0.5">
                        <div className="font-bold text-emerald-800 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>CR Official Reply:</span>
                        </div>
                        <p>{req.cr_note}</p>
                      </div>
                    )}

                    <div className="text-[10px] text-slate-400">
                      Submitted on {new Date(req.created_at).toLocaleDateString()}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

      </div>
    </div>
  );
}
