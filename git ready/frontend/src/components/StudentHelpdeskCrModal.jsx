import React, { useState, useEffect } from 'react';
import { HelpCircle, MessageSquare, CheckCircle2, Clock, AlertTriangle, X, RefreshCw, Send, ChevronDown, User } from 'lucide-react';

export default function StudentHelpdeskCrModal({ isOpen, onClose, token, onRequestsUpdated }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('ALL'); // ALL, PENDING, IN_PROGRESS, RESOLVED
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState('RESOLVED');
  const [updating, setUpdating] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/requests/all', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
        if (onRequestsUpdated) onRequestsUpdated(data);
      }
    } catch (err) {
      console.error('Error fetching student requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRequests();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOpenReply = (req) => {
    setSelectedRequest(req);
    setReplyText(req.cr_note || '');
    setReplyStatus(req.status === 'PENDING' ? 'RESOLVED' : req.status);
  };

  const handleUpdateStatus = async (e) => {
    e.preventDefault();
    if (!selectedRequest) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/requests/${selectedRequest.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: replyStatus,
          cr_note: replyText
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to update request');
      
      setSuccessMsg(`Ticket #${selectedRequest.id} marked as ${replyStatus}.`);
      setSelectedRequest(null);
      await fetchRequests();
    } catch (err) {
      alert(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const pendingCount = requests.filter(r => r.status?.toUpperCase() === 'PENDING').length;

  const filtered = requests.filter(r => {
    if (filter === 'ALL') return true;
    return r.status?.toUpperCase() === filter;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white w-full max-w-3xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[92vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-700">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">Student Helpdesk & Inquiries</h3>
                {pendingCount > 0 && (
                  <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {pendingCount} Pending
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Attendance clarifications, permission requests, certificate letters & issues
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchRequests}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              title="Refresh requests"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 text-xs shrink-0">
          {['ALL', 'PENDING', 'IN_PROGRESS', 'RESOLVED'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                filter === f
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f === 'ALL' ? 'All Tickets' : f.replace('_', ' ')}
              {f === 'PENDING' && pendingCount > 0 && ` (${pendingCount})`}
            </button>
          ))}
        </div>

        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center justify-between shrink-0">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {successMsg}
            </span>
            <button onClick={() => setSuccessMsg('')} className="text-emerald-500 hover:text-emerald-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Tickets List */}
        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {loading && requests.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
              Loading student inquiries...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              No {filter !== 'ALL' ? filter.toLowerCase() : ''} requests from students.
            </div>
          ) : (
            filtered.map((req) => {
              const isPending = req.status?.toUpperCase() === 'PENDING';
              const isInProgress = req.status?.toUpperCase() === 'IN_PROGRESS';
              const isResolved = req.status?.toUpperCase() === 'RESOLVED';

              return (
                <div
                  key={req.id}
                  className={`p-4 rounded-2xl border text-xs transition space-y-2.5 ${
                    isPending
                      ? 'bg-blue-50/40 border-blue-200'
                      : isInProgress
                      ? 'bg-amber-50/40 border-amber-200'
                      : 'bg-slate-50/60 border-slate-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{req.student_name}</span>
                      <span className="font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                        {req.student_reg_no}
                      </span>
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold border border-indigo-200">
                        {req.category}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                          isPending
                            ? 'bg-blue-100 text-blue-800'
                            : isInProgress
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {req.status}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleOpenReply(req)}
                        className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold rounded-xl text-xs transition cursor-pointer shadow-2xs"
                      >
                        {req.cr_note ? 'Edit Reply' : 'Reply & Update'}
                      </button>
                    </div>
                  </div>

                  {/* Subject & Message */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200/80 space-y-1">
                    <div className="font-bold text-slate-800">{req.subject}</div>
                    <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">
                      {req.message}
                    </p>
                  </div>

                  {/* CR Reply Note if present */}
                  {req.cr_note && (
                    <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200 text-[11px] text-emerald-900">
                      <span className="font-bold block mb-0.5 text-emerald-800">CR Official Response:</span>
                      <p className="whitespace-pre-wrap">{req.cr_note}</p>
                    </div>
                  )}

                  <div className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>Submitted: {new Date(req.created_at).toLocaleString()}</span>
                    <span>{req.student_batch || 'Batch 1'}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Reply Drawer / Modal overlay if answering */}
        {selectedRequest && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div>
                  <h4 className="font-black text-slate-900 text-sm">Reply to {selectedRequest.student_name}</h4>
                  <p className="text-[11px] text-slate-500 font-mono">{selectedRequest.student_reg_no} • {selectedRequest.category}</p>
                </div>
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1">
                <span className="font-bold text-slate-800">{selectedRequest.subject}</span>
                <p className="text-slate-600 text-[11px]">{selectedRequest.message}</p>
              </div>

              <form onSubmit={handleUpdateStatus} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1 text-[11px]">
                    Update Ticket Status
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {['PENDING', 'IN_PROGRESS', 'RESOLVED'].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setReplyStatus(s)}
                        className={`py-2 rounded-xl border font-bold text-xs cursor-pointer transition ${
                          replyStatus === s
                            ? 'bg-blue-600 text-white border-blue-700 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {s.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1 text-[11px]">
                    CR Reply Note / Instructions to Student
                  </label>
                  <textarea
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Enter resolution notes, approval status, or instructions for the student..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSelectedRequest(null)}
                    className="px-4 py-2 text-slate-600 hover:text-slate-800 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updating}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition text-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    {updating ? 'Saving...' : 'Save & Send to Student'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
