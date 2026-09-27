"""
Email service for KnowUrAttendance.

This is a CR/LR-run class tool, not a department system - the mail it sends is a class
update from your Class/Ladies Representative, never an official circular from the CSE
Department or the college. Nothing here should be worded or branded to suggest otherwise;
see the disclaimer built into the footer of build_attendance_report_email() below.

All credentials come from environment variables. Nothing is hardcoded.

Required:
    SMTP_EMAIL          - address the mail is sent FROM
    SMTP_APP_PASSWORD   - Gmail App Password (16 chars, not the account password)

Optional:
    SMTP_HOST           - default smtp.gmail.com
    SMTP_PORT           - default 587 (STARTTLS)
    SMTP_SENDER_NAME    - fallback "From" display name, used only when no CR/LR name is
                          available for a send. In normal use the display name is the
                          name of whichever CR/LR actually pressed Send (see `issued_by`
                          / `sender_name` below), so the mail visibly comes from a person,
                          not an office. Default "Class Representative".
    SMTP_REPLY_TO       - reply-to address, defaults to SMTP_EMAIL
    BRANCH_SHORT        - short branch label shown in the mail, default "CSE"
    COLLEGE_SHORT       - short college label shown in the mail, default "AUCE(A)"
    ATTENDANCE_THRESHOLD- minimum % required, default 75

Design note
-----------
Two report types share one renderer but produce genuinely different messages:

  MONTHLY     - the figure for one calendar month. Framed as routine.
  CUMULATIVE  - the semester-to-date aggregate. This is the figure that governs
                examination eligibility, so it carries that language explicitly.

The layout is a modern, scannable card: one big percentage, a colour-coded verdict pill,
a pinned tip on raising/holding the percentage, and a compact subject-wise table. It is
deliberately NOT styled like an official letterhead (no reference numbers, no crest, no
formal address block) and the footer says outright that it isn't one - see CHANGES.md.
"""

import math
import os
import re
import smtplib
import ssl
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape
from email.utils import formataddr, formatdate, make_msgid
from typing import Dict, Any, List, Tuple, Optional

from dotenv import load_dotenv
from pathlib import Path

from app.formatting import format_attendance_percentage  # single shared display formatter

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
# Always load the backend/.env by absolute path. `override=True` prevents a stale
# Windows environment variable from silently replacing yesterday's .env values.
load_dotenv(ENV_FILE, override=True)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_EMAIL = ""
SMTP_APP_PASSWORD = ""
SMTP_SENDER_NAME = "Class Representative"
SMTP_REPLY_TO = ""

def reload_smtp_config() -> None:
    """Reload SMTP settings from the project's backend/.env at request time."""
    global SMTP_HOST, SMTP_PORT, SMTP_EMAIL, SMTP_APP_PASSWORD, SMTP_SENDER_NAME, SMTP_REPLY_TO
    load_dotenv(ENV_FILE, override=True)
    SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com"
    try:
        SMTP_PORT = int(os.environ.get("SMTP_PORT", "587").strip() or "587")
    except ValueError:
        SMTP_PORT = 587
    SMTP_EMAIL = os.environ.get("SMTP_EMAIL", "").strip().strip('\"\'')
    # Gmail app passwords are often copied with spaces. Remove whitespace, but never
    # remove other characters because they are part of the credential.
    SMTP_APP_PASSWORD = re.sub(r"\s+", "", os.environ.get("SMTP_APP_PASSWORD", "").strip().strip('\"\''))
    SMTP_SENDER_NAME = os.environ.get("SMTP_SENDER_NAME", "Class Representative").strip()
    SMTP_REPLY_TO = os.environ.get("SMTP_REPLY_TO", "").strip() or SMTP_EMAIL

reload_smtp_config()
SMTP_SENDER_NAME = os.environ.get("SMTP_SENDER_NAME", "Class Representative").strip()
SMTP_REPLY_TO = os.environ.get("SMTP_REPLY_TO", "").strip() or SMTP_EMAIL

