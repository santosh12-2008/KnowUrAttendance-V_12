"""
Attendance report dispatch engine.

Sending is manual only - a CR/LR reviews the recipient list in the Email Centre and
presses Send. There is no scheduler and nothing fires automatically on login.

Duplicate protection is still in the database, not the UI: `email_dispatch_log` has
UNIQUE(student_id, period, report_type), so if the same statement is sent for the same
student and period twice, the second insert is treated as a resend rather than silently
stacking - `already_sent_ids()` lets the CR see who was already mailed before confirming.
"""

import time
from datetime import date, datetime
from calendar import monthrange
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from app import email_service
from app.calculations import calculate_student_attendance

REPORT_MONTHLY = "MONTHLY"
REPORT_CUMULATIVE = "CUMULATIVE"
REPORT_TYPES = (REPORT_MONTHLY, REPORT_CUMULATIVE)

AUDIENCE_ALL = "ALL"
AUDIENCE_BELOW_MONTHLY = "BELOW_MONTHLY"
AUDIENCE_BELOW_CUMULATIVE = "BELOW_CUMULATIVE"
AUDIENCE_SELECTED = "SELECTED"

INTER_MESSAGE_DELAY = 0.12  # gentle pacing so a 70-student batch doesn't trip rate limits


# --------------------------------------------------------------------------- #
# Period helpers
# --------------------------------------------------------------------------- #

def parse_period(period: str) -> Optional[Tuple[int, int]]:
    try:
        y, m = str(period).split("-")
        y, m = int(y), int(m)
        if 1 <= m <= 12:
            return y, m
    except Exception:
        pass
    return None


def period_end_date(period: str) -> Optional[date]:
    parsed = parse_period(period)
    if not parsed:
        return None
    y, m = parsed
    return date(y, m, monthrange(y, m)[1])


def is_period_closed(period: str, today: Optional[date] = None) -> bool:
    """True once the last calendar day of `period` has passed."""
    end = period_end_date(period)
    if not end:
        return False
    return (today or datetime.now(ZoneInfo("Asia/Kolkata")).date()) > end


def months_between(start: str, end: str) -> List[str]:
    """Inclusive list of 'YYYY-MM' from start to end."""
    a, b = parse_period(start), parse_period(end)
    if not a or not b:
        return []
    out = []
    y, m = a
    ey, em = b
    guard = 0
    while (y, m) <= (ey, em) and guard < 120:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
        guard += 1
    return out


def semester_periods(sem) -> List[str]:
    if not sem:
        return []
    return months_between(sem["start_month"], sem["end_month"])


# --------------------------------------------------------------------------- #
# Reminders (read-only - no sending happens here)
#
# This is deliberately NOT a scheduler. It never sends anything and never runs on a
# timer or on login. It only answers a question the Email Centre asks when the CR/LR
# opens it: "has a statement already gone out for each closed month?" so a month that
# quietly slipped through is visible instead of silently forgotten. The CR still has to
# open the Email Centre and press Send - this just tells them if they should.
# --------------------------------------------------------------------------- #

def unsent_closed_periods(conn, sem, today: Optional[date] = None) -> List[Dict[str, str]]:
    """
    Closed months in the semester for which NO statement (of a given type) has ever been
    sent to anyone. Cumulative is only meaningful for the most recently closed month, for
    the same reason a cumulative statement is only ever sent for that month: it is a
    snapshot of "everything so far", so an older month's cumulative figure is stale.
    """
    if not sem:
        return []
    closed = [p for p in semester_periods(sem) if is_period_closed(p, today)]
    if not closed:
        return []

    cursor = conn.cursor()
    cursor.execute(
        "SELECT DISTINCT period, report_type FROM email_dispatch_log WHERE semester_id = ? AND status = 'SENT'",
        (sem["id"],),
    )
    already = {(r["period"], r["report_type"]) for r in cursor.fetchall()}

    out = []
    for period in closed:
        if (period, REPORT_MONTHLY) not in already:
            out.append({"period": period, "report_type": REPORT_MONTHLY})
    latest_closed = closed[-1]
    if (latest_closed, REPORT_CUMULATIVE) not in already:
        out.append({"period": latest_closed, "report_type": REPORT_CUMULATIVE})
    return out


