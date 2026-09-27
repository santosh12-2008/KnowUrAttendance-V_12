import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatAttendancePercentage } from '../utils/attendance';
import {
  X, Mail, Loader2, CheckCircle2, RefreshCcw, Send, ShieldAlert,
  Users, TrendingDown, Layers, AlertTriangle, Clock, Info
} from 'lucide-react';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const monthLabel = (value) => {
  if (!value || value === 'all') return 'All months';
  const [y, m] = String(value).split('-');
  const idx = parseInt(m, 10) - 1;
  return (idx >= 0 && idx < 12 && y) ? `${MONTH_NAMES[idx]} ${y}` : value;
};

const REPORTS = [
  { id: 'MONTHLY', label: 'Monthly Update', hint: 'One calendar month.' },
  { id: 'CUMULATIVE', label: 'Cumulative', hint: 'Semester to date — exam eligibility.' }
];

/**
 * Email Centre - manual sending only.
 *
 * There is no automatic or scheduled sending. The CR/LR picks a statement type, a
 * period, and who receives it, reviews the exact recipient list, then presses Send.
 * "All students" is the default audience since that is the common case; the shortfall
 * filters are narrower views over the same computation, not separate features.
 */
const AUDIENCES = [
  { id: 'ALL', label: 'All students', icon: Users, hint: 'Send to the whole class in one click' },
  { id: 'BELOW_MONTHLY', label: 'Below 75% — this month', icon: TrendingDown, hint: 'Shortfall in the selected month only' },
  { id: 'BELOW_CUMULATIVE', label: 'Below 75% — cumulative', icon: Layers, hint: 'Shortfall across the semester to date' },
  { id: 'SELECTED', label: 'Pick manually', icon: Send, hint: 'Tick individual students below' }
];

