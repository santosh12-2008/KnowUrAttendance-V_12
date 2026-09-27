import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import LoginView from './components/LoginView';
import StudentDashboard from './components/StudentDashboard';
import CrDashboard from './components/CrDashboard';

export default function App() {
  const [user, setUser] = useState(() => {
    // For CR/LR: session must be in sessionStorage so re-opening the browser requires password (Item 14)
    // For students: localStorage can be kept for convenience
    const sessionUser = sessionStorage.getItem('knowurattendance_user');
    if (sessionUser) {
      try { return JSON.parse(sessionUser); } catch (e) {}
    }
    const localUser = localStorage.getItem('knowurattendance_user');
    if (localUser) {
      try {
        const parsed = JSON.parse(localUser);
        if (parsed.role === 'cr' || parsed.role === 'lr' || parsed.role === 'admin') {
          localStorage.removeItem('knowurattendance_user');
          return null;
        }
        return parsed;
      } catch (e) {}
    }
    return null;
  });

  const [activeSemester, setActiveSemester] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    return localStorage.getItem('knowurattendance_month') || '2026-09';
  });

  const fetchActiveSemester = async () => {
    try {
      const res = await fetch('/api/semesters/active');
      if (res.ok) {
        const data = await res.json();
        setActiveSemester(data);
        if (data.active_month) {
          setCurrentMonth(data.active_month);
          localStorage.setItem('knowurattendance_month', data.active_month);
        }
      }
    } catch (err) {
      console.error('Error loading active semester:', err);
    }
  };

  useEffect(() => {
    fetchActiveSemester();
    const refresh = () => fetchActiveSemester();
    const onSemesterChanged = () => fetchActiveSemester();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('semester-changed', onSemesterChanged);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('semester-changed', onSemesterChanged);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Authentication is deliberately handled in one place. Access tokens are short-lived,
  // but the refresh token lets the portal renew them automatically. A 401 therefore does
  // not randomly break a dashboard, attendance marker, backup download, or semester switch.
  // Only a genuinely expired refresh session sends the user back to login.
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let refreshPromise = null;

    const readStoredUser = () => {
      try {
        const raw = sessionStorage.getItem('knowurattendance_user') || localStorage.getItem('knowurattendance_user');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    };

    const saveStoredUser = (nextUser) => {
      if (!nextUser) return;
      const admin = ['cr', 'lr', 'admin'].includes(nextUser.role);
      const serialized = JSON.stringify(nextUser);
      if (admin) {
        sessionStorage.setItem('knowurattendance_user', serialized);
        localStorage.removeItem('knowurattendance_user');
      } else {
        localStorage.setItem('knowurattendance_user', serialized);
        sessionStorage.removeItem('knowurattendance_user');
      }
      localStorage.setItem('attendance_token', nextUser.token || '');
    };

    const renewAccessToken = async () => {
      if (refreshPromise) return refreshPromise;
      const stored = readStoredUser();
      const refreshToken = stored?.refresh_token;
      const legacyAccessToken = stored?.token;
      if (!refreshToken && !legacyAccessToken) return null;

      refreshPromise = (async () => {
        try {
          const res = await originalFetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : { access_token: legacyAccessToken })
          });
          if (!res.ok) return null;
          const data = await res.json();
          if (!data?.token) return null;
          const nextUser = { ...stored, token: data.token, refresh_token: data.refresh_token || stored.refresh_token };
          saveStoredUser(nextUser);
          setUser(nextUser);
          return data.token;
        } catch {
          return null;
        } finally {
          refreshPromise = null;
        }
      })();
      return refreshPromise;
    };

    window.fetch = async (...args) => {
      let requestArgs = args;
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input?.url || '');
        const isOwnApi = url.startsWith('/api/');
        const isPublicAuth = url.includes('/api/auth/login') || url.includes('/api/auth/refresh') || url.includes('/api/auth/forgot-password');
        if (isOwnApi && !isPublicAuth) {
          const stored = readStoredUser();
          if (stored?.token) {
            const init = args[1] ? { ...args[1] } : {};
            const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
            if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${stored.token}`);
            init.headers = headers;
            requestArgs = [input, init];
          }
        }
      } catch {}
      const response = await originalFetch(...requestArgs);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input?.url || '');
        const isOwnApi = url.startsWith('/api/');
        const isAuthRoute = url.includes('/api/auth/login') || url.includes('/api/auth/refresh');

        if (isOwnApi && !isAuthRoute && response.status === 401) {
          const stored = readStoredUser();
          if (stored?.refresh_token || stored?.token) {
            const freshToken = await renewAccessToken();
            if (freshToken) {
              let init = args[1] ? { ...args[1] } : {};
              const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
              headers.set('Authorization', `Bearer ${freshToken}`);
              init.headers = headers;
              return originalFetch(input, init);
            }
          }
          // The refresh session itself is genuinely dead. Clear the stale session so the
          // UI never remains in a half-working state.
          sessionStorage.removeItem('knowurattendance_user');
          localStorage.removeItem('knowurattendance_user');
          localStorage.removeItem('attendance_token');
          setUser(null);
        }
      } catch {
        // Authentication recovery must never break the original network response.
      }
      return response;
    };

    return () => { window.fetch = originalFetch; };
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    if (userData.role === 'cr' || userData.role === 'lr' || userData.role === 'admin') {
      sessionStorage.setItem('knowurattendance_user', JSON.stringify(userData));
      localStorage.removeItem('knowurattendance_user');
      localStorage.setItem('attendance_token', userData.token || '');
    } else {
      localStorage.setItem('knowurattendance_user', JSON.stringify(userData));
      sessionStorage.removeItem('knowurattendance_user');
      localStorage.setItem('attendance_token', userData.token || '');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('knowurattendance_user');
    sessionStorage.removeItem('knowurattendance_user');
    localStorage.removeItem('attendance_token');
  };

  const handleMonthChange = async (newMonth) => {
    setCurrentMonth(newMonth);
    localStorage.setItem('knowurattendance_month', newMonth);
    // If CR/LR, persist the month in backend so it remains same until CR changes it
    if (user && (user.role === 'cr' || user.role === 'lr') && newMonth !== 'all') {
      try {
        await fetch('/api/semesters/active-month', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active_month: newMonth })
        });
      } catch (err) {
        console.error('Failed to persist active month:', err);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased">
      {/* Small fixed buffer so nothing ever renders flush against the very top pixel of the
          page - keeps controls clickable even if a browser/OS toolbar nudges into that space. */}
      <div className="h-2 w-full shrink-0 bg-slate-50" aria-hidden="true" />
      {/* AUCE(A) Header */}
      <Header
        user={user}
        onLogout={handleLogout}
        activeSemester={activeSemester}
        currentMonth={currentMonth}
        onMonthChange={handleMonthChange}
        onSemesterUpdated={fetchActiveSemester}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {!user ? (
          <LoginView onLoginSuccess={handleLoginSuccess} />
        ) : (user.role === 'cr' || user.role === 'lr') ? (
          <CrDashboard 
            user={user} 
            token={user.token} 
            currentMonth={currentMonth}
            activeSemester={activeSemester}
          />
        ) : (
          <StudentDashboard 
            user={user} 
            token={user.token} 
            currentMonth={currentMonth} 
            activeSemester={activeSemester}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 space-y-1">
          <p className="font-bold text-slate-700">
            KnowUrAttendance Portal • Computer Science & Systems Engineering
          </p>
          <p className="text-slate-400 text-[11px]">
            Andhra University College of Engineering (Autonomous), Visakhapatnam, Andhra Pradesh
          </p>
        </div>
      </footer>
    </div>
  );
}