# Short, informal identity used in the mail itself - deliberately NOT the full official
# "Department of Computer Science & Engineering" / college address block. Override either
# if your class calls itself something else.
BRANCH_SHORT = os.environ.get("BRANCH_SHORT", "CSE").strip()
COLLEGE_SHORT = os.environ.get("COLLEGE_SHORT", "AUCE(A)").strip()

# Fixed wording for the student-facing email. Keep the email independent of the portal
# branding and of the individual CR/LR who clicked Send.
EMAIL_TITLE = "CSE - 2/4 Attendance"
EMAIL_SENDER_LABEL = "CSE 2/4 CR"

ATTENDANCE_THRESHOLD = float(os.environ.get("ATTENDANCE_THRESHOLD", "75"))

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]

REPORT_MONTHLY = "MONTHLY"
REPORT_CUMULATIVE = "CUMULATIVE"




def is_configured() -> bool:
    """True only when both SMTP credentials are present in backend/.env."""
    reload_smtp_config()
    return bool(SMTP_EMAIL and SMTP_APP_PASSWORD)


def smtp_sender_address() -> str:
    return SMTP_EMAIL


def month_label(period: str) -> str:
    """'2026-09' -> 'September 2026'. Falls back to the raw value."""
    try:
        y, m = period.split("-")
        return f"{MONTH_NAMES[int(m) - 1]} {y}"
    except Exception:
        return period or ""


def _sem_code(semester_name: str) -> str:
    """
    Pulls a short code like '2-1' or '2/4' out of a semester title such as
    'B.Tech CSE - 2nd Year 1st Sem (2-1)' - i.e. whatever the CR/LR typed in parentheses
    on the "Update Academic Period" screen. Falls back to the full title when there's no
    bracketed code, so the mail always shows *something* sensible without needing a
    second, separate field anywhere.
    """
    if not semester_name:
        return ""
    match = re.search(r"\(([^)]+)\)\s*$", semester_name.strip())
    return match.group(1) if match else semester_name.strip()


# --------------------------------------------------------------------------- #
# HTML fragments
# --------------------------------------------------------------------------- #

_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"


def _subject_rows_html(subjects: List[Dict[str, Any]], threshold: float) -> str:
    rows = []
    for s in subjects or []:
        if s.get("conducted", 0) <= 0:
            continue
        pct = s.get("percentage", 0.0)
        shortfall = pct < threshold
        pct_color = "#dc2626" if shortfall else "#15803d"
        code = escape(str(s.get("code", "")))
        name = escape(str(s.get("name", "")))
        attended = int(s.get("attended", 0))
        conducted = int(s.get("conducted", 0))
        pct_text = format_attendance_percentage(pct)
        rows.append(f"""
        <tr>
          <td class="subject-cell email-row" style="padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#111827;word-break:break-word;">
            <strong class="email-text" style="color:#111827;">{code}</strong>
            <span class="email-subtle" style="color:#475569;"> · {name}</span>
          </td>
          <td class="subject-cell email-row email-subtle" style="padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;text-align:center;white-space:nowrap;">{attended}/{conducted}</td>
          <td class="subject-cell email-row" style="padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-weight:800;color:{pct_color};white-space:nowrap;">{pct_text}%</td>
        </tr>""")
    if not rows:
        return ('<tr><td colspan="3" style="padding:16px;text-align:center;color:#64748b;'
                'font-size:12.5px;">No classes recorded for this period.</td></tr>')
    return "".join(rows)