export default function SendAttendanceAlertsModal({ isOpen, onClose, token, currentMonth }) {
  const [status, setStatus] = useState(null);
  const [reportType, setReportType] = useState('MONTHLY');
  const [audience, setAudience] = useState('ALL');
  const [period, setPeriod] = useState(currentMonth && currentMonth !== 'all' ? currentMonth : '');

  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [confirmStep, setConfirmStep] = useState(false);
  const [dismissedReminders, setDismissedReminders] = useState(() => new Set());

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/email/status', { headers: authHeaders });
      const data = await res.json();
      if (res.ok) {
        setStatus(data);
        if (!period && data.active_month) setPeriod(data.active_month);
      }
    } catch { /* status is advisory only */ }
  }, [authHeaders, period]);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const params = new URLSearchParams({
        report_type: reportType,
        audience,
        ...(period ? { period } : {})
      });
      const res = await fetch(`/api/email/recipients?${params}`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not load the recipient list');
      setPreview(data);
      setSelected(new Set(
        data.students.filter(s => s.email && !s.already_sent).map(s => s.student_id)
      ));
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, reportType, audience, period]);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmStep(false);
    fetchStatus();
  }, [isOpen, fetchStatus]);

  useEffect(() => {
    if (!isOpen) return;
    fetchPreview();
  }, [isOpen, reportType, audience, period, fetchPreview]);

  if (!isOpen) return null;

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sendableStudents = (preview?.students || []).filter(s => s.email);
  const allSelected = sendableStudents.length > 0 && sendableStudents.every(s => selected.has(s.student_id));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sendableStudents.map(s => s.student_id)));
  };

  const handleSend = async () => {
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          report_type: reportType,
          period: period || undefined,
          audience: 'SELECTED',
          student_ids: Array.from(selected),
          force_resend: true
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Sending failed');
      setResult(data);
      setConfirmStep(false);
      fetchPreview();
    } catch (err) {
      setError(err.message);
      setConfirmStep(false);
    } finally {
      setSending(false);
    }
  };

  const smtpReady = status?.smtp_configured ?? preview?.smtp_configured;
  const activeReport = REPORTS.find(r => r.id === reportType);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto">

        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <Mail className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-black tracking-tight truncate">Attendance Email Centre</h3>
              <p className="text-[11px] text-slate-400 truncate">
                {smtpReady && status?.sender ? `Sending as ${status.sender}` : 'Sent manually — nothing goes out automatically'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">

          {!smtpReady && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 leading-relaxed">
                <p className="font-black mb-1">Email sending isn't configured on the server.</p>
                <p>Set <code className="bg-amber-100 px-1 rounded font-mono">SMTP_EMAIL</code> and{' '}
                  <code className="bg-amber-100 px-1 rounded font-mono">SMTP_APP_PASSWORD</code> in the
                  environment. You can still preview recipients below.</p>
              </div>
            </div>
          )}

          {/*
            Purely informational - nothing here sends anything. It just tells the CR/LR
            when a month has closed without a statement going out, so nothing gets
            forgotten. Each line is one click away from being set up in the form below;
            dismissing it only hides it for this open of the modal.
          */}
          {(status?.reminders || [])
            .filter(r => !dismissedReminders.has(`${r.period}:${r.report_type}`))
            .map(r => {
              const key = `${r.period}:${r.report_type}`;
              const label = r.report_type === 'MONTHLY' ? 'Monthly Update' : 'Cumulative';
              return (
                <div key={key} className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
                  <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 text-xs text-blue-900 leading-relaxed">
                    <strong>{monthLabel(r.period)}</strong> has closed and no <strong>{label.toLowerCase()}</strong> has
                    been sent for it yet.
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => { setReportType(r.report_type); setPeriod(r.period); }}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] rounded-lg cursor-pointer"
                    >
                      Set up
                    </button>
                    <button
                      onClick={() => setDismissedReminders(prev => new Set(prev).add(key))}
                      className="p-1 text-blue-400 hover:text-blue-700 cursor-pointer"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl">
              {error}
            </div>
          )}

          {result && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1">
              <p className="text-sm font-black text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Sent {result.sent_count} {result.report_type === 'MONTHLY' ? 'monthly' : 'cumulative'} update(s)
              </p>
              {result.failed_count > 0 && (
                <p className="text-xs font-bold text-rose-700">{result.failed_count} failed to send.</p>
              )}
              {result.skipped_count > 0 && (
                <p className="text-xs font-bold text-amber-700">{result.skipped_count} skipped.</p>
              )}
            </div>
          )}

          {/* Step 1: which statement */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">1. Statement type</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {REPORTS.map(r => (
                <button
                  key={r.id}
                  onClick={() => setReportType(r.id)}
                  className={`text-left px-4 py-3 rounded-2xl border transition cursor-pointer ${
                    reportType === r.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-black">{r.label}</div>
                  <div className={`text-[11px] mt-0.5 leading-snug ${reportType === r.id ? 'text-slate-300' : 'text-slate-500'}`}>
                    {r.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: period */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">
              2. {reportType === 'MONTHLY' ? 'Which month' : 'Computed up to'}
            </p>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full sm:w-72 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 cursor-pointer"
            >
              {(status?.semester_periods || (period ? [period] : [])).map(p => (
                <option key={p} value={p}>{monthLabel(p)}</option>
              ))}
            </select>
            {reportType === 'CUMULATIVE' && (
              <p className="text-[11px] text-slate-500 mt-1.5">
                Cumulative figures cover every class conducted so far this semester.
              </p>
            )}
          </div>

          {/* Step 3: audience */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">3. Who receives it</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AUDIENCES.map(a => {
                const Icon = a.icon;
                const on = audience === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setAudience(a.id)}
                    className={`text-left px-3.5 py-2.5 rounded-2xl border transition cursor-pointer flex items-start gap-2.5 ${
                      on ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${on ? 'text-amber-700' : 'text-slate-400'}`} />
                    <span className="min-w-0">
                      <span className={`block text-xs font-black ${on ? 'text-amber-900' : 'text-slate-700'}`}>{a.label}</span>
                      <span className={`block text-[11px] leading-snug ${on ? 'text-amber-800' : 'text-slate-500'}`}>{a.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 4: recipients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">4. Confirm recipients</p>
              <button
                onClick={fetchPreview}
                disabled={loading}
                title="Refresh"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 border border-slate-200 rounded-2xl">
                <Loader2 className="w-6 h-6 text-slate-400 animate-spin mb-2" />
                <p className="text-xs font-medium text-slate-500">Computing attendance for the class…</p>
              </div>
            ) : preview && preview.students.length === 0 ? (
              <div className="py-12 text-center border border-slate-200 rounded-2xl space-y-1.5">
                <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto" />
                <p className="text-sm font-bold text-slate-600">No students match this selection.</p>
                <p className="text-xs text-slate-400">Nothing to send for {monthLabel(period)}.</p>
              </div>
            ) : preview && (
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200 gap-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer min-w-0">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    <span className="truncate">Select all ({sendableStudents.length})</span>
                  </label>
                  <span className="text-[11px] text-slate-400 font-bold shrink-0">{selected.size} selected</span>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                  {preview.students.map(s => (
                    <label
                      key={s.student_id}
                      className={`flex items-center gap-3 px-4 py-2.5 ${s.email ? 'hover:bg-slate-50 cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!s.email}
                        checked={selected.has(s.student_id)}
                        onChange={() => s.email && toggle(s.student_id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {s.name} <span className="text-slate-400 font-mono font-normal">{s.reg_no}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5">
                          {s.email || 'No email address on file'}
                          {s.already_sent && (
                            <span className="inline-flex items-center gap-0.5 text-slate-500 font-bold">
                              <Clock className="w-2.5 h-2.5" /> already sent
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-black font-mono border shrink-0 ${
                        s.below_threshold
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {formatAttendancePercentage(s.percentage)}%
                      </span>
                    </label>
                  ))}
                </div>
                {preview.no_email_count > 0 && (
                  <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-[11px] font-bold text-amber-800">
                    {preview.no_email_count} student(s) have no email address on file and cannot be mailed.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 font-bold text-sm hover:bg-slate-100 rounded-xl cursor-pointer">
            Close
          </button>

          {!confirmStep ? (
            <button
              onClick={() => setConfirmStep(true)}
              disabled={!smtpReady || loading || sending || selected.size === 0}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl shadow-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              Send to {selected.size}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600 hidden sm:inline">
                Send {selected.size} {activeReport?.label.toLowerCase()} email(s)?
              </span>
              <button onClick={() => setConfirmStep(false)} disabled={sending} className="px-3 py-2 text-slate-500 font-bold text-xs hover:bg-slate-100 rounded-xl cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-xs disabled:opacity-60 flex items-center gap-2 cursor-pointer"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                {sending ? 'Sending…' : 'Yes, send now'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
