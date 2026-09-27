import React, { useState, useEffect } from 'react';
import { KeyRound, CheckCircle2, XCircle, Clock, AlertTriangle, X, RefreshCw, Check, Shield } from 'lucide-react';

export default function StudentPasswordRequestsModal({ isOpen, onClose, token, onRequestsUpdated }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('ALL'); // ALL, PENDING, APPROVED, DENIED
  const [processingId, setProcessingId] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/password-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
        if (onRequestsUpdated) onRequestsUpdated(data);
      }
    } catch (err) {
      console.error('Error fetching password requests:', err);
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

  const handleAction = async (requestId, action) => {
    setProcessingId(requestId);
    setStatusMsg('');
    try {
      const res = await fetch(`/api/auth/password-requests/${requestId}/action`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Failed to ${action.toLowerCase()} request`);
      
      setStatusMsg(data.message || `Request ${action.toLowerCase()}d successfully.`);
      await fetchRequests();
    } catch (err) {
      alert(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const filtered = requests.filter(r => {
    if (filter === 'ALL') return true;
    return r.status?.toUpperCase() === filter;
  });

  const pendingCount = requests.filter(r => r.status?.toUpperCase() === 'PENDING').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-700">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">Student Password Reset Requests</h3>
                {pendingCount > 0 && (
                  <span className="bg-amber-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {pendingCount} Pending
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Review and approve student password reset submissions
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
          {['ALL', 'PENDING', 'APPROVED', 'DENIED'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer ${
                filter === f
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f === 'ALL' ? 'All Requests' : f.charAt(0) + f.slice(1).toLowerCase()}
              {f === 'PENDING' && pendingCount > 0 && ` (${pendingCount})`}
            </button>
          ))}
        </div>

        {statusMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-center justify-between shrink-0">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {statusMsg}
            </span>
            <button onClick={() => setStatusMsg('')} className="text-emerald-500 hover:text-emerald-800">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Content list */}
        <div className="overflow-y-auto flex-1 space-y-2.5 pr-1">
          {loading && requests.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-600" />
              Loading password requests...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              No {filter !== 'ALL' ? filter.toLowerCase() : ''} password reset requests found.
            </div>
          ) : (
            filtered.map((req) => {
              const isPending = req.status?.toUpperCase() === 'PENDING';
              const isApproved = req.status?.toUpperCase() === 'APPROVED';
              const isDenied = req.status?.toUpperCase() === 'DENIED';

              return (
                <div
                  key={req.id}
                  className={`p-4 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                    isPending
                      ? 'bg-amber-50/50 border-amber-200'
                      : isApproved
                      ? 'bg-emerald-50/30 border-emerald-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{req.student_name}</span>
                      <span className="font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                        {req.student_reg_no}
                      </span>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          isPending
                            ? 'bg-amber-100 text-amber-800'
                            : isApproved
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {req.status}
                      </span>
                    </div>

                    <div className="text-slate-500 text-[11px] mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Requested: {new Date(req.created_at).toLocaleString()}</span>
                      {req.resolved_by && (
                        <span>• Action by: {req.resolved_by} ({new Date(req.resolved_at).toLocaleDateString()})</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {isPending ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAction(req.id, 'APPROVE')}
                        disabled={processingId === req.id}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAction(req.id, 'DENY')}
                        disabled={processingId === req.id}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-xl transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Deny</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-right shrink-0">
                      <span className="text-[11px] font-medium text-slate-400">
                        {isApproved ? 'Password Updated in DB' : 'Request Rejected'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span>Student passwords are encrypted and managed authorized by CR</span>
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