def _copy_for(report_type: str, month_text: str, semester_name: str) -> Dict[str, str]:
    """The wording that actually differs between the two reports - kept short and direct."""
    if report_type == REPORT_MONTHLY:
        return {
            "eyebrow": "Monthly Update",
            "heading": f"Your attendance for {month_text}",
            "scope_note": "This covers one month only — your semester total may differ.",
            "ok_note": "You're meeting the requirement this month. Keep it up.",
            "short_note": (
                "This is below the required percentage. It won't affect your semester "
                "eligibility on its own, but staying short will pull your overall average down."
            ),
        }
    return {
        "eyebrow": "Cumulative · Semester to date",
        "heading": "Your attendance so far this semester",
        "scope_note": f"Computed across every class held in {semester_name} to date.",
        "ok_note": "You're meeting the minimum required for exam eligibility.",
        "short_note": (
            "This is below the minimum required for exam eligibility. A shortfall at the "
            "end of the semester can mean detention or a condonation request — please act now."
        ),
    }


def build_attendance_report_email(
    *,
    report_type: str,
    student_name: str,
    reg_no: str,
    percentage: float,
    conducted: int,
    attended: int,
    missed: int,
    classes_for_target: int,
    subjects: List[Dict[str, Any]],
    academic_year: str,
    semester_name: str,
    period: str,
    threshold: float = ATTENDANCE_THRESHOLD,
    issued_by: str = "",
) -> Tuple[str, str, str]:
    """Build a responsive attendance email and its plain-text fallback."""
    report_type = (report_type or REPORT_MONTHLY).upper()
    month_text = month_label(period)
    sem_code = _sem_code(semester_name)
    copy = _copy_for(report_type, month_text, semester_name or "the current semester")
    below = percentage < threshold
    thr = int(threshold) if float(threshold).is_integer() else threshold

    # Escape all values that originate in the database or request payload before placing
    # them into HTML. This is primarily a correctness measure for names like O'Connor & Co.
    student_name_h = escape(str(student_name or ""))
    reg_no_h = escape(str(reg_no or ""))
    academic_year_h = escape(str(academic_year or ""))
    sem_code_h = escape(str(sem_code or ""))
    semester_name_h = escape(str(semester_name or ""))
    threshold_h = escape(str(thr))

    pct_display = format_attendance_percentage(percentage)
    if report_type == REPORT_MONTHLY:
        subject = f"{EMAIL_TITLE} | {month_text} | {pct_display}%"
    else:
        subject = f"{EMAIL_TITLE} | Semester to date | {pct_display}%"

    status_note = copy["short_note"] if below else copy["ok_note"]
    accent = "#dc2626" if below else "#15803d"
    accent_soft = "#fef2f2" if below else "#f0fdf4"
    accent_border = "#fecaca" if below else "#bbf7d0"
    status_label = "Below required attendance" if below else "On track"

    if below:
        if classes_for_target > 0:
            tip = (
                f"Attend the next <strong style=\"color:#111827;\">{int(classes_for_target)}</strong> "
                f"class(es) without missing one to reach {threshold_h}%."
            )
        else:
            tip = "Talk to your faculty adviser about the remaining recovery options."
    else:
        safe_misses = 0
        if threshold > 0:
            max_conducted_at_threshold = math.floor((attended * 100.0) / threshold + 1e-9)
            safe_misses = max(0, max_conducted_at_threshold - conducted)
        if safe_misses > 0:
            tip = (
                f"You can miss up to <strong style=\"color:#111827;\">{safe_misses}</strong> more "
                f"class(es) and still stay at or above {threshold_h}%."
            )
        else:
            tip = f"You are close to the {threshold_h}% line. Missing one more class may take you below it."

    subject_rows = _subject_rows_html(subjects, threshold)

    identity_parts = [reg_no_h]
    if academic_year_h:
        identity_parts.append(f"AY {academic_year_h}")
    if sem_code_h:
        identity_parts.append(f"Sem {sem_code_h}")
    identity_line = " &nbsp;·&nbsp; ".join(identity_parts)
    identity_line_plain = " · ".join(
        [str(reg_no or "")] + ([f"AY {academic_year}"] if academic_year else []) +
        ([f"Sem {sem_code}"] if sem_code else [])
    )

    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{EMAIL_TITLE}</title>