def _active_students(conn, semester_id: int, student_ids: Optional[List[int]] = None):
    cursor = conn.cursor()
    if student_ids:
        placeholders = ",".join("?" * len(student_ids))
        cursor.execute(
            f"""SELECT id FROM students
                WHERE semester_id = ? AND id IN ({placeholders})
                  AND (is_dropped IS NULL OR is_dropped = 0)""",
            (semester_id, *student_ids),
        )
    else:
        cursor.execute(
            """SELECT id FROM students
               WHERE semester_id = ? AND (is_dropped IS NULL OR is_dropped = 0)
               ORDER BY reg_no""",
            (semester_id,),
        )
    return [r["id"] for r in cursor.fetchall()]


def build_recipients(
    conn,
    sem,
    *,
    report_type: str = REPORT_MONTHLY,
    period: Optional[str] = None,
    audience: str = AUDIENCE_ALL,
    threshold: float = 75.0,
    student_ids: Optional[List[int]] = None,
) -> List[Dict[str, Any]]:
    """
    One function resolves every audience, so "all students", "monthly shortfall" and
    "cumulative shortfall" are filters over the same computation rather than three
    separate code paths that can drift apart.

    The attendance figures attached to each recipient are ALWAYS those of `report_type`
    (that is what the email will state). The audience filters may additionally consult
    the other view - e.g. audience=BELOW_CUMULATIVE while sending the monthly report.
    """
    if not sem:
        return []

    report_type = (report_type or REPORT_MONTHLY).upper()
    audience = (audience or AUDIENCE_ALL).upper()

    ids = _active_students(conn, sem["id"], student_ids if audience == AUDIENCE_SELECTED else None)

    # The month the report covers. Cumulative reports are computed over every month.
    report_month_filter = period if report_type == REPORT_MONTHLY else None

    # Whether we additionally need the *other* view to apply the filter.
    needs_monthly_view = audience == AUDIENCE_BELOW_MONTHLY
    needs_cumulative_view = audience == AUDIENCE_BELOW_CUMULATIVE

    recipients = []
    for sid in ids:
        data = calculate_student_attendance(conn, sid, report_month_filter)
        if not data:
            continue
        overall = data["overall"]

        monthly_pct = None
        cumulative_pct = None
        if report_type == REPORT_MONTHLY:
            monthly_pct = overall["percentage"] if overall["conducted"] > 0 else None
        else:
            cumulative_pct = overall["percentage"] if overall["conducted"] > 0 else None

        if needs_monthly_view and monthly_pct is None:
            m = calculate_student_attendance(conn, sid, period)
            monthly_pct = m["overall"]["percentage"] if m and m["overall"]["conducted"] > 0 else None
        if needs_cumulative_view and cumulative_pct is None:
            c = calculate_student_attendance(conn, sid, None)
            cumulative_pct = c["overall"]["percentage"] if c and c["overall"]["conducted"] > 0 else None

        # Filter
        if audience == AUDIENCE_BELOW_MONTHLY:
            if monthly_pct is None or monthly_pct >= threshold:
                continue
        elif audience == AUDIENCE_BELOW_CUMULATIVE:
            if cumulative_pct is None or cumulative_pct >= threshold:
                continue
        recipients.append({
            "student_id": data["student"]["id"],
            "reg_no": data["student"]["reg_no"],
            "name": data["student"]["name"],
            "email": (data["student"].get("email") or "").strip(),
            "batch": data["student"]["batch"],
            "percentage": overall["percentage"],
            "conducted": overall["conducted"],
            "attended": overall["attended"],
            "missed": overall["missed"],
            "classes_for_75": overall.get("classes_for_75", 0),
            "monthly_percentage": monthly_pct,
            "cumulative_percentage": cumulative_pct,
            "subjects": data["subjects"],
            "below_threshold": overall["percentage"] < threshold if overall["conducted"] > 0 else False,
        })

    recipients.sort(key=lambda r: str(r["reg_no"]))
    return recipients


def already_sent_ids(conn, period: str, report_type: str) -> set:
    cursor = conn.cursor()
    cursor.execute(
        "SELECT student_id FROM email_dispatch_log WHERE period = ? AND report_type = ? AND status = 'SENT'",
        (period, report_type),
    )
    return {r["student_id"] for r in cursor.fetchall()}


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #

def dispatch(
    conn,
    sem,
    *,
    report_type: str,
    period: str,
    recipients: List[Dict[str, Any]],
    threshold: float = 75.0,
    trigger: str = "AUTO",
    triggered_by: str = "",
    force_resend: bool = False,
) -> Dict[str, Any]:
    """
    Send one batch over a single pooled SMTP connection and write the ledger.
    Never raises - every outcome is recorded per student and returned.
    """
    cursor = conn.cursor()
    academic_year = (sem["academic_year"] if sem else None) or "2026-2027"
    semester_name = (sem["name"] if sem else None) or "Current Semester"

    sent, failed, skipped = [], [], []
    seen = set() if force_resend else already_sent_ids(conn, period, report_type)

    pending = [r for r in recipients if r["student_id"] not in seen]
    for r in recipients:
        if r["student_id"] in seen:
            skipped.append({"reg_no": r["reg_no"], "name": r["name"],
                            "reason": "Already sent for this period"})

    if not pending:
        return {"sent": sent, "failed": failed, "skipped": skipped,
                "smtp_error": "", "total_considered": len(recipients)}

    with email_service.SmtpSession() as session:
        if not session.ready:
            return {"sent": [], "failed": [], "skipped": skipped,
                    "smtp_error": session.error, "total_considered": len(recipients)}

        for idx, r in enumerate(pending):
            addr = (r.get("email") or "").strip()
            if not addr or "@" not in addr:
                skipped.append({"reg_no": r["reg_no"], "name": r["name"],
                                "reason": "No valid email address on file"})
                _log(cursor, sem, r, period, report_type, trigger, "SKIPPED",
                     "No valid email address on file", triggered_by)
                continue

            subject, html, plain = email_service.build_attendance_report_email(
                report_type=report_type,
                student_name=r["name"],
                reg_no=r["reg_no"],
                percentage=r["percentage"],
                conducted=r["conducted"],
                attended=r["attended"],
                missed=r["missed"],
                classes_for_target=r.get("classes_for_75", 0),
                subjects=r.get("subjects", []),
                academic_year=academic_year,
                semester_name=semester_name,
                period=period,
                threshold=threshold,
                issued_by=triggered_by,
            )

            ok, err = session.send(addr, subject, html, plain, sender_name=triggered_by)
            if ok:
                sent.append({"reg_no": r["reg_no"], "name": r["name"],
                             "email": addr, "percentage": r["percentage"]})
                _log(cursor, sem, r, period, report_type, trigger, "SENT", "", triggered_by)
            else:
                failed.append({"reg_no": r["reg_no"], "name": r["name"],
                               "email": addr, "error": err})
                _log(cursor, sem, r, period, report_type, trigger, "FAILED", err, triggered_by)
                if not session.ready:
                    # Connection died - record the rest as failed rather than spinning.
                    for rest in pending[idx + 1:]:
                        failed.append({"reg_no": rest["reg_no"], "name": rest["name"],
                                       "email": rest.get("email", ""),
                                       "error": "Mail session dropped before this message"})
                    break

            if INTER_MESSAGE_DELAY:
                time.sleep(INTER_MESSAGE_DELAY)

    return {"sent": sent, "failed": failed, "skipped": skipped,
            "smtp_error": "", "total_considered": len(recipients)}


def _log(cursor, sem, r, period, report_type, trigger, status, detail, triggered_by):
    """
    Write the ledger row. A failed/skipped row must not block a later retry, so only
    SENT rows occupy the UNIQUE slot permanently - non-SENT rows are replaced on retry.
    """
    try:
        cursor.execute(
            """INSERT INTO email_dispatch_log
               (semester_id, student_id, reg_no, student_name, email, period, report_type,
                trigger, status, detail, percentage, triggered_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(student_id, period, report_type) DO UPDATE SET
                   status = excluded.status,
                   detail = excluded.detail,
                   percentage = excluded.percentage,
                   trigger = excluded.trigger,
                   triggered_by = excluded.triggered_by,
                   created_at = CURRENT_TIMESTAMP
               WHERE email_dispatch_log.status != 'SENT'""",
            (sem["id"] if sem else None, r["student_id"], r["reg_no"], r["name"],
             r.get("email", ""), period, report_type, trigger, status, detail,
             r.get("percentage"), triggered_by),
        )
    except Exception:
        pass
