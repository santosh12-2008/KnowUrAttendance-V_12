// Attendance display formatting only.
// Calculations and threshold comparisons always use the raw numeric percentage.
//
// This MUST behave identically to backend/app/formatting.py so that an email and
// the portal never show different numbers for the same student.
//
// Rules:
//  * Exactly 2 digits after the point:        74.94117647... -> "74.94"
//  * Exactly 0 and exactly 100 use ONE digit: 0 -> "0.0",  100 -> "100.0"
//  * Ties round half-up (Number.prototype.toFixed does this).
//  * Rounding never pushes a student across a threshold: 74.996 is below 75 and
//    must not display as "75.00" (likewise 89.996 -> "89.99", 99.996 -> "99.99").

// [threshold, the largest 2-decimal value that is still strictly below it]
const THRESHOLD_CAPS = [
  [75, '74.99'],
  [90, '89.99'],
  [100, '99.99'],
];

export function formatAttendancePercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0.0';
  if (n >= 100) return '100.0';

  let out = n.toFixed(2);
  const rounded = Number(out);

  for (const [threshold, cap] of THRESHOLD_CAPS) {
    if (n < threshold && rounded >= threshold) {
      out = cap;
      break;
    }
  }

  // A tiny non-zero value must not masquerade as 0.
  if (Number(out) <= 0) out = '0.01';

  return out;
}


export function getLocalDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Single source of truth for "which months should the month-picker show".
// This MUST be driven by the active semester's real start_month/end_month
// (never hardcoded), or the CR and Student portals silently drift apart:
// a CR who extends/shrinks the semester span in the CR portal would not see
// the change reflected for students, who would be stuck seeing a fixed,
// stale list of months (and could never view attendance for a month outside it).
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(value) {
  const [y, m] = String(value || '').split('-');
  const idx = parseInt(m, 10) - 1;
  return (idx >= 0 && idx < 12 && y) ? `${MONTH_NAMES[idx]} ${y}` : value;
}

/**
 * Builds the list of selectable months for the "Month" dropdown, spanning
 * activeSemester.start_month..end_month inclusive, plus an "all" option and
 * a safety net so a currently-selected/persisted month is never removed from
 * the list even if it falls slightly outside the configured span.
 */
export function getAcademicMonthOptions(activeSemester, currentValue) {
  const list = [{ value: 'all', label: 'All Months (Cumulative)' }];
  const start = activeSemester?.start_month;
  const end = activeSemester?.end_month;

  if (!start || !end) {
    const fallback = currentValue && currentValue !== 'all' ? currentValue : getLocalDateISO().slice(0, 7);
    list.push({ value: fallback, label: monthLabel(fallback) });
    return list;
  }

  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 36) {
    const value = `${y}-${String(m).padStart(2, '0')}`;
    list.push({ value, label: monthLabel(value) });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    guard += 1;
  }

  // Never let a persisted/selected month vanish from the dropdown, even if it
  // is outside the configured span (e.g. semester dates were tightened after
  // the fact but old records still reference an earlier month).
  if (currentValue && currentValue !== 'all' && !list.some(o => o.value === currentValue)) {
    list.push({ value: currentValue, label: monthLabel(currentValue) });
  }

  return list;
}