<style>
  @media (prefers-color-scheme: dark) {{
    .email-bg {{ background:#0b1120 !important; }}
    .email-card {{ background:#111827 !important; border-color:#243244 !important; }}
    .email-text {{ color:#f8fafc !important; }}
    .email-muted {{ color:#cbd5e1 !important; }}
    .email-subtle {{ color:#94a3b8 !important; }}
    .email-table {{ background:#111827 !important; border-color:#334155 !important; }}
    .email-row {{ border-color:#334155 !important; }}
    .email-white {{ color:#f8fafc !important; }}
    .email-tip {{ background:#172033 !important; border-color:#475569 !important; }}
  }}
  @media screen and (max-width:620px) {{
    .outer-pad {{ padding:12px 8px !important; }}
    .card-pad {{ padding-left:18px !important; padding-right:18px !important; }}
    .top-pad {{ padding:18px !important; }}
    .hero-number {{ font-size:38px !important; }}
    .mobile-stack, .mobile-stack tbody, .mobile-stack tr, .mobile-stack td {{ display:block !important; width:100% !important; }}
    .mobile-right {{ text-align:left !important; padding-top:14px !important; }}
    .subject-cell {{ font-size:12px !important; padding:10px !important; }}
  }}
</style>
</head>
<body class="email-bg" style="margin:0;padding:0;background:#eef2f7;font-family:{_FONT};color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="background:#eef2f7;">
<tr><td align="center" class="outer-pad" style="padding:28px 12px;">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" class="email-card" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #dbe3ec;border-radius:18px;overflow:hidden;">

  <tr><td class="top-pad" style="padding:22px 28px;background:#172554;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mobile-stack">
      <tr>
        <td valign="middle">
          <div class="email-white" style="color:#ffffff;font-size:20px;font-weight:800;line-height:1.2;letter-spacing:-0.3px;">{EMAIL_TITLE}</div>
          <div style="color:#bfdbfe;font-size:12px;font-weight:600;margin-top:5px;">{EMAIL_SENDER_LABEL}</div>
        </td>
        <td valign="middle" align="right" class="mobile-right">
          <span style="display:inline-block;background:#2563eb;color:#ffffff;font-size:11px;font-weight:800;padding:6px 10px;border-radius:999px;">{escape(copy['eyebrow'])}</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td class="card-pad" style="padding:24px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mobile-stack">
      <tr>
        <td valign="top">
          <div class="email-muted" style="font-size:14px;color:#475569;line-height:1.5;">Hi <strong class="email-text" style="color:#111827;">{student_name_h}</strong></div>
          <div class="email-subtle" style="margin-top:6px;font-size:13px;color:#64748b;line-height:1.5;">{identity_line}</div>
        </td>
        <td valign="top" align="right" class="mobile-right" style="white-space:nowrap;">
          <div class="email-subtle" style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.7px;">Attended / Conducted</div>
          <div class="email-text" style="font-size:20px;font-weight:800;color:#111827;margin-top:3px;">{int(attended)} <span class="email-subtle" style="color:#64748b;font-weight:600;">/ {int(conducted)}</span></div>
        </td>
      </tr>
    </table>
    <h1 class="email-text" style="margin:18px 0 0;color:#111827;font-size:22px;line-height:1.25;font-weight:800;letter-spacing:-.35px;">{EMAIL_TITLE}</h1>
    <p class="email-subtle" style="margin:6px 0 0;color:#64748b;font-size:13px;line-height:1.5;">{escape(copy['heading'])}</p>
  </td></tr>

  <tr><td class="card-pad" style="padding:16px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{accent_soft};border:1px solid {accent_border};border-radius:14px;">
      <tr><td style="padding:20px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mobile-stack">
          <tr>
            <td valign="middle">
              <div class="hero-number" style="font-size:46px;line-height:1;font-weight:850;letter-spacing:-1.7px;color:{accent};">{format_attendance_percentage(percentage)}%</div>
              <div style="margin-top:9px;"><span style="display:inline-block;background:{accent};color:#ffffff;font-size:11px;font-weight:800;padding:4px 10px;border-radius:999px;">{status_label}</span></div>
            </td>
            <td align="right" valign="middle" class="mobile-right" style="font-size:13px;color:#334155;line-height:1.8;">
              <strong class="email-text" style="color:#111827;">{int(missed)}</strong> missed so far<br>
              <span class="email-subtle" style="color:#64748b;">Required: {threshold_h}%</span>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td class="card-pad" style="padding:16px 28px 0;">
    <p class="email-text" style="margin:0;font-size:13.5px;line-height:1.65;color:#334155;">{escape(status_note)}</p>
    <p class="email-tip email-text" style="margin:10px 0 0;font-size:13.5px;line-height:1.6;color:#1f2937;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:11px 13px;">📌 {tip}</p>
  </td></tr>

  <tr><td class="card-pad" style="padding:24px 28px 0;">
    <div class="email-subtle" style="font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.7px;margin-bottom:9px;">By subject</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-table" style="border:1px solid #dbe3ec;border-radius:12px;background:#ffffff;overflow:hidden;">
      <thead>
        <tr style="background:#f8fafc;">
          <th class="email-subtle" style="padding:9px 12px;text-align:left;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Subject</th>
          <th class="email-subtle" style="padding:9px 12px;text-align:center;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Classes</th>
          <th class="email-subtle" style="padding:9px 12px;text-align:right;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Attendance</th>
        </tr>
      </thead>
      <tbody>{subject_rows}</tbody>
    </table>
  </td></tr>

  <tr><td class="card-pad" style="padding:22px 28px 24px;">
    <div class="email-subtle" style="font-size:11.5px;color:#64748b;line-height:1.65;">{escape(copy['scope_note'])}</div>
    <div class="email-subtle" style="margin-top:8px;font-size:11.5px;color:#64748b;line-height:1.65;">For corrections or questions, contact your <strong class="email-text" style="color:#334155;">CSE 2/4 CR</strong> or reply to this email.</div>
    <div class="email-subtle" style="margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.6;">This is a class attendance update and is not an official departmental notice.</div>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>
"""

    plain_tip = re.sub(r"</?strong[^>]*>", "", tip)
    subject_lines = "\n".join(
        f"  {s.get('code','')} {s.get('name','')}: {s.get('attended',0)}/{s.get('conducted',0)} ({format_attendance_percentage(s.get('percentage', 0))}%)"
        for s in (subjects or []) if s.get("conducted", 0) > 0
    ) or "  No classes recorded for this period."

    plain = f"""{EMAIL_TITLE}
{EMAIL_SENDER_LABEL}
{copy['eyebrow']}

Hi {student_name}
{identity_line_plain}

Attendance: {format_attendance_percentage(percentage)}% [{status_label}]
Attended {attended}/{conducted} classes | Missed {missed} | Required: {thr}%

{status_note}

TIP: {plain_tip}

BY SUBJECT
{subject_lines}

{copy['scope_note']}
For corrections or questions, contact your CSE 2/4 CR or reply to this email.
This is a class attendance update and is not an official departmental notice.
"""
    return subject, html, plain


# --------------------------------------------------------------------------- #
# Backwards-compatible wrapper (older callers / tests)
# --------------------------------------------------------------------------- #

def build_low_attendance_email_html(
    student_name: str, reg_no: str, overall_percentage: float, conducted: int,
    attended: int, missed: int, classes_for_75: int, subjects: List[Dict[str, Any]],
    academic_year: str, semester_name: str, month_label: str, threshold: float = 75.0,
    issued_by: str = "",
) -> Tuple[str, str, str]:
    """
    Legacy signature, kept for the older '/api/attendance/send-low-attendance-emails'
    endpoint so that route doesn't need its own copy of the template. Returns
    (subject, html, plain) using the cumulative template - the subject line now comes
    from the same place as every other statement, instead of being hand-built separately
    with its own department branding.
    """
    return build_attendance_report_email(
        report_type=REPORT_CUMULATIVE,
        student_name=student_name, reg_no=reg_no, percentage=overall_percentage,
        conducted=conducted, attended=attended, missed=missed,
        classes_for_target=classes_for_75, subjects=subjects,
        academic_year=academic_year, semester_name=semester_name,
        period=month_label or "", threshold=threshold, issued_by=issued_by,
    )


# --------------------------------------------------------------------------- #
# Transport
# --------------------------------------------------------------------------- #

class SmtpSession:
    """
    One TCP/TLS connection reused for an entire batch.

    The previous build opened a fresh SMTP connection, did a TLS handshake and logged in
    once PER STUDENT. For a class of 70 that is 70 handshakes and 70 logins, which is slow
    and is exactly the pattern that trips Gmail's rate limiting. This opens one connection
    and sends every message over it.
    """

    def __init__(self):
        self.server = None
        self.error = ""

    def __enter__(self):
        reload_smtp_config()
        if not is_configured():
            self.error = "SMTP is not configured on the server (SMTP_EMAIL / SMTP_APP_PASSWORD missing)."
            return self
        try:
            context = ssl.create_default_context()
            self.server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30)
            self.server.ehlo()
            self.server.starttls(context=context)
            self.server.ehlo()
            self.server.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
        except smtplib.SMTPAuthenticationError:
            self.server = None
            self.error = ("SMTP authentication failed - check SMTP_EMAIL / SMTP_APP_PASSWORD "
                          "(it must be a Gmail App Password, not the account password).")
        except Exception as e:
            self.server = None
            self.error = f"Could not connect to the mail server: {e}"
        return self

    def __exit__(self, *exc):
        try:
            if self.server:
                self.server.quit()
        except Exception:
            pass
        self.server = None
        return False

    @property
    def ready(self) -> bool:
        return self.server is not None

    def send(self, to_email: str, subject: str, html_body: str, plain_body: str,
              sender_name: Optional[str] = None) -> Tuple[bool, str]:
        if not self.ready:
            return False, self.error or "Mail session is not open."
        if not to_email or "@" not in to_email:
            return False, "Invalid or missing recipient email address."

        # Keep the student-facing sender label stable. The individual CR/LR name is not
        # exposed in the message because the email is a class-level attendance update.
        display_name = EMAIL_SENDER_LABEL

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = formataddr((display_name, SMTP_EMAIL))
        msg["To"] = to_email
        msg["Reply-To"] = SMTP_REPLY_TO
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid(domain=(SMTP_EMAIL.split("@", 1)[1] if "@" in SMTP_EMAIL else "attendance.local"))
        msg["Auto-Submitted"] = "auto-generated"
        msg["X-Auto-Response-Suppress"] = "OOF, AutoReply"

        msg.attach(MIMEText(plain_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        try:
            self.server.sendmail(SMTP_EMAIL, [to_email], msg.as_string())
            return True, ""
        except smtplib.SMTPRecipientsRefused:
            return False, "The recipient address was refused by the mail server."
        except smtplib.SMTPServerDisconnected as e:
            self.server = None
            self.error = f"Mail server disconnected mid-batch: {e}"
            return False, self.error
        except Exception as e:
            return False, str(e)


def send_email(to_email: str, subject: str, html_body: str, plain_body: str,
                sender_name: Optional[str] = None) -> Tuple[bool, str]:
    """Single-message convenience wrapper. Prefer SmtpSession for batches."""
    with SmtpSession() as session:
        if not session.ready:
            return False, session.error
        return session.send(to_email, subject, html_body, plain_body, sender_name=sender_name)
