import React, { useState } from 'react';
import { Shield, User, Lock, ArrowRight, AlertCircle, Sparkles } from 'lucide-react';

export default function LoginView({ onLoginSuccess }) {
  const [role, setRole] = useState('student'); // 'student' or 'cr'
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password modal state
  const [forgotModal, setForgotModal] = useState(false);
  const [forgotReg, setForgotReg] = useState('');
  const [forgotNewPwd, setForgotNewPwd] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotErr, setForgotErr] = useState('');
  const [submittingForgot, setSubmittingForgot] = useState(false);

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    setError('');
    setIdentifier('');
    setPassword('');
  };

  const handleForgotPasswordSubmit = async (e) => {
    e.preventDefault();
    setForgotErr('');
    setForgotMsg('');
    setSubmittingForgot(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reg_no: forgotReg.trim(),
          new_password: forgotNewPwd.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to submit reset request');
      }
      setForgotMsg(data.message || 'Reset request submitted successfully! Your CR will approve it shortly.');
      setForgotNewPwd('');
    } catch (err) {
      setForgotErr(err.message);
    } finally {
      setSubmittingForgot(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reg_no: identifier.trim(),
          password: password.trim(),
          role: role
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Authentication failed. Please check your credentials.');
      }

      onLoginSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-8">
      
      {/* AUCE(A) & CSE Branding Banner */}
      <div className="text-center mb-8 max-w-xl">
        <div className="inline-flex items-center space-x-2 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold px-3 py-1 rounded-full mb-3 shadow-2xs">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>Andhra University College of Engineering (Autonomous)</span>
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight sm:text-4xl">
          KnowUrAttendance
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Department of Computer Science & Systems Engineering
        </p>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        
        {/* Role Switcher Tabs */}
        <div className="grid grid-cols-2 p-1.5 bg-slate-100 border-b border-slate-200 text-xs font-semibold">
          <button
            type="button"
            onClick={() => handleRoleChange('student')}
            className={`flex items-center justify-center space-x-2 py-2.5 rounded-xl transition ${
              role === 'student'
                ? 'bg-white text-emerald-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Student Portal</span>
          </button>

          <button
            type="button"
            onClick={() => handleRoleChange('cr')}
            className={`flex items-center justify-center space-x-2 py-2.5 rounded-xl transition ${
              role === 'cr'
                ? 'bg-white text-amber-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>CR / LR Admin</span>
          </button>
        </div>

        <div className="p-6 sm:p-8">
          {error && (
            <div className="mb-4 flex items-start space-x-2.5 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Identifier Field */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                {role === 'cr' ? 'Admin Name / Username' : 'Registration Number (12 Digits)'}
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  autoComplete={role === 'cr' ? 'off' : 'username'}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={role === 'cr' ? 'Enter authorized admin name' : 'Enter 12-digit registration number'}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Password
                </label>
                {role === 'student' && (
                  <button
                    type="button"
                    onClick={() => {
                      setForgotModal(true);
                      setForgotReg(identifier);
                      setForgotMsg('');
                      setForgotErr('');
                    }}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700 transition cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                />
              </div>
              {role === 'cr' && (
                <p className="mt-1 text-[11px] text-slate-400">
                  CR and LR passwords are managed securely inside the portal.
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-sm font-bold text-white transition shadow-md ${
                role === 'cr' 
                  ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500' 
                  : 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500'
              } disabled:opacity-50 cursor-pointer`}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In as {role === 'cr' ? 'Admin (CR / LR)' : 'Student'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

        </div>

      </div>

      {/* Student Forgot Password Modal */}
      {forgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h4 className="text-lg font-black text-slate-900 mb-1">Student Password Reset Request</h4>
            <p className="text-xs text-slate-500 mb-4">
              Enter your 12-digit roll number and desired new password. Your Class Representative (CR) will review and approve it.
            </p>

            {forgotMsg && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl font-medium">
                {forgotMsg}
              </div>
            )}
            {forgotErr && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
                {forgotErr}
              </div>
            )}

            {!forgotMsg ? (
              <form onSubmit={handleForgotPasswordSubmit} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Registration Number (12 Digits) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={12}
                    value={forgotReg}
                    onChange={(e) => setForgotReg(e.target.value.trim())}
                    placeholder="e.g. 999999000001"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Desired New Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={forgotNewPwd}
                    onChange={(e) => setForgotNewPwd(e.target.value)}
                    placeholder="Enter new password (min 4 characters)"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setForgotModal(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingForgot}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {submittingForgot ? 'Submitting...' : 'Submit Request to CR'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setForgotModal(false)}
                  className="px-5 py-2 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 text-center text-xs text-slate-400">
        © AUCE(A) Department of Computer Science & Systems Engineering
      </div>
    </div>
  );
}
