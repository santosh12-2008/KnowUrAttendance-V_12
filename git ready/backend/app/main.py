import os
import re
import json
import sqlite3
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.background import BackgroundTasks
from typing import Optional, List

from app.database import init_db, get_db, reset_academic_data
from app.models import (
    LoginRequest, SemesterCreate, SemesterUpdate, MonthUpdate, SubjectCreate, SubjectUpdate,
    TimetableSlotCreate, TimetableSlotUpdate, BatchRangeCreate, StudentCreate, StudentUpdate,
    AttendanceMarkRequest, BulkStudentImportRequest, SetupWizardPayload,
    HolidayCreate, ClassCancelRequest, StudentFormCreate, StudentFormResponseSubmit,
    ExtraClassCreate, LateralJoiningDateUpdate, StudentDropRequest, CustomDayTimetableRequest,
    ClassUncancelRequest, ChangeAdminPasswordRequest, ChangeStudentPasswordRequest,
    ForgotPasswordRequest, PasswordRequestAction, StudentHelpdeskRequest,
    StudentRequestStatusUpdate, SmartImportRequest, SemesterActivateRequest, SemesterCreateNew,
    SendAttendanceAlertsRequest, AttendanceEmailRequest, SemesterDeleteRequest
)
from app.auth import authenticate_user, verify_token, refresh_access_token, upgrade_legacy_session
from app.security import (
    hash_password, verify_password, validate_new_password,
    is_default_student_password, is_default_admin_password,
)
from app.calculations import (
    calculate_student_attendance,
    calculate_class_overview,
    calculate_class_statistics,
    get_percentage_color
)
from app.seed_data import seed_database_if_empty, load_au_cse_template
from app import email_service
from app.formatting import format_attendance_percentage  # display only; never used for calculations
from app import dispatch as dispatch_engine

# Initialize SQLite database
init_db()
seed_database_if_empty()

# Lateral-entry policy is centralized: every 125+ student uses the semester's single
# attendance start date. This repairs older databases that had Sep 01 or per-student
# dates from the previous implementation. The intended default is Aug 02, 2026.
DEFAULT_LATERAL_JOINING_DATE = "2026-08-02"
with get_db() as _lateral_conn:
    _cur = _lateral_conn.cursor()
    _cur.execute("SELECT id, lateral_joining_date FROM semesters")
    for _sem in _cur.fetchall():
        _sem_date = (_sem["lateral_joining_date"] or "").strip()
        if not _sem_date or _sem_date == "2026-09-01":
            _sem_date = DEFAULT_LATERAL_JOINING_DATE
            _cur.execute("UPDATE semesters SET lateral_joining_date = ? WHERE id = ?", (_sem_date, _sem["id"]))
        # 125+ is authoritative regardless of imported category text.
        _cur.execute("SELECT id, reg_no, category, joining_date FROM students WHERE semester_id = ?", (_sem["id"],))
        for _st in _cur.fetchall():
            try:
                _last3 = int(str(_st["reg_no"])[-3:])
            except Exception:
                _last3 = -1
            if _last3 >= 125:
                # Registration number determines category, but the individual joining date
                # is authoritative once it has been set.  Startup must never overwrite
                # CR/LR edits with the semester default.
                if _st["category"] != "Lateral Entry":
                    _cur.execute("UPDATE students SET category = 'Lateral Entry' WHERE id = ?", (_st["id"],))
                if not (_st["joining_date"] or "").strip():
                    _cur.execute("UPDATE students SET joining_date = ? WHERE id = ?", (_sem_date, _st["id"]))


def resolve_marked_by(authorization: Optional[str] = None) -> str:
    """Extract authenticated CR or LR name from token for attendance attribution."""
    if authorization:
        try:
            token = authorization.replace("Bearer ", "").strip()
            payload = verify_token(token)
            if payload and payload.get("name"):
                return payload["name"]
        except Exception:
            pass
    return "Authenticated staff"

def resolve_batch_for_reg(reg_no_str: str, ranges: list, default_batch: Optional[str] = None) -> str:
    """
    Shared batch-resolution logic used by bulk-import and smart-import:
    1. Use an explicitly provided default_batch if it's one of the 3 valid batches.
    2. Otherwise match against configured batch_ranges (start_reg_no/end_reg_no).
    3. Otherwise fall back to a positional split by the last 3 digits of reg_no.
    """
    if default_batch in ["Batch 1", "Batch 2", "Batch 3"]:
        return default_batch
    for r in ranges:
        if r["start_reg_no"] <= reg_no_str <= r["end_reg_no"]:
            return r["batch_name"]
    try:
        last3 = int(reg_no_str[-3:])
        if last3 <= 47:
            return "Batch 1"
        elif last3 <= 94:
            return "Batch 2"
        else:
            return "Batch 3"
    except Exception:
        return "Batch 1"

def resolve_student_category(reg_no_str: str, provided_cat: Optional[str] = None) -> str:
    """
    AUCE(A) CSE Admission Category allocation:
    001 to 062: EAPCET Admission
    063 to 117: Foreigners
    118 to 124: Sweden Batch
    125 to rest: Lateral Entry
    """
    # Registration number is the source of truth for the AU CSE roster.
    # 125+ must ALWAYS be Lateral Entry, even if an imported spreadsheet says otherwise.
    try:
        last3 = int(reg_no_str[-3:])
        if last3 >= 125:
            return "Lateral Entry"
        if 1 <= last3 <= 62:
            return "EAPCET Admission"
        elif 63 <= last3 <= 117:
            return "Foreigners"
        elif 118 <= last3 <= 124:
            return "Sweden Batch"
    except Exception:
        pass
    if provided_cat and provided_cat.strip() and provided_cat.strip() not in ["", "Convener (EAPCET)", "Default"]:
        return provided_cat.strip()
    return "EAPCET Admission"

# One-time migration to ensure existing records follow standard AU emails and categories
with get_db() as _sync_conn:
    _sync_cur = _sync_conn.cursor()
    _sync_cur.execute("SELECT id, reg_no, category, email, joining_date FROM students")
    for _row in _sync_cur.fetchall():
        _st_id = _row["id"]
        _reg = _row["reg_no"]
        _cat = _row["category"]
        _email = _row["email"]
        _jdate = _row["joining_date"]

        _new_email = _email
        if not _email or "@" not in _email or _email.endswith("@aucecse.edu.in"):
            _new_email = f"{_reg}@andhrauniversity.edu.in"

        _new_cat = _cat
        if not _cat or _cat in ["Convener (EAPCET)", "", "Default"]:
            _new_cat = resolve_student_category(_reg, None)

        _new_jdate = _jdate
        if _new_cat == "Lateral Entry" and not _jdate:
            _new_jdate = "2026-08-02"

        _sync_cur.execute("""
            UPDATE students 
            SET email = ?, category = ?, joining_date = ?
            WHERE id = ?
        """, (_new_email, _new_cat, _new_jdate, _st_id))

IST = ZoneInfo("Asia/Kolkata")
def now_ist():
    return datetime.now(IST)

def time_to_minutes(value):
    """Convert common 12/24-hour timetable strings to minutes after midnight."""
    if not value:
        return 24 * 60
    text = str(value).strip().upper().replace(".", ":")
    for fmt in ("%I:%M %p", "%I:%M%p", "%H:%M", "%H:%M:%S"):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.hour * 60 + parsed.minute
        except ValueError:
            continue
    return 24 * 60

app = FastAPI(title="KnowUrAttendance - AUCE(A) CSE", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Authentication dependency
def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "").strip()
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


def require_staff(user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    return user

def require_cr_or_admin(user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/Admin authorization required")
    return user

# ----------------- AUTHENTICATION ROUTES ----------------- #

@app.post("/api/auth/login")
def login(req: LoginRequest):
    identifier = (req.reg_no or req.username or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Registration Number or Admin Username is required")
    with get_db() as conn:
        user = authenticate_user(conn, identifier, req.password, req.role)
        if not user:
            if req.role.lower() in ["cr", "lr", "admin"]:
                raise HTTPException(status_code=401, detail="Invalid Admin credentials. Access denied.")
            else:
                raise HTTPException(status_code=401, detail="Invalid student credentials. Please check your Registration Number and Password.")
        return user

@app.get("/api/auth/me")
def get_me(user: dict = Depends(get_current_user)):
    return user

@app.post("/api/auth/refresh")
def refresh_login(payload: dict):
    """Silently issue a fresh access token, including migration of a still-valid legacy session."""
    refresh_token = str(payload.get("refresh_token") or "").strip()
    legacy_access_token = str(payload.get("access_token") or "").strip()
    if refresh_token:
        token = refresh_access_token(refresh_token)
        if not token:
            raise HTTPException(status_code=401, detail="Refresh session expired. Please log in again.")
        return {"token": token}
    if legacy_access_token:
        new_refresh = upgrade_legacy_session(legacy_access_token)
        if new_refresh:
            new_access = refresh_access_token(new_refresh)
            return {"token": new_access, "refresh_token": new_refresh}
    raise HTTPException(status_code=400, detail="Refresh session information is required")

# ----------------- PASSWORD MANAGEMENT & FORGOT PASSWORD WORKFLOW ----------------- #

@app.put("/api/auth/change-admin-password")
def change_admin_password(req: ChangeAdminPasswordRequest, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="Only CR/LR administrators can access this endpoint")
    
    current_user_name = user.get("sub", "")
    target_role = (req.target_role or user.get("role", "cr")).lower()
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM admin_accounts WHERE role = ? OR username = ?", (target_role, target_role))
        admin = cursor.fetchone()
        
        if not admin:
            # Check by current user name
            cursor.execute("SELECT * FROM admin_accounts WHERE username = ?", (current_user_name,))
            admin = cursor.fetchone()

        if not admin:
            raise HTTPException(status_code=404, detail="Admin account not found")

        # Verify current password against the stored hash (legacy plaintext rows still verify)
        ok, _needs_upgrade = verify_password(req.current_password, admin["password_hash"])
        if not ok:
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        new_pwd = req.new_password.strip()
        err = validate_new_password(new_pwd, username=admin["username"])
        if err:
            raise HTTPException(status_code=400, detail=err)
        if new_pwd == req.current_password.strip():
            raise HTTPException(status_code=400, detail="The new password must be different from the current one.")

        cursor.execute("""
            UPDATE admin_accounts
            SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (hash_password(new_pwd), admin["id"]))

        return {
            "status": "success",
            "message": f"Password for {admin['name']} updated successfully. The default password will no longer work for this account."
        }

@app.put("/api/auth/change-student-password")
def change_student_password(req: ChangeStudentPasswordRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Only students can access this endpoint")

    student_reg = user.get("sub")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM students WHERE reg_no = ?", (student_reg,))
        student = cursor.fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        stored = student["password"] if "password" in student.keys() else None
        changed_at = student["password_changed_at"] if "password_changed_at" in student.keys() else None
        current = req.current_password.strip()

        valid, _needs_upgrade = verify_password(current, stored) if stored else (False, False)

        # A default is accepted as the CURRENT password only while the student has never
        # set one of their own. Once password_changed_at is stamped, defaults are dead.
        if not valid and not changed_at and is_default_student_password(student_reg, current):
            valid = True

        if not valid:
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        new_pwd = req.new_password.strip()
        err = validate_new_password(new_pwd, reg_no=student_reg)
        if err:
            raise HTTPException(status_code=400, detail=err)
        if new_pwd == current:
            raise HTTPException(status_code=400, detail="The new password must be different from your current one.")

        cursor.execute(
            "UPDATE students SET password = ?, password_changed_at = CURRENT_TIMESTAMP WHERE reg_no = ?",
            (hash_password(new_pwd), student_reg),
        )
        return {
            "status": "success",
            "message": "Your password has been changed. The default password issued to you will no longer work."
        }

@app.post("/api/auth/forgot-password")
def forgot_password_request(req: ForgotPasswordRequest):
    clean_reg = req.reg_no.strip()
    new_pwd = req.new_password.strip()
    if not clean_reg or not new_pwd:
        raise HTTPException(status_code=400, detail="Registration Number and desired new password are required")
    _err = validate_new_password(new_pwd, reg_no=clean_reg)
    if _err:
        raise HTTPException(status_code=400, detail=_err)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM students WHERE reg_no = ?", (clean_reg,))
        stu = cursor.fetchone()
        if not stu:
            raise HTTPException(status_code=404, detail="No registered student found with this Registration Number.")

        cursor.execute("""
            INSERT INTO password_reset_requests (student_reg_no, student_name, requested_password, status)
            VALUES (?, ?, ?, 'PENDING')
        """, (clean_reg, stu["name"], new_pwd))

        return {
            "status": "success",
            "message": "Password reset request submitted successfully! Your CR will review and approve it shortly."
        }

@app.get("/api/auth/password-requests")
def get_password_requests(user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM password_reset_requests ORDER BY id DESC LIMIT 100")
        return [dict(r) for r in cursor.fetchall()]

@app.put("/api/auth/password-requests/{req_id}/action")
def resolve_password_request(req_id: int, body: PasswordRequestAction, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    
    action = body.action.upper().strip()
    if action not in ["APPROVE", "DENY"]:
        raise HTTPException(status_code=400, detail="Action must be APPROVE or DENY")

    resolver_name = user.get("name") or user.get("sub") or "CR"

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM password_reset_requests WHERE id = ?", (req_id,))
        p_req = cursor.fetchone()
        if not p_req:
            raise HTTPException(status_code=404, detail="Password request not found")

        new_status = "APPROVED" if action == "APPROVE" else "DENIED"

        if action == "APPROVE":
            cursor.execute(
                "UPDATE students SET password = ?, password_changed_at = CURRENT_TIMESTAMP WHERE reg_no = ?",
                (hash_password(p_req["requested_password"]), p_req["student_reg_no"]),
            )
            # The plaintext request is no longer needed once applied - don't leave it lying
            # around in the requests table where the CR list endpoint can read it back.
            cursor.execute(
                "UPDATE password_reset_requests SET requested_password = '(applied)' WHERE id = ?",
                (req_id,),
            )

        cursor.execute("""
            UPDATE password_reset_requests
            SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
            WHERE id = ?
        """, (new_status, resolver_name, req_id))

        return {
            "status": "success",
            "message": f"Password reset request {new_status.lower()} for {p_req['student_name']} ({p_req['student_reg_no']})."
        }

# ----------------- STUDENT HELPDESK & WORK REQUESTS ----------------- #

@app.post("/api/requests")
def submit_student_request(req: StudentHelpdeskRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Only students can submit helpdesk requests")

    reg_no = user.get("sub")
    category = req.category.strip()
    subject = req.subject.strip()
    message = req.message.strip()

    if not subject or not message:
        raise HTTPException(status_code=400, detail="Subject and message are required")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name, batch FROM students WHERE reg_no = ?", (reg_no,))
        stu = cursor.fetchone()
        name = stu["name"] if stu else "Student"
        batch = stu["batch"] if stu else "Batch 1"

        cursor.execute("""
            INSERT INTO student_requests (student_reg_no, student_name, student_batch, category, subject, message, status)
            VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
        """, (reg_no, name, batch, category, subject, message))

        return {
            "status": "success",
            "id": cursor.lastrowid,
            "message": "Your request has been submitted to CR/LR team."
        }

@app.get("/api/requests/my")
def get_my_requests(user: dict = Depends(get_current_user)):
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student authorization required")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM student_requests
            WHERE student_reg_no = ?
            ORDER BY id DESC LIMIT 50
        """, (user.get("sub"),))
        return [dict(r) for r in cursor.fetchall()]

@app.get("/api/requests/all")
def get_all_student_requests(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")

    with get_db() as conn:
        cursor = conn.cursor()
        if status and status.upper() != "ALL":
            cursor.execute("""
                SELECT * FROM student_requests
                WHERE UPPER(status) = UPPER(?)
                ORDER BY id DESC LIMIT 100
            """, (status,))
        else:
            cursor.execute("""
                SELECT * FROM student_requests
                ORDER BY id DESC LIMIT 100
            """)
        return [dict(r) for r in cursor.fetchall()]

@app.put("/api/requests/{req_id}/status")
def update_student_request_status(req_id: int, body: StudentRequestStatusUpdate, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM student_requests WHERE id = ?", (req_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Request not found")

        cursor.execute("""
            UPDATE student_requests
            SET status = ?, cr_note = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (body.status.upper(), body.cr_note, req_id))

        return {"status": "success", "message": f"Request status updated to {body.status}."}

# ----------------- SEMESTER ARCHIVE & ACTIVE SEMESTER ----------------- #

@app.get("/api/semesters")
def get_all_semesters(user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM semesters ORDER BY is_active DESC, id DESC")
        return [dict(r) for r in cursor.fetchall()]

@app.put("/api/semesters/{sem_id}/activate")
def activate_semester(sem_id: int, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM semesters WHERE id = ?", (sem_id,))
        target = cursor.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Semester not found")

        cursor.execute("UPDATE semesters SET is_active = 0")
        cursor.execute("UPDATE semesters SET is_active = 1 WHERE id = ?", (sem_id,))

        return {"status": "success", "message": f"Semester '{target['name']}' activated."}

@app.get("/api/semesters/active")
def get_active_semester():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=404, detail="No active semester configured")
        return dict(sem)

@app.put("/api/semesters/active-month")
def update_active_month(req: MonthUpdate, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    month = (req.active_month or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise HTTPException(status_code=400, detail="Active month must use YYYY-MM format.")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, start_month, end_month FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=404, detail="No active semester found")
        if month < sem["start_month"] or month > sem["end_month"]:
            raise HTTPException(status_code=400, detail="Selected month is outside the active semester span.")
        cursor.execute("UPDATE semesters SET active_month = ? WHERE id = ?", (month, sem["id"]))
        return {"status": "success", "active_month": month}

@app.post("/api/semesters")
def create_or_update_semester(req: SemesterCreate, user: dict = Depends(require_staff)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    values = [req.academic_year.strip(), req.name.strip(), req.start_month.strip(), req.end_month.strip(), req.active_month.strip()]
    if not values[0] or not values[1] or not all(re.fullmatch(r"\d{4}-\d{2}", v) for v in values[2:]):
        raise HTTPException(status_code=400, detail="Invalid semester calendar values. Use YYYY-MM months.")
    if values[2] > values[3] or not (values[2] <= values[4] <= values[3]):
        raise HTTPException(status_code=400, detail="Active month must be inside the semester span.")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE name = ? AND academic_year = ?", (values[1], values[0]))
        existing = cursor.fetchone()
        if existing:
            cursor.execute("""UPDATE semesters SET start_month=?, end_month=?, active_month=? WHERE id=?""", (values[2], values[3], values[4], existing["id"]))
            return {"status":"success","id":existing["id"],"created":False}
        cursor.execute("""
            INSERT INTO semesters (academic_year, name, start_month, end_month, active_month, is_active, setup_complete)
            VALUES (?, ?, ?, ?, ?, 0, 0)
        """, values)
        return {"status": "success", "id": cursor.lastrowid, "created": True, "message": "Semester created as archived. Activate it from the semester bar when ready."}

@app.post("/api/semesters/new")
def create_new_semester(req: SemesterCreateNew, user: dict = Depends(get_current_user)):
    """Create a genuinely separate semester without overwriting existing data."""
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    values = [req.academic_year.strip(), req.name.strip(), req.start_month.strip(), req.end_month.strip(), req.active_month.strip()]
    if not all(values):
        raise HTTPException(status_code=400, detail="Academic year, name and calendar months are required.")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE name = ? AND academic_year = ?", (values[1], values[0]))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail="A semester with this name and academic year already exists.")
        # New semesters are NEVER activated automatically. This is the key isolation rule:
        # creating 2-2 must not move the portal away from the currently active 2-1 data.
        cursor.execute("SELECT id, lateral_joining_date FROM semesters WHERE is_active = 1 LIMIT 1")
        old = cursor.fetchone()
        inherited_lateral_date = old["lateral_joining_date"] if old else DEFAULT_LATERAL_JOINING_DATE
        cursor.execute("""
            INSERT INTO semesters (academic_year,name,start_month,end_month,active_month,is_active,setup_complete,lateral_joining_date)
            VALUES (?, ?, ?, ?, ?, 0, 0, ?)
        """, (*values, inherited_lateral_date))
        new_id = cursor.lastrowid
        copied = 0
        if req.continue_student_details and old:
            cursor.execute("""
                INSERT INTO students
                (reg_no,name,batch,mobile,email,category,admission_no,semester_id,joining_date,
                 is_dropped,dropped_reason,dropped_date,password,password_changed_at)
                SELECT reg_no,name,batch,mobile,email,category,admission_no,?,joining_date,
                       0,NULL,NULL,password,password_changed_at
                FROM students WHERE semester_id = ?
                ON CONFLICT(reg_no, semester_id) DO NOTHING
            """, (new_id, old["id"]))
            copied = cursor.rowcount
        return {"status":"success","id":new_id,"students_copied":copied,
                "message":"New semester created separately. The current semester remains active until you explicitly switch."}

@app.delete("/api/semesters/{sem_id}")
def delete_semester(sem_id: int, req: SemesterDeleteRequest, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "admin"]:
        raise HTTPException(status_code=403, detail="Only CR/Admin can delete a semester")
    if req.confirmation.strip().upper() != "DELETE SEMESTER":
        raise HTTPException(status_code=400, detail="Type DELETE SEMESTER exactly to confirm deletion.")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, is_active FROM semesters WHERE id = ?", (sem_id,))
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=404, detail="Semester not found")
        cursor.execute("SELECT COUNT(*) AS c FROM semesters")
        if cursor.fetchone()["c"] <= 1:
            raise HTTPException(status_code=400, detail="The final semester cannot be deleted.")
        if sem["is_active"]:
            cursor.execute("SELECT id FROM semesters WHERE id <> ? ORDER BY id DESC LIMIT 1", (sem_id,))
            replacement = cursor.fetchone()
            if not replacement:
                raise HTTPException(status_code=400, detail="Activate another semester before deleting the active semester.")
            cursor.execute("UPDATE semesters SET is_active = 0")
            cursor.execute("UPDATE semesters SET is_active = 1 WHERE id = ?", (replacement["id"],))
        cursor.execute("DELETE FROM semesters WHERE id = ?", (sem_id,))
        return {"status":"success","message":f"Semester '{sem['name']}' deleted. All data belonging only to that semester was removed."}

@app.put("/api/semesters/current")
def update_current_semester(req: SemesterUpdate, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=404, detail="No active semester found")

        academic_year = (req.academic_year if req.academic_year is not None else sem["academic_year"]).strip()
        name = (req.name if req.name is not None else sem["name"]).strip()
        start_month = (req.start_month if req.start_month is not None else sem["start_month"]).strip()
        end_month = (req.end_month if req.end_month is not None else sem["end_month"]).strip()
        active_month = (req.active_month if req.active_month is not None else sem["active_month"]).strip()

        for label, value in (("start month", start_month), ("end month", end_month), ("active month", active_month)):
            if not re.fullmatch(r"\d{4}-\d{2}", value):
                raise HTTPException(status_code=400, detail=f"Invalid {label}. Use YYYY-MM format.")
        if start_month > end_month:
            raise HTTPException(status_code=400, detail="Semester start month cannot be after the end month.")
        if active_month < start_month or active_month > end_month:
            # If the span is changed and the old active month falls outside it, move the
            # active pointer to the new start rather than leaving the portals on a month
            # that no longer belongs to the semester.
            active_month = start_month

        if not academic_year or not name:
            raise HTTPException(status_code=400, detail="Academic year and semester name are required.")

        cursor.execute("""
            UPDATE semesters
            SET academic_year = ?, name = ?, start_month = ?, end_month = ?, active_month = ?
            WHERE id = ?
        """, (academic_year, name, start_month, end_month, active_month, sem["id"]))
        return {"status": "success", "active_month": active_month, "start_month": start_month, "end_month": end_month}

# ----------------- CR SETUP WIZARD & DATA MANAGEMENT ----------------- #

@app.post("/api/setup/reset")
def reset_database(user: dict = Depends(require_cr_or_admin)):
    if user.get("role") not in ["cr", "admin"]:
        raise HTTPException(status_code=403, detail="Only CR/Admin can reset academic data")
    with get_db() as conn:
        reset_academic_data(conn)
        return {"status": "success", "message": "Database reset to clean slate. Ready for CR configuration."}

@app.post("/api/setup/load-template")
def load_template(user: dict = Depends(require_staff)):
    with get_db() as conn:
        res = load_au_cse_template(conn)
        return {"status": "success", "data": res}

@app.get("/api/setup/status")
def get_setup_status(user: dict = Depends(require_staff)):
    """
    Lets the CR Setup Wizard figure out exactly what has already been saved, so it can
    pre-fill itself with the CR's real data (instead of the hardcoded sample defaults) and
    jump straight to the first step that still needs attention, rather than making the CR
    start over from Step 1 every time they reopen it.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM semesters WHERE is_active = 1 LIMIT 1")
        sem_row = cursor.fetchone()

        if not sem_row:
            return {
                "has_active_semester": False,
                "semester": None,
                "subjects": [],
                "timetable": [],
                "batch_ranges": [],
                "students": [],
                "students_count": 0,
                "next_step": 1
            }

        semester_id = sem_row["id"]

        cursor.execute("SELECT * FROM subjects WHERE semester_id = ? ORDER BY id ASC", (semester_id,))
        subjects = [dict(r) for r in cursor.fetchall()]
        code_by_id = {s["id"]: s["code"] for s in subjects}

        cursor.execute("SELECT * FROM timetable_slots WHERE semester_id = ? ORDER BY id ASC", (semester_id,))
        timetable = []
        for r in cursor.fetchall():
            row = dict(r)
            row["subject_code"] = code_by_id.get(row["subject_id"], "")
            timetable.append(row)

        cursor.execute("SELECT * FROM batch_ranges WHERE semester_id = ? ORDER BY id ASC", (semester_id,))
        batch_ranges = [dict(r) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT reg_no, name, batch, mobile, email, category, admission_no
            FROM students WHERE semester_id = ? ORDER BY reg_no ASC
        """, (semester_id,))
        students = [dict(r) for r in cursor.fetchall()]

        # A newly-created semester deliberately restarts at Step 1.
        if int(sem_row["setup_complete"] or 0) == 0:
            next_step = 1
        elif not subjects:
            next_step = 2
        elif not timetable:
            next_step = 3
        elif not batch_ranges:
            next_step = 4
        else:
            next_step = 5

        return {
            "has_active_semester": True,
            "semester": dict(sem_row),
            "subjects": subjects,
            "timetable": timetable,
            "batch_ranges": batch_ranges,
            "students": students,
            "students_count": len(students),
            "next_step": next_step
        }


@app.post("/api/setup/full")
def full_academic_setup(payload: SetupWizardPayload, user: dict = Depends(require_staff)):
    """
    Saves the CR Setup Wizard's 5 steps:
    1. Semester & Calendar Duration
    2. Subjects
    3. Weekly Timetable
    4. Batch Ranges
    5. Students

    This is deliberately NOT a wipe-and-recreate any more. Re-running the wizard (e.g.
    because a CR only got through some of the steps the first time, or wants to add a few
    more students later) used to call reset_academic_data() unconditionally, which deleted
    every student, every attendance record, every password a student had already set, and
    every audit log - even though only one section was actually incomplete. Now:
      - An existing active semester is updated in place (same id), not deleted.
      - Subjects are upserted by code, keeping their id, so attendance history tied to a
        subject_id is never orphaned.
      - The weekly timetable and batch ranges are only replaced when the wizard actually
        sent new ones (an empty step 3/4 in the payload never erases what's saved).
      - Students are upserted by reg_no (never deleted here), and passwords are left alone.
    Each student row is validated individually - one bad row is skipped with a reason
    instead of failing the whole request, and the response says exactly what happened.
    """
    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Semester - reuse the existing active semester if there is one.
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        existing_sem = cursor.fetchone()

        sem = payload.semester
        if not sem.name.strip() or not sem.start_month.strip() or not sem.end_month.strip() or not sem.active_month.strip():
            raise HTTPException(status_code=400, detail="Semester title and start/end/active months are required.")

        if existing_sem:
            semester_id = existing_sem["id"]
            cursor.execute("""
                UPDATE semesters
                SET academic_year = ?, name = ?, start_month = ?, end_month = ?, active_month = ?
                WHERE id = ?
            """, (
                sem.academic_year.strip(), sem.name.strip(), sem.start_month.strip(),
                sem.end_month.strip(), sem.active_month.strip(), semester_id
            ))
        else:
            cursor.execute("""
                INSERT INTO semesters (academic_year, name, start_month, end_month, active_month, is_active)
                VALUES (?, ?, ?, ?, ?, 1)
            """, (
                sem.academic_year.strip(), sem.name.strip(), sem.start_month.strip(),
                sem.end_month.strip(), sem.active_month.strip()
            ))
            semester_id = cursor.lastrowid

        # 2. Subjects - upsert by (semester_id, code); never delete, so subject_id stays
        #    stable for any attendance already recorded against it.
        subject_id_map = {}  # code -> id
        for sub in payload.subjects:
            code = sub.code.strip().upper()
            if not code or not sub.name.strip():
                continue
            cursor.execute("SELECT id FROM subjects WHERE semester_id = ? AND code = ?", (semester_id, code))
            row = cursor.fetchone()
            faculty = sub.faculty_name.strip() if sub.faculty_name else ""
            if row:
                cursor.execute("""
                    UPDATE subjects SET name = ?, type = ?, faculty_name = ? WHERE id = ?
                """, (sub.name.strip(), sub.type.strip(), faculty, row["id"]))
                subject_id_map[code] = row["id"]
            else:
                cursor.execute("""
                    INSERT INTO subjects (semester_id, code, name, type, faculty_name)
                    VALUES (?, ?, ?, ?, ?)
                """, (semester_id, code, sub.name.strip(), sub.type.strip(), faculty))
                subject_id_map[code] = cursor.lastrowid

        # Fall back to whatever subjects already exist in the DB for this semester, so a
        # student-only or timetable-only re-submit (payload.subjects == []) can still map
        # timetable subject_code -> subject_id correctly.
        if not subject_id_map:
            cursor.execute("SELECT id, code FROM subjects WHERE semester_id = ?", (semester_id,))
            for r in cursor.fetchall():
                subject_id_map[r["code"]] = r["id"]

        # 3. Batch Ranges - only touched if this submission actually included ranges.
        batch_ranges_count = 0
        if payload.batch_ranges:
            cursor.execute("DELETE FROM batch_ranges WHERE semester_id = ?", (semester_id,))
            for br in payload.batch_ranges:
                if not br.batch_name.strip() or not br.start_reg_no.strip() or not br.end_reg_no.strip():
                    continue
                cursor.execute("""
                    INSERT INTO batch_ranges (semester_id, batch_name, start_reg_no, end_reg_no)
                    VALUES (?, ?, ?, ?)
                """, (semester_id, br.batch_name.strip(), br.start_reg_no.strip(), br.end_reg_no.strip()))
                batch_ranges_count += 1

        # 4. Weekly Timetable - only touched if this submission actually included slots.
        #    Safe to fully replace: timetable_slots.id is only referenced by
        #    attendance_sessions.slot_id, which is ON DELETE SET NULL (not CASCADE), so
        #    replacing the timetable never deletes attendance history.
        slots_count = 0
        if payload.timetable:
            cursor.execute("DELETE FROM timetable_slots WHERE semester_id = ?", (semester_id,))
            for slot in payload.timetable:
                code = (slot.subject_code or "").strip().upper()
                sub_id = subject_id_map.get(code) or slot.subject_id
                if not sub_id:
                    continue
                cursor.execute("""
                    INSERT INTO timetable_slots (semester_id, day_of_week, start_time, end_time, subject_id, slot_type, batch)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (semester_id, slot.day_of_week.strip(), slot.start_time.strip(), slot.end_time.strip(), sub_id, slot.slot_type.strip(), slot.batch.strip()))
                slots_count += 1

        # 5. Students - upsert by reg_no (never delete here). Passwords are never touched.
        #    Each row is validated on its own so one bad row doesn't sink the whole batch.
        cursor.execute("SELECT lateral_joining_date FROM semesters WHERE id = ?", (semester_id,))
        _lrow = cursor.fetchone()
        lateral_date = (_lrow["lateral_joining_date"] if _lrow and _lrow["lateral_joining_date"] else DEFAULT_LATERAL_JOINING_DATE)
        cursor.execute("UPDATE semesters SET lateral_joining_date = ? WHERE id = ?", (lateral_date, semester_id))

        inserted_students = 0
        skipped_rows = []
        for idx, stu in enumerate(payload.students):
            reg_no = str(stu.get("reg_no") or "").strip()
            name = str(stu.get("name") or "").strip()
            row_label = reg_no or name or f"row {idx + 1}"

            if not reg_no:
                skipped_rows.append({"row": row_label, "reason": "Missing registration number"})
                continue
            if not name:
                skipped_rows.append({"row": row_label, "reason": "Missing student name"})
                continue
            if len(reg_no) > 30:
                skipped_rows.append({"row": row_label, "reason": "Registration number too long"})
                continue
            if len(name) > 100:
                name = name[:100]

            batch = str(stu.get("batch") or "Batch 1").strip() or "Batch 1"
            mobile = str(stu.get("mobile") or "").strip()
            email = str(stu.get("email") or "").strip()
            category = resolve_student_category(reg_no, stu.get("category"))
            admission_no = str(stu.get("admission_no") or "").strip()
            joining_date = lateral_date if category == "Lateral Entry" else None

            cursor.execute("""
                INSERT INTO students (reg_no, name, batch, mobile, email, category, admission_no, joining_date, semester_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(reg_no, semester_id) DO UPDATE SET
                    name = excluded.name,
                    batch = excluded.batch,
                    mobile = excluded.mobile,
                    email = excluded.email,
                    category = excluded.category,
                    admission_no = excluded.admission_no,
                    joining_date = excluded.joining_date,
                    semester_id = excluded.semester_id
            """, (reg_no, name, batch, mobile, email, category, admission_no, joining_date, semester_id))
            inserted_students += 1

        cursor.execute("UPDATE semesters SET setup_complete = 1 WHERE id = ?", (semester_id,))
        cursor.execute("SELECT COUNT(*) AS c FROM students WHERE semester_id = ?", (semester_id,))
        total_students_now = cursor.fetchone()["c"]

        return {
            "status": "success",
            "semester_id": semester_id,
            "subjects_count": len(subject_id_map),
            "slots_count": slots_count,
            "batch_ranges_count": batch_ranges_count,
            "students_count": inserted_students,
            "total_students": total_students_now,
            "skipped_students": skipped_rows
        }

# ----------------- SUBJECTS ----------------- #

@app.get("/api/subjects")
def get_subjects(user: dict = Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT s.* FROM subjects s
            JOIN semesters sem ON s.semester_id = sem.id
            WHERE sem.is_active = 1
            ORDER BY s.type DESC, s.code ASC
        """)
        return [dict(row) for row in cursor.fetchall()]

@app.post("/api/subjects")
def add_subject(req: SubjectCreate, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester")
        cursor.execute("""
            INSERT INTO subjects (semester_id, code, name, type, faculty_name)
            VALUES (?, ?, ?, ?, ?)
        """, (sem["id"], req.code.strip(), req.name.strip(), req.type.strip(), req.faculty_name.strip()))
        return {"status": "success", "id": cursor.lastrowid}

@app.delete("/api/subjects/{subject_id}")
def delete_subject(subject_id: int, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM subjects WHERE id = ?", (subject_id,))
        return {"status": "success"}

@app.put("/api/subjects/{subject_id}")
def update_subject(subject_id: int, req: SubjectUpdate, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        updates = []
        params = []
        if req.code is not None:
            updates.append("code = ?")
            params.append(req.code.strip())
        if req.name is not None:
            updates.append("name = ?")
            params.append(req.name.strip())
        if req.type is not None:
            updates.append("type = ?")
            params.append(req.type.strip())
        if req.faculty_name is not None:
            updates.append("faculty_name = ?")
            params.append(req.faculty_name.strip())

        if updates:
            params.append(subject_id)
            cursor.execute(f"UPDATE subjects SET {', '.join(updates)} WHERE id = ?", params)
        return {"status": "success"}

# ----------------- TIMETABLE ----------------- #

@app.get("/api/timetable")
def get_timetable(user: dict = Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.*, s.name as subject_name, s.code as subject_code, s.faculty_name as faculty_name
            FROM timetable_slots t
            JOIN subjects s ON t.subject_id = s.id
            JOIN semesters sem ON t.semester_id = sem.id
            WHERE sem.is_active = 1
            ORDER BY 
                CASE t.day_of_week
                    WHEN 'Monday' THEN 1
                    WHEN 'Tuesday' THEN 2
                    WHEN 'Wednesday' THEN 3
                    WHEN 'Thursday' THEN 4
                    WHEN 'Friday' THEN 5
                    WHEN 'Saturday' THEN 6
                    ELSE 7
                END,
                t.start_time ASC
        """)
        rows = [dict(r) for r in cursor.fetchall()]
        
        # Group by day
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        grouped = {d: [] for d in days}
        for r in rows:
            if r["day_of_week"] in grouped:
                grouped[r["day_of_week"]].append(r)
        return {"all_slots": rows, "grouped": grouped}

@app.post("/api/timetable")
def add_timetable_slot(req: TimetableSlotCreate, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester")
        if not req.subject_id:
            raise HTTPException(status_code=400, detail="subject_id is required")

        batch = (req.batch or "All").strip()

        # Prevent the exact same period being added twice (same day, start time,
        # subject, type and batch). Left unguarded, a double-click or a retried
        # request after a slow network response would silently create a duplicate
        # weekly slot - which then shows up as the same period repeating on every
        # occurrence of that weekday for the rest of the semester.
        cursor.execute("""
            SELECT id FROM timetable_slots
            WHERE semester_id = ? AND day_of_week = ? AND start_time = ?
              AND subject_id = ? AND slot_type = ? AND batch = ?
        """, (sem["id"], req.day_of_week, req.start_time.strip(), req.subject_id, req.slot_type, batch))
        if cursor.fetchone():
            raise HTTPException(
                status_code=409,
                detail="This exact period (subject, type, batch and start time) already exists on this day."
            )

        cursor.execute("""
            INSERT INTO timetable_slots (semester_id, day_of_week, start_time, end_time, subject_id, slot_type, batch)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (sem["id"], req.day_of_week, req.start_time.strip(), req.end_time.strip(), req.subject_id, req.slot_type, batch))
        return {"status": "success", "id": cursor.lastrowid}

@app.delete("/api/timetable/{slot_id}")
def delete_timetable_slot(slot_id: int, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM timetable_slots WHERE id = ?", (slot_id,))
        return {"status": "success"}

@app.put("/api/timetable/{slot_id}")
def update_timetable_slot(slot_id: int, req: TimetableSlotUpdate, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM timetable_slots WHERE id = ?", (slot_id,))
        current = cursor.fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Timetable slot not found")

        new_day = req.day_of_week.strip() if req.day_of_week is not None else current["day_of_week"]
        new_start = req.start_time.strip() if req.start_time is not None else current["start_time"]
        new_subject = req.subject_id if req.subject_id is not None else current["subject_id"]
        new_type = req.slot_type.strip() if req.slot_type is not None else current["slot_type"]
        new_batch = req.batch.strip() if req.batch is not None else current["batch"]

        # Same duplicate guard as creation: editing one slot must not make it collide
        # with a different, already-existing slot (same day/time/subject/type/batch).
        cursor.execute("""
            SELECT id FROM timetable_slots
            WHERE semester_id = ? AND day_of_week = ? AND start_time = ?
              AND subject_id = ? AND slot_type = ? AND batch = ? AND id != ?
        """, (current["semester_id"], new_day, new_start, new_subject, new_type, new_batch, slot_id))
        if cursor.fetchone():
            raise HTTPException(
                status_code=409,
                detail="Another period with this exact subject, type, batch and start time already exists on this day."
            )

        updates = []
        params = []
        if req.day_of_week is not None:
            updates.append("day_of_week = ?")
            params.append(new_day)
        if req.start_time is not None:
            updates.append("start_time = ?")
            params.append(new_start)
        if req.end_time is not None:
            updates.append("end_time = ?")
            params.append(req.end_time.strip())
        if req.subject_id is not None:
            updates.append("subject_id = ?")
            params.append(req.subject_id)
        if req.slot_type is not None:
            updates.append("slot_type = ?")
            params.append(new_type)
        if req.batch is not None:
            updates.append("batch = ?")
            params.append(new_batch)

        if updates:
            params.append(slot_id)
            cursor.execute(f"UPDATE timetable_slots SET {', '.join(updates)} WHERE id = ?", params)
        return {"status": "success"}

# ----------------- BATCH RANGES ----------------- #

@app.get("/api/batch-ranges")
def get_batch_ranges(user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT br.* FROM batch_ranges br
            JOIN semesters sem ON br.semester_id = sem.id
            WHERE sem.is_active = 1
            ORDER BY br.batch_name ASC
        """)
        return [dict(r) for r in cursor.fetchall()]

@app.post("/api/batch-ranges")
def save_batch_ranges(ranges: List[BatchRangeCreate], user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester")

        cursor.execute("DELETE FROM batch_ranges WHERE semester_id = ?", (sem["id"],))
        for r in ranges:
            cursor.execute("""
                INSERT INTO batch_ranges (semester_id, batch_name, start_reg_no, end_reg_no)
                VALUES (?, ?, ?, ?)
            """, (sem["id"], r.batch_name, r.start_reg_no.strip(), r.end_reg_no.strip()))
        return {"status": "success"}

# ----------------- STUDENTS ----------------- #

@app.get("/api/students")
def get_students(batch: Optional[str] = None, search: Optional[str] = None, month: Optional[str] = None, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            return []
        
        overview = calculate_class_overview(conn, sem["id"], month)
        students = overview["students"]

        if batch and batch != "All":
            students = [s for s in students if s["batch"] == batch]
        if search:
            q = search.lower().strip()
            students = [s for s in students if q in s["name"].lower() or q in s["reg_no"].lower()]

        return students

@app.post("/api/students")
def add_student(req: StudentCreate, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester")

        clean_reg = req.reg_no.strip()
        clean_cat = resolve_student_category(clean_reg, req.category)
        clean_email = req.email.strip() if req.email else f"{clean_reg}@andhrauniversity.edu.in"
        cursor.execute("SELECT lateral_joining_date FROM semesters WHERE id = ?", (sem["id"],))
        sem_date = cursor.fetchone()
        lateral_date = (sem_date["lateral_joining_date"] if sem_date and sem_date["lateral_joining_date"] else DEFAULT_LATERAL_JOINING_DATE)
        clean_jdate = lateral_date if clean_cat == "Lateral Entry" else None

        try:
            cursor.execute("""
                INSERT INTO students (reg_no, name, batch, mobile, email, category, admission_no, joining_date, semester_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                clean_reg,
                req.name.strip(),
                req.batch.strip(),
                req.mobile.strip(),
                clean_email,
                clean_cat,
                req.admission_no.strip() if req.admission_no else f"AUCE-CSE-2024-{clean_reg[-4:]}",
                clean_jdate,
                sem["id"]
            ))
            return {"status": "success", "id": cursor.lastrowid}
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail=f"Registration Number {req.reg_no} already exists.")

@app.put("/api/students/{student_id}")
def update_student(student_id: int, req: StudentUpdate, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, reg_no, semester_id FROM students WHERE id = ?", (student_id,))
        current = cursor.fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Student not found")
        updates = []
        params = []
        if req.name is not None:
            updates.append("name = ?")
            params.append(req.name.strip())
        if req.batch is not None:
            updates.append("batch = ?")
            params.append(req.batch.strip())
        if req.mobile is not None:
            updates.append("mobile = ?")
            params.append(req.mobile.strip())
        if req.email is not None:
            updates.append("email = ?")
            params.append(req.email.strip())
        is_lateral = False
        try:
            is_lateral = int(str(current["reg_no"])[-3:]) >= 125
        except Exception:
            pass
        if is_lateral:
            # 125+ is always Lateral Entry, but each lateral student may have
            # their own joining date because seats were allotted on different dates.
            updates.append("category = 'Lateral Entry'")
            if req.joining_date is not None:
                date_val = req.joining_date.strip()
                try:
                    datetime.strptime(date_val, "%Y-%m-%d")
                except Exception:
                    raise HTTPException(status_code=400, detail="Invalid joining date format, expected YYYY-MM-DD")
                updates.append("joining_date = ?")
                params.append(date_val)
            elif not current.get("joining_date"):
                cursor.execute("SELECT lateral_joining_date FROM semesters WHERE id = ?", (current["semester_id"],))
                sem_date = cursor.fetchone()
                lateral_date = (sem_date["lateral_joining_date"] if sem_date and sem_date["lateral_joining_date"] else DEFAULT_LATERAL_JOINING_DATE)
                updates.append("joining_date = ?")
                params.append(lateral_date)
        elif req.category is not None:
            updates.append("category = ?")
            params.append(req.category.strip())
        if req.admission_no is not None:
            updates.append("admission_no = ?")
            params.append(req.admission_no.strip())
        if req.joining_date is not None and not is_lateral:
            # Joining date is a centralized lateral-entry setting, not an individual
            # CR-editable field. Non-lateral records never use it for attendance.
            date_val = None
            updates.append("joining_date = ?")
            params.append(date_val)

        if updates:
            params.append(student_id)
            cursor.execute(f"UPDATE students SET {', '.join(updates)} WHERE id = ?", params)
        return {"status": "success"}

@app.put("/api/students/{student_id}/drop")
def drop_student(student_id: int, req: Optional[StudentDropRequest] = None, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        reason = "Left / Dropped from College"
        if req:
            reason = (req.dropped_reason or req.reason or "Left / Dropped from College").strip()
        drop_date = datetime.now().strftime("%Y-%m-%d")
        if req and (req.dropped_date or req.date):
            drop_date = (req.dropped_date or req.date).strip()
        cursor.execute("""
            UPDATE students 
            SET is_dropped = 1, dropped_reason = ?, dropped_date = ? 
            WHERE id = ?
        """, (reason, drop_date, student_id))
        return {"status": "success", "message": "Student marked as dropped successfully"}

@app.put("/api/students/{student_id}/restore")
def restore_student(student_id: int, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE students 
            SET is_dropped = 0, dropped_reason = NULL, dropped_date = NULL 
            WHERE id = ?
        """, (student_id,))
        return {"status": "success", "message": "Student restored to active roster"}

@app.put("/api/students/lateral-joining-date")
def update_lateral_joining_date(req: LateralJoiningDateUpdate, user: dict = Depends(require_staff)):
    date_val = req.joining_date.strip()
    try:
        datetime.strptime(date_val, "%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found")
        semester_id = sem["id"]
        cursor.execute("UPDATE semesters SET lateral_joining_date = ? WHERE id = ?", (date_val, semester_id))
        # Registration number is authoritative: 125+ are all lateral entries.
        cursor.execute("""
            UPDATE students
            SET category = 'Lateral Entry', joining_date = ?
            WHERE semester_id = ? AND CAST(substr(reg_no, -3) AS INTEGER) >= 125
        """, (date_val, semester_id))
        changed = cursor.rowcount
        return {
            "status": "success",
            "lateral_joining_date": date_val,
            "updated_students": changed,
            "message": f"Effective attendance start date for all {changed} Lateral Entry students updated to {date_val}"
        }

@app.post("/api/students/bulk-import")
def bulk_import_students(req: BulkStudentImportRequest, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found. Please complete Step 1 first.")
        sem_id = sem["id"]
        lateral_date_row = cursor.execute("SELECT lateral_joining_date FROM semesters WHERE id = ?", (sem_id,)).fetchone()
        lateral_date = (lateral_date_row["lateral_joining_date"] if lateral_date_row and lateral_date_row["lateral_joining_date"] else DEFAULT_LATERAL_JOINING_DATE)

        # Fetch batch ranges for auto-assigning batches
        cursor.execute("SELECT * FROM batch_ranges WHERE semester_id = ?", (sem_id,))
        ranges = [dict(r) for r in cursor.fetchall()]

        inserted = 0
        for s in req.students:
            clean_reg = s.reg_no.strip()
            clean_name = s.name.strip()
            clean_batch = resolve_batch_for_reg(clean_reg, ranges, s.batch.strip() if s.batch else "")
            clean_mobile = s.mobile.strip() if s.mobile else ""
            clean_cat = resolve_student_category(clean_reg, s.category)
            clean_email = s.email.strip() if s.email else f"{clean_reg}@andhrauniversity.edu.in"
            clean_adm = s.admission_no.strip() if s.admission_no else f"AUCE-CSE-2024-{clean_reg[-4:]}"
            clean_jdate = lateral_date if clean_cat == "Lateral Entry" else None

            cursor.execute("""
                INSERT INTO students (reg_no, name, batch, mobile, email, category, admission_no, joining_date, semester_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(reg_no, semester_id) DO UPDATE SET
                    name = excluded.name,
                    batch = excluded.batch,
                    mobile = excluded.mobile,
                    email = excluded.email,
                    category = excluded.category,
                    admission_no = excluded.admission_no,
                    joining_date = excluded.joining_date
            """, (clean_reg, clean_name, clean_batch, clean_mobile, clean_email, clean_cat, clean_adm, clean_jdate, sem_id))
            inserted += 1

        return {
            "status": "success",
            "inserted_count": inserted
        }

def _parse_tabular_roster(raw_text: str, ranges: list):
    """
    Handles a straight copy-paste of a spreadsheet column block, e.g.
        Name of the Candidate <TAB> Registration Number <TAB> Mobile Number <TAB> Admn.No <TAB> Email Address <TAB> Category of admission
        Example Student       <TAB> 999999000001         <TAB> 9000000001   <TAB>          <TAB> student@example.edu <TAB> Convener (EAPCET)
    Splitting on a single delimiter char (never collapsing repeats) keeps blank cells in their
    real position, and header names are matched by keyword so any column order works; without a
    header row it falls back to the department's standard export order. Returns None (so the
    caller falls back to the free-text heuristic below) if the pasted text doesn't look tabular
    at all - i.e. no line contains a tab or at least 2 commas.
    """
    import re as _re
    lines = [l for l in raw_text.replace('\r', '').split('\n') if l.strip() != '']
    if not lines:
        return None

    has_tabs = any('\t' in l for l in lines)
    has_commas = any(l.count(',') >= 2 for l in lines)
    if not has_tabs and not has_commas:
        return None  # looks like free-text notes, not a pasted table

    delimiter = '\t' if has_tabs else ','
    rows = [l.split(delimiter) for l in lines]
    rows = [[c.strip() for c in row] for row in rows]

    header_patterns = {
        'name': ['name of the candidate', 'candidate name', 'student name', 'full name', 'name'],
        'reg_no': ['registration number', 'reg. no', 'reg no', 'regno', 'reg.no', 'register no', 'roll number', 'roll no'],
        'mobile': ['mobile number', 'mobile no', 'mobile', 'phone number', 'phone', 'contact number', 'contact'],
        'admission_no': ['admn.no', 'admn no', 'admission number', 'admission no', 'adm no', 'admno'],
        'email': ['email address', 'e-mail', 'email'],
        'category': ['category of admission', 'admission category', 'category', 'quota'],
    }

    def detect_header(cells):
        found = {}
        for idx, cell in enumerate(cells):
            norm = _re.sub(r'\s+', ' ', cell.lower()).strip()
            if not norm:
                continue
            for field, patterns in header_patterns.items():
                if field in found:
                    continue
                if any(p in norm for p in patterns):
                    found[field] = idx
                    break
        if len(found) >= 2 and ('name' in found or 'reg_no' in found):
            return found
        return None

    column_map = detect_header(rows[0])
    if column_map:
        rows = rows[1:]
    else:
        column_map = {f: i for i, f in enumerate(['name', 'reg_no', 'mobile', 'admission_no', 'email', 'category'])}

    def get(cells, field):
        idx = column_map.get(field)
        if idx is None or idx >= len(cells):
            return ''
        return (cells[idx] or '').strip()

    parsed = []
    skipped = []
    for row_idx, cells in enumerate(rows):
        if all(not c for c in cells):
            continue
        name = get(cells, 'name')[:100]
        reg_raw = get(cells, 'reg_no')
        reg_no = _re.sub(r'\D', '', reg_raw)
        mobile = get(cells, 'mobile')
        admission_no = get(cells, 'admission_no')
        email = get(cells, 'email')
        category_raw = get(cells, 'category')

        row_label = f"Row {row_idx + 1}" + (f" ({name})" if name else f" ({reg_raw})" if reg_raw else "")
        if len(reg_no) != 12:
            skipped.append(f"{row_label}: registration number must be 12 digits")
            continue
        if not name:
            skipped.append(f"{row_label}: name is blank")
            continue

        batch = resolve_batch_for_reg(reg_no, ranges)
        category = resolve_student_category(reg_no, category_raw)
        joining_date = "2026-08-02" if category == "Lateral Entry" else None

        parsed.append({
            "reg_no": reg_no,
            "name": name,
            "batch": batch,
            "mobile": mobile,
            "email": email or f"{reg_no}@andhrauniversity.edu.in",
            "category": category,
            "admission_no": admission_no or f"AUCE-CSE-2024-{reg_no[-4:]}",
            "joining_date": joining_date
        })

    return {"records": parsed, "skipped": skipped}


@app.post("/api/students/smart-import")
def smart_import_students(req: SmartImportRequest, user: dict = Depends(get_current_user)):
    """
    Universal Paste / Smart Bulk Student Ingestion.
    Two parsing strategies, tried in order:
    1. Tabular: a straight copy-paste of spreadsheet columns (tab- or comma-separated), with
       or without a header row, in any column order. Preserves blank cells correctly instead
       of letting them shift later columns out of position.
    2. Free-text: one student per line in unstructured notes (e.g. pasted from WhatsApp),
       where a 12-digit reg no, email, phone, and batch marker are pulled out by pattern and
       whatever's left over becomes the name.
    Detects duplicates with overwrite_existing or skip policy.
    """
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")

    raw_text = req.raw_text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Paste content cannot be empty.")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found.")
        sem_id = sem["id"]
        lateral_date_row = cursor.execute("SELECT lateral_joining_date FROM semesters WHERE id = ?", (sem_id,)).fetchone()
        lateral_date = (lateral_date_row["lateral_joining_date"] if lateral_date_row and lateral_date_row["lateral_joining_date"] else DEFAULT_LATERAL_JOINING_DATE)

        # Fetch batch ranges
        cursor.execute("SELECT * FROM batch_ranges WHERE semester_id = ?", (sem_id,))
        ranges = [dict(r) for r in cursor.fetchall()]

        import re

        tabular = _parse_tabular_roster(raw_text, ranges)
        skipped_rows_detail = []
        if tabular and tabular["records"]:
            parsed_records = tabular["records"]
            skipped_rows_detail = tabular["skipped"]
        else:
            lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
            parsed_records = []

            for line in lines:
                reg_match = re.search(r'\b(\d{12})\b', line)
                if not reg_match:
                    continue
                reg_no = reg_match.group(1)

                email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', line)
                email = email_match.group(0) if email_match else f"{reg_no}@andhrauniversity.edu.in"

                mobile_match = re.search(r'\b([6-9]\d{9})\b', line)
                mobile = mobile_match.group(1) if mobile_match else ""

                batch_match = re.search(r'\b(?:batch|b)\s*[-:]?\s*([1-3])\b', line, re.IGNORECASE)
                batch = f"Batch {batch_match.group(1)}" if batch_match else resolve_batch_for_reg(reg_no, ranges)

                category = resolve_student_category(reg_no)

                rem = line
                rem = rem.replace(reg_no, " ")
                if email_match:
                    rem = rem.replace(email_match.group(0), " ")
                if mobile_match:
                    rem = rem.replace(mobile_match.group(0), " ")
                if batch_match:
                    rem = re.sub(r'\b(?:batch|b)\s*[-:]?\s*[1-3]\b', ' ', rem, flags=re.IGNORECASE)
                rem = re.sub(r'[,;\t|\-\(\)\[\]]+', ' ', rem)
                rem = re.sub(r'\s+', ' ', rem).strip()
                name = rem if len(rem) >= 2 else f"Student {reg_no[-3:]}"

                joining_date = "2026-08-02" if category == "Lateral Entry" else None
                admission_no = f"AUCE-CSE-2024-{reg_no[-4:]}"

                parsed_records.append({
                    "reg_no": reg_no,
                    "name": name,
                    "batch": batch,
                    "mobile": mobile,
                    "email": email,
                    "category": category,
                    "admission_no": admission_no,
                    "joining_date": joining_date
                })

        if not parsed_records:
            raise HTTPException(status_code=400, detail="Could not identify any 12-digit student registration numbers from the pasted text.")

        added_count = 0
        updated_count = 0
        skipped_count = 0

        for p in parsed_records:
            if p["category"] == "Lateral Entry":
                # Imported 125+ students inherit the active semester default.
                # Individual dates can still be edited afterward by CR/LR.
                p["joining_date"] = lateral_date
            cursor.execute("SELECT id FROM students WHERE reg_no = ? AND semester_id = ?", (p["reg_no"], sem_id))
            existing = cursor.fetchone()
            if existing:
                if req.overwrite_existing:
                    cursor.execute("""
                        UPDATE students
                        SET name = ?, batch = ?, mobile = COALESCE(NULLIF(?, ''), mobile),
                            email = ?, category = ?, joining_date = COALESCE(?, joining_date)
                        WHERE id = ?
                    """, (p["name"], p["batch"], p["mobile"], p["email"], p["category"], p["joining_date"], existing["id"]))
                    updated_count += 1
                else:
                    skipped_count += 1
            else:
                cursor.execute("""
                    INSERT INTO students (reg_no, name, batch, mobile, email, category, admission_no, joining_date, semester_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (p["reg_no"], p["name"], p["batch"], p["mobile"], p["email"], p["category"], p["admission_no"], p["joining_date"], sem_id))
                added_count += 1

        message = f"Smart import completed: {added_count} added, {updated_count} updated, {skipped_count} already existed."
        if skipped_rows_detail:
            message += f" {len(skipped_rows_detail)} row(s) in the pasted text couldn't be read."

        return {
            "status": "success",
            "message": message,
            "added": added_count,
            "updated": updated_count,
            "skipped": skipped_count,
            "total_found": len(parsed_records),
            "unparsed_rows": skipped_rows_detail
        }

# ----------------- DATABASE BACKUP & RESTORE ----------------- #

@app.get("/api/backup/download-db")
def download_database_backup(background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Download a transaction-consistent SQLite snapshot of the live database.

    The application runs SQLite in WAL mode, so returning the live .db file directly
    can omit committed pages that are still in the -wal file. SQLite's backup API
    folds the complete live database state into a standalone snapshot first.
    """
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    from app.database import DB_PATH, get_db_connection
    import tempfile
    source = Path(DB_PATH)
    if not source.exists():
        raise HTTPException(status_code=404, detail="Database file not found")

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    fd, temp_name = tempfile.mkstemp(prefix=f"attendance_auce_cse_{stamp}_", suffix=".db")
    os.close(fd)
    snapshot = Path(temp_name)
    try:
        src = get_db_connection()
        try:
            dst = sqlite3.connect(str(snapshot))
            try:
                src.backup(dst)
                dst.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                dst.commit()
            finally:
                dst.close()
        finally:
            src.close()
    except Exception:
        try:
            snapshot.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Could not create a consistent database backup.")

    background_tasks.add_task(lambda p: Path(p).unlink(missing_ok=True), str(snapshot))
    return FileResponse(
        path=str(snapshot),
        filename=f"attendance_auce_cse_{stamp}.db",
        media_type="application/octet-stream"
    )

@app.get("/api/backup/download-json")
def download_json_backup(user: dict = Depends(get_current_user)):
    """Export every application table from one live SQLite snapshot.

    This deliberately discovers tables from sqlite_master instead of maintaining a
    hand-written list, so newly added portal data (email dispatch logs, custom-day
    override metadata, etc.) is not silently omitted from backups. SQLite's internal
    sqlite_sequence table is excluded because it is derived metadata, not application data.
    """
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        tables = [row["name"] for row in cursor.fetchall()]
        backup_data = {"backup_version": 2, "exported_at": datetime.now().isoformat(), "tables": {}, "table_counts": {}}
        for table in tables:
            cursor.execute(f'SELECT * FROM "{table.replace(chr(34), chr(34)*2)}"')
            backup_data["tables"][table] = [dict(r) for r in cursor.fetchall()]
            backup_data["table_counts"][table] = len(backup_data["tables"][table])

    return JSONResponse(
        content=backup_data,
        headers={
            "Content-Disposition": f"attachment; filename=attendance_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        }
    )


@app.post("/api/backup/restore")
def restore_json_backup(payload: dict, user: dict = Depends(get_current_user)):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")
    tables_data = payload.get("tables")
    if not isinstance(tables_data, dict):
        raise HTTPException(status_code=400, detail="Invalid backup JSON format: 'tables' dictionary required.")
    version = int(payload.get("backup_version") or 1)
    if version not in [1, 2]:
        raise HTTPException(status_code=400, detail="Unsupported backup version.")
    expected_counts = payload.get("table_counts") or {}
    if isinstance(expected_counts, dict):
        for table_name, expected in expected_counts.items():
            if table_name in tables_data and isinstance(expected, int):
                actual = len(tables_data[table_name]) if isinstance(tables_data[table_name], list) else -1
                if actual != expected:
                    raise HTTPException(status_code=400, detail=f"Backup count mismatch for table '{table_name}'.")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        allowed = {row["name"] for row in cursor.fetchall()}
        requested = [t for t in tables_data if t in allowed and isinstance(tables_data[t], list)]
        if not requested:
            raise HTTPException(status_code=400, detail="Backup contains no restorable application tables.")

        # A restore is intentionally all-or-nothing. Temporarily disabling FK checks
        # lets us clear and repopulate the snapshot even when child tables appear before
        # their parents in a future backup. The connection is rolled back on any error.
        conn.execute("PRAGMA foreign_keys = OFF")
        try:
            # Child records first, then parents, so ordinary FK-enabled databases remain
            # valid immediately after the restore.
            delete_order = [
                "attendance_records", "attendance_audit_logs", "attendance_sessions",
                "custom_day_overrides", "student_form_responses", "student_requests",
                "password_reset_requests", "email_dispatch_log", "email_dispatch_runs",
                "student_forms", "students", "batch_ranges", "timetable_slots",
                "subjects", "holidays", "admin_accounts", "semesters"
            ]
            for table in delete_order:
                if table in allowed and table in requested:
                    cursor.execute(f'DELETE FROM "{table.replace(chr(34), chr(34)*2)}"')

            for table in requested:
                rows = tables_data[table]
                if not rows:
                    continue
                for row in rows:
                    if not isinstance(row, dict) or not row:
                        continue
                    cols = [c for c in row.keys() if isinstance(c, str)]
                    if not cols:
                        continue
                    quoted_cols = ', '.join(f'"{c.replace(chr(34), chr(34)*2)}"' for c in cols)
                    placeholders = ', '.join('?' for _ in cols)
                    vals = [row[c] for c in cols]
                    cursor.execute(f'INSERT OR REPLACE INTO "{table.replace(chr(34), chr(34)*2)}" ({quoted_cols}) VALUES ({placeholders})', vals)
            conn.commit()
        except Exception as exc:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Database restore failed; no changes were kept: {exc}")
        finally:
            conn.execute("PRAGMA foreign_keys = ON")

    return {"status": "success", "message": "Database successfully restored from backup.", "backup_version": version}

# ----------------- STUDENT DASHBOARD ----------------- #

@app.get("/api/student/dashboard")
def get_student_dashboard(reg_no: Optional[str] = None, month: Optional[str] = None, user: dict = Depends(get_current_user)):
    target_reg = reg_no if (user.get("role") in ["cr", "lr"] and reg_no) else user.get("sub")
    if not target_reg:
        raise HTTPException(status_code=400, detail="Student registration number missing")

    with get_db() as conn:
        cursor = conn.cursor()
        # Registration numbers may exist in archived semesters. The student portal must
        # always resolve the active semester first, otherwise an archive can leak into
        # the current student's month/attendance view.
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        active_sem = cursor.fetchone()
        if not active_sem:
            raise HTTPException(status_code=404, detail="No active semester configured")
        cursor.execute("SELECT * FROM students WHERE reg_no = ? AND semester_id = ?", (target_reg, active_sem["id"]))
        student = cursor.fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found in the active semester")
        return calculate_student_attendance(conn, student["id"], month)

# ----------------- ATTENDANCE MARKING & OVERVIEW ----------------- #

@app.get("/api/attendance/overview")
def get_attendance_overview(month: Optional[str] = None, user: dict = Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, active_month FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            return {"class_average": 0, "total_students": 0, "students": []}

        effective_month = month or sem["active_month"]
        return calculate_class_overview(conn, sem["id"], effective_month)

@app.get("/api/attendance/statistics")
def get_class_statistics(month: Optional[str] = None, user: dict = Depends(require_staff)):
    """
    Returns deep class statistics:
    - Overall class attendance %
    - Subject-wise class attendance %
    - Category-wise breakdown (EAPCET, Foreigners, Sweden batch, Lateral Entry)
    - Batch-wise breakdown (Batch 1, 2, 3)
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, active_month FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=404, detail="No active semester found")

        effective_month = month or sem["active_month"]
        return calculate_class_statistics(conn, sem["id"], effective_month)

@app.get("/api/attendance/slots-for-date")
def get_slots_for_date(date: str, user: dict = Depends(require_staff)):
    """Return the effective schedule for a date, respecting a real empty custom override."""
    try:
        dt = datetime.strptime(date, "%Y-%m-%d")
        day_name = dt.strftime("%A")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    def norm_time(value):
        return " ".join(str(value or "").strip().upper().replace(".", ":").split())

    def time_to_minutes(value):
        text = norm_time(value)
        m = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM)$", text)
        if m:
            h = int(m.group(1)) % 12
            if m.group(3) == "PM":
                h += 12
            return h * 60 + int(m.group(2))
        m = re.match(r"^(\d{1,2}):(\d{2})", text)
        return int(m.group(1)) * 60 + int(m.group(2)) if m else 24 * 60

    def logical_key(item):
        return (
            item.get("subject_id"),
            (item.get("slot_type") or "Theory").strip(),
            (item.get("batch") or "All").strip(),
            norm_time(item.get("start_time")),
            norm_time(item.get("end_time")),
        )

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            return {"day_name": day_name, "slots": [], "is_holiday": False, "holiday_info": None}
        semester_id = sem["id"]

        cursor.execute("SELECT * FROM holidays WHERE semester_id = ? AND date = ?", (semester_id, date))
        holiday = cursor.fetchone()

        cursor.execute("SELECT * FROM custom_day_overrides WHERE semester_id = ? AND date = ? LIMIT 1", (semester_id, date))
        override = cursor.fetchone()

        cursor.execute("""
            SELECT t.*, s.name AS subject_name, s.code AS subject_code, s.faculty_name
            FROM timetable_slots t
            JOIN subjects s ON t.subject_id = s.id
            WHERE t.semester_id = ? AND t.day_of_week = ?
            ORDER BY t.start_time ASC, t.id ASC
        """, (semester_id, day_name))
        weekly = [dict(r) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT a.id AS session_id, a.slot_id, a.subject_id, a.slot_type, a.batch,
                   a.is_cancelled, a.cancellation_reason, a.is_extra, a.is_custom_day,
                   a.start_time, a.end_time, a.marked_by, a.created_at,
                   sub.name AS subject_name, sub.code AS subject_code, sub.faculty_name,
                   COUNT(r.id) AS total_marked,
                   SUM(CASE WHEN r.status = 'Absent' THEN 1 ELSE 0 END) AS absent_count,
                   SUM(CASE WHEN r.status = 'Present' THEN 1 ELSE 0 END) AS present_count
            FROM attendance_sessions a
            JOIN subjects sub ON a.subject_id = sub.id
            LEFT JOIN attendance_records r ON r.session_id = a.id
            WHERE a.date = ? AND sub.semester_id = ?
            GROUP BY a.id
            ORDER BY a.id ASC
        """, (date, semester_id))
        sessions = [dict(r) for r in cursor.fetchall()]

        custom_sessions = [x for x in sessions if x.get("is_custom_day")]
        extra_sessions = [x for x in sessions if x.get("is_extra") and not x.get("is_custom_day")]
        orphan_sessions = [x for x in sessions if not x.get("slot_id") and not x.get("is_custom_day") and not x.get("is_extra")]

        def card(sess, custom=False, extra=False):
            return {
                "id": sess.get("slot_id"),
                "session_id": sess.get("session_id"),
                "semester_id": semester_id,
                "day_of_week": day_name,
                "start_time": sess.get("start_time") or "03:30 PM",
                "end_time": sess.get("end_time") or "05:10 PM",
                "subject_id": sess["subject_id"],
                "subject_name": sess["subject_name"],
                "subject_code": sess["subject_code"],
                "faculty_name": sess["faculty_name"],
                "slot_type": sess["slot_type"],
                "batch": sess["batch"],
                "is_extra": extra,
                "is_custom_day": custom,
                "is_cancelled": bool(sess.get("is_cancelled")),
                "cancellation_reason": sess.get("cancellation_reason"),
                "is_marked": not bool(sess.get("is_cancelled")) and (sess.get("total_marked") or 0) > 0,
                "marked_by": sess.get("marked_by") or "CR",
                "session_info": sess,
            }

        slots = []
        if override or custom_sessions:
            # A custom-day override replaces the weekly schedule completely, including
            # the valid case where the CR intentionally saved ZERO periods. Marked weekly
            # sessions are the one safety exception: never hide real attendance history.
            slots.extend(card(x, custom=True) for x in custom_sessions)
            visible_keys = {logical_key(x) for x in slots}
            for raw in weekly:
                sess = next((x for x in sessions if x.get("slot_id") == raw["id"]), None)
                if sess and (sess.get("total_marked") or 0) > 0 and not sess.get("is_cancelled"):
                    c = dict(raw)
                    c.update({
                        "session_id": sess["session_id"],
                        "is_extra": False, "is_custom_day": False,
                        "is_cancelled": False,
                        "cancellation_reason": None,
                        "is_marked": True,
                        "marked_by": sess.get("marked_by") or "CR",
                        "session_info": sess,
                    })
                    if logical_key(c) not in visible_keys:
                        slots.append(c)
                        visible_keys.add(logical_key(c))
            for x in extra_sessions + orphan_sessions:
                c = card(x, extra=bool(x.get("is_extra")))
                if logical_key(c) not in visible_keys:
                    slots.append(c)
                    visible_keys.add(logical_key(c))
        else:
            # If multiple legacy session rows exist for one weekly slot, prefer a marked
            # row and then the newest row. This keeps one clickable card per real period.
            session_by_slot = {}
            for x in sessions:
                sid = x.get("slot_id")
                if not sid:
                    continue
                prev = session_by_slot.get(sid)
                if prev is None or ((x.get("total_marked") or 0) > 0 and (prev.get("total_marked") or 0) == 0) or x["session_id"] > prev["session_id"]:
                    session_by_slot[sid] = x

            for raw in weekly:
                slot = dict(raw)
                slot.update({"is_extra": False, "is_custom_day": False})
                sess = session_by_slot.get(slot["id"])
                if sess:
                    slot.update({
                        "session_id": sess["session_id"],
                        "is_cancelled": bool(sess.get("is_cancelled")),
                        "cancellation_reason": sess.get("cancellation_reason"),
                        "is_marked": not bool(sess.get("is_cancelled")) and (sess.get("total_marked") or 0) > 0,
                        "marked_by": sess.get("marked_by") or "CR",
                        "session_info": sess,
                    })
                else:
                    slot.update({"session_id": None, "is_marked": False, "is_cancelled": False,
                                 "cancellation_reason": None, "marked_by": None, "session_info": None})
                slots.append(slot)
            slots.extend(card(x, extra=bool(x.get("is_extra"))) for x in extra_sessions + orphan_sessions)

        # Final read-time safety net for old databases containing exact duplicate timed
        # sessions. No database rows are deleted here.
        deduped = {}
        for slot in slots:
            k = logical_key(slot)
            prev = deduped.get(k)
            if prev is None or (slot.get("is_marked") and not prev.get("is_marked")) or (
                slot.get("session_id") and prev.get("session_id") and slot["session_id"] < prev["session_id"]
            ):
                deduped[k] = slot
        slots = list(deduped.values())
        slots.sort(key=lambda x: (time_to_minutes(x.get("start_time")), x.get("subject_name") or "", x.get("session_id") or x.get("id") or 0))

        is_upcoming = date > now_ist().strftime("%Y-%m-%d")
        for slot in slots:
            slot["is_upcoming"] = is_upcoming
            if slot.get("session_id") and slot.get("is_marked"):
                cursor.execute("SELECT student_id FROM attendance_records WHERE session_id = ? AND status = 'Absent'", (slot["session_id"],))
                slot["absent_student_ids"] = [r["student_id"] for r in cursor.fetchall()]
            else:
                slot["absent_student_ids"] = []

        return {
            "date": date,
            "day_name": day_name,
            "is_holiday": holiday is not None,
            "holiday_info": dict(holiday) if holiday else None,
            "has_custom_day": bool(override or custom_sessions),
            "is_upcoming": is_upcoming,
            "slots": slots,
        }

@app.post("/api/attendance/custom-day-slots")
def save_custom_day_slots(req: CustomDayTimetableRequest, authorization: Optional[str] = Header(None), user: dict = Depends(require_staff)):
    """Save a complete one-day override; an empty list means intentionally no classes."""
    marked_by_name = resolve_marked_by(authorization)
    try:
        dt = datetime.strptime(req.date, "%Y-%m-%d")
        day_name = dt.strftime("%A")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found.")
        semester_id = sem["id"]

        cursor.execute("SELECT id FROM holidays WHERE semester_id = ? AND date = ?", (semester_id, req.date))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Cannot configure classes on a declared holiday.")

        def nt(v):
            return " ".join(str(v or "").strip().upper().replace(".", ":").split())

        def ident(subject_id, slot_type, batch, start, end=None):
            return (int(subject_id), (slot_type or "Theory").strip(), (batch or "All").strip(), nt(start), nt(end) if end is not None else "")

        requested = []
        seen = set()
        for slot in req.slots or []:
            cursor.execute("SELECT id FROM subjects WHERE id = ? AND semester_id = ?", (slot.subject_id, semester_id))
            if not cursor.fetchone():
                raise HTTPException(status_code=400, detail="Custom schedule contains a subject outside the active semester.")
            st = (slot.slot_type or "Theory").strip()
            batch = (slot.batch or "All").strip()
            if st == "Lab" and batch == "All":
                raise HTTPException(status_code=400, detail="Every Lab custom slot must specify one concrete batch.")
            if st == "Theory" and batch != "All":
                raise HTTPException(status_code=400, detail="Theory custom slots must target All students.")
            start = str(slot.start_time or "").strip()
            end = str(slot.end_time or "").strip()
            if not start or not end:
                raise HTTPException(status_code=400, detail="Every custom period needs start and end time.")
            if nt(start) == nt(end):
                raise HTTPException(status_code=400, detail="A period cannot have the same start and end time.")
            k = ident(slot.subject_id, st, batch, start, end)
            if k in seen:
                raise HTTPException(status_code=400, detail=f"The same custom period was added twice at {start}.")
            seen.add(k)
            requested.append({"subject_id": int(slot.subject_id), "slot_type": st, "batch": batch, "start_time": start, "end_time": end, "key": k})

        # Ensure an explicit override marker exists even when the CR intentionally saves
        # zero periods. This is what makes "delete every class for this date" persistent.
        cursor.execute("""
            INSERT INTO custom_day_overrides(semester_id, date, marked_by)
            VALUES (?, ?, ?)
            ON CONFLICT(semester_id, date) DO UPDATE SET marked_by = excluded.marked_by
        """, (semester_id, req.date, marked_by_name))

        cursor.execute("""
            SELECT a.id, a.slot_id, a.subject_id, a.slot_type, a.batch, a.start_time, a.end_time,
                   a.is_cancelled,
                   EXISTS(SELECT 1 FROM attendance_records r WHERE r.session_id = a.id) AS has_attendance
            FROM attendance_sessions a
            WHERE a.date = ? AND a.is_custom_day = 1
            ORDER BY a.id
        """, (req.date,))
        existing_custom = [dict(r) for r in cursor.fetchall()]
        existing_custom_map = {}
        for row in existing_custom:
            existing_custom_map.setdefault(ident(row["subject_id"], row["slot_type"], row["batch"], row["start_time"], row["end_time"]), []).append(row)

        cursor.execute("""
            SELECT t.id, t.subject_id, t.start_time, t.end_time, t.slot_type, t.batch,
                   a.id AS session_id,
                   EXISTS(SELECT 1 FROM attendance_records r WHERE r.session_id = a.id) AS has_attendance,
                   COALESCE(a.is_cancelled, 0) AS is_cancelled
            FROM timetable_slots t
            LEFT JOIN attendance_sessions a ON a.slot_id = t.id AND a.date = ?
            WHERE t.semester_id = ? AND t.day_of_week = ?
            ORDER BY t.start_time, t.id
        """, (req.date, semester_id, day_name))
        weekly_rows = [dict(r) for r in cursor.fetchall()]
        weekly_by_key = {}
        for row in weekly_rows:
            key = ident(row["subject_id"], row["slot_type"], row["batch"], row["start_time"], row["end_time"])
            weekly_by_key.setdefault(key, []).append(row)

        requested_keys = {x["key"] for x in requested}
        protected_custom = [r for r in existing_custom if r["has_attendance"]]
        missing_custom = [r for r in protected_custom if ident(r["subject_id"], r["slot_type"], r["batch"], r["start_time"], r["end_time"]) not in requested_keys]
        if missing_custom:
            raise HTTPException(status_code=409, detail="A custom period with attendance already marked cannot be deleted. Edit its attendance first.")

        # A marked weekly session must remain in the effective override if it is omitted;
        # otherwise its attendance would become unreachable from the date's schedule.
        protected_weekly = []
        for row in weekly_rows:
            if row["session_id"] and row["has_attendance"]:
                key = ident(row["subject_id"], row["slot_type"], row["batch"], row["start_time"], row["end_time"])
                if key not in requested_keys:
                    protected_weekly.append(row)
        if protected_weekly:
            raise HTTPException(status_code=409, detail="A class with attendance already marked cannot be removed from this day's override. Keep the marked period or edit its attendance first.")

        used_custom = set()
        ids = []
        for item in requested:
            match = next((r for r in existing_custom_map.get(item["key"], []) if r["id"] not in used_custom), None)
            if match:
                used_custom.add(match["id"])
                ids.append(match["id"])
                if not match["has_attendance"]:
                    cursor.execute("""
                        UPDATE attendance_sessions
                        SET subject_id=?, slot_type=?, batch=?, month=?, day_of_week=?,
                            start_time=?, end_time=?, marked_by=?, is_cancelled=0,
                            cancellation_reason=NULL, is_custom_day=1, is_extra=0
                        WHERE id=?
                    """, (item["subject_id"], item["slot_type"], item["batch"], req.date[:7], day_name,
                          item["start_time"], item["end_time"], marked_by_name, match["id"]))
                continue

            # Reuse the attendance session already attached to the weekly slot when one
            # exists. This prevents a marked class from being duplicated into a second
            # custom session merely because the CR opened the custom editor.
            weekly_match = next((r for r in weekly_by_key.get(item["key"], []) if r.get("session_id")), None)
            if weekly_match:
                sid = weekly_match["session_id"]
                cursor.execute("""
                    UPDATE attendance_sessions
                    SET start_time=?, end_time=?, marked_by=?, is_custom_day=1,
                        is_extra=0, is_cancelled=0, cancellation_reason=NULL
                    WHERE id=?
                """, (item["start_time"], item["end_time"], marked_by_name, sid))
                ids.append(sid)
            else:
                cursor.execute("""
                    INSERT INTO attendance_sessions
                    (slot_id, subject_id, date, day_of_week, slot_type, batch, month,
                     marked_by, is_cancelled, is_custom_day, is_extra, start_time, end_time)
                    VALUES (NULL,?,?,?,?,?,?,?,0,1,0,?,?)
                """, (item["subject_id"], req.date, day_name, item["slot_type"], item["batch"], req.date[:7],
                      marked_by_name, item["start_time"], item["end_time"]))
                ids.append(cursor.lastrowid)

        for row in existing_custom:
            if row["id"] not in used_custom and not row["has_attendance"]:
                cursor.execute("DELETE FROM attendance_sessions WHERE id = ?", (row["id"],))

        return {
            "status": "success",
            "message": f"Custom timetable applied for {req.date}; {len(requested)} period(s) retained.",
            "session_ids": ids,
            "has_custom_day": True,
        }

@app.post("/api/attendance/extra-class")
def add_extra_class(req: ExtraClassCreate, authorization: Optional[str] = Header(None), user: dict = Depends(require_staff)):
    """
    Allows CR to add an extra class on any particular date.
    Creates an ad-hoc attendance session that appears immediately for marking.
    """
    marked_by_name = resolve_marked_by(authorization)
    try:
        dt = datetime.strptime(req.date, "%Y-%m-%d")
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        day_name = day_names[dt.weekday()]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    month = req.date[:7]
    with get_db() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found.")

        cursor.execute(
            "SELECT id FROM holidays WHERE semester_id = ? AND date = ?",
            (sem["id"], req.date)
        )
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Cannot schedule an extra class on a declared holiday.")

        cursor.execute(
            "SELECT id FROM subjects WHERE id = ? AND semester_id = ?",
            (req.subject_id, sem["id"])
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=400, detail="Invalid subject for the active semester.")

        batch = (req.batch or "All").strip()
        if req.slot_type == "Lab" and batch == "All":
            raise HTTPException(status_code=400, detail="Extra Lab classes must specify one concrete batch.")
        if req.slot_type == "Theory" and batch != "All":
            raise HTTPException(status_code=400, detail="Extra Theory classes must target All students.")
        cursor.execute("""
            INSERT INTO attendance_sessions (
                slot_id, subject_id, date, day_of_week, slot_type, batch, month,
                marked_by, is_cancelled, cancellation_reason, is_extra, start_time, end_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?, ?)
        """, (
            None, req.subject_id, req.date, day_name, req.slot_type, req.batch, month,
            marked_by_name, req.start_time.strip(), req.end_time.strip()
        ))
        session_id = cursor.lastrowid
        return {
            "status": "success",
            "session_id": session_id,
            "message": f"Extra class scheduled for {req.date} ({req.start_time} - {req.end_time})"
        }

@app.get("/api/attendance/eligible-students")
def get_eligible_students(batch: str = "All", user: dict = Depends(require_staff)):
    """
    Returns only active students from the active semester.
    Batch filtering is enforced server-side.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            return []

        if batch != "All":
            cursor.execute("""
                SELECT id, reg_no, name, batch, mobile, email, category, admission_no, joining_date
                FROM students
                WHERE semester_id = ?
                  AND batch = ?
                  AND (is_dropped IS NULL OR is_dropped = 0)
                ORDER BY reg_no ASC
            """, (sem["id"], batch))
        else:
            cursor.execute("""
                SELECT id, reg_no, name, batch, mobile, email, category, admission_no, joining_date
                FROM students
                WHERE semester_id = ?
                  AND (is_dropped IS NULL OR is_dropped = 0)
                ORDER BY reg_no ASC
            """, (sem["id"],))

        result = []
        for r in cursor.fetchall():
            d = dict(r)
            d["reg_no_last3"] = d["reg_no"][-3:] if len(d["reg_no"]) >= 3 else d["reg_no"]
            result.append(d)
        return result

@app.post("/api/attendance/mark")
def mark_attendance(req: AttendanceMarkRequest, authorization: Optional[str] = Header(None), user: dict = Depends(require_staff)):
    """
    Record attendance for exactly one timetable slot (or one extra/custom session).

    The server derives and validates the slot's subject/type/batch.  The browser
    cannot switch a Lab session to another batch by changing request data.
    """
    try:
        requested_date = datetime.strptime(req.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected YYYY-MM-DD.")

    today_str = now_ist().strftime("%Y-%m-%d")
    if req.date > today_str:
        raise HTTPException(status_code=400, detail="Cannot mark attendance for a future date.")

    marked_by_name = resolve_marked_by(authorization)

    with get_db() as conn:
        cursor = conn.cursor()

        # A holiday is a hard attendance boundary. No attendance can be created
        # on a declared holiday.
        cursor.execute("""
            SELECT h.id
            FROM holidays h
            JOIN semesters sem ON sem.id = h.semester_id
            WHERE sem.is_active = 1 AND h.date = ?
        """, (req.date,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=400,
                detail="This date is declared a holiday. Attendance cannot be marked."
            )

        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found.")
        semester_id = sem["id"]

        expected_day = requested_date.strftime("%A")
        session_id = None
        old_records = {}

        if req.slot_id is not None:
            # The timetable slot is the source of truth for subject, type and batch.
            cursor.execute("""
                SELECT t.*, sub.semester_id AS subject_semester_id
                FROM timetable_slots t
                JOIN subjects sub ON sub.id = t.subject_id
                WHERE t.id = ? AND t.semester_id = ? AND sub.semester_id = ?
            """, (req.slot_id, semester_id, semester_id))
            slot = cursor.fetchone()
            if not slot:
                raise HTTPException(status_code=400, detail="Invalid timetable slot for the active semester.")

            if slot["day_of_week"] != expected_day:
                raise HTTPException(status_code=400, detail="The selected slot does not belong to this date.")

            if slot["subject_id"] != req.subject_id or slot["slot_type"] != req.slot_type:
                raise HTTPException(status_code=400, detail="Attendance details do not match the timetable slot.")

            expected_batch = (slot["batch"] or "All").strip()
            requested_batch = (req.batch or "All").strip()

            if slot["slot_type"] == "Lab" and expected_batch == "All":
                raise HTTPException(
                    status_code=400,
                    detail="This Lab timetable slot has no batch assigned. Configure Batch 1, Batch 2 or Batch 3 before marking attendance."
                )

            if requested_batch != expected_batch:
                raise HTTPException(
                    status_code=400,
                    detail=f"Batch mismatch. This slot is assigned to {expected_batch}; attendance cannot be marked for {requested_batch}."
                )

            if slot["slot_type"] == "Theory" and expected_batch != "All":
                raise HTTPException(status_code=400, detail="Theory slots must target All students.")

            # Find the unique attendance session for this timetable slot/date.
            cursor.execute("""
                SELECT id
                FROM attendance_sessions
                WHERE slot_id = ? AND date = ?
                ORDER BY id DESC
                LIMIT 1
            """, (req.slot_id, req.date))
            existing = cursor.fetchone()

            if existing:
                session_id = existing["id"]
                cursor.execute(
                    "SELECT student_id, status FROM attendance_records WHERE session_id = ?",
                    (session_id,)
                )
                old_records = {r["student_id"]: r["status"] for r in cursor.fetchall()}

                # A legacy-corrupt session must never be reused across batches.
                cursor.execute("SELECT batch, subject_id, slot_type FROM attendance_sessions WHERE id = ?", (session_id,))
                existing_session = cursor.fetchone()
                if (
                    not existing_session
                    or existing_session["batch"] != expected_batch
                    or existing_session["subject_id"] != slot["subject_id"]
                    or existing_session["slot_type"] != slot["slot_type"]
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="Existing attendance data for this slot is inconsistent. It was isolated from calculations; please re-mark this class."
                    )

                cursor.execute("""
                    UPDATE attendance_sessions
                    SET is_cancelled = 0, cancellation_reason = NULL, marked_by = ?,
                        batch = ?, subject_id = ?, slot_type = ?, day_of_week = ?, month = ?
                    WHERE id = ?
                """, (
                    marked_by_name, expected_batch, slot["subject_id"], slot["slot_type"],
                    expected_day, req.date[:7], session_id
                ))
                cursor.execute("DELETE FROM attendance_records WHERE session_id = ?", (session_id,))
            else:
                cursor.execute("""
                    INSERT INTO attendance_sessions
                    (slot_id, subject_id, date, day_of_week, slot_type, batch, month, marked_by, is_cancelled, cancellation_reason, is_extra)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0)
                """, (
                    req.slot_id, slot["subject_id"], req.date, expected_day,
                    slot["slot_type"], expected_batch, req.date[:7], marked_by_name
                ))
                session_id = cursor.lastrowid

        elif req.session_id is not None:
            # Custom-day and extra classes already exist as attendance_sessions.
            # Reuse that exact session instead of creating a second anonymous
            # "extra" session. This keeps the schedule and attendance record tied
            # to the class the CR actually selected.
            cursor.execute("""
                SELECT * FROM attendance_sessions
                WHERE id = ? AND date = ? AND subject_id = ?
            """, (req.session_id, req.date, req.subject_id))
            existing_session = cursor.fetchone()
            if not existing_session:
                raise HTTPException(status_code=400, detail="Invalid custom/extra attendance session for this date.")
            if existing_session["is_cancelled"]:
                raise HTTPException(status_code=400, detail="This class is cancelled and cannot be marked.")

            requested_batch = (req.batch or "All").strip()
            actual_batch = (existing_session["batch"] or "All").strip()
            if requested_batch != actual_batch:
                raise HTTPException(status_code=400, detail=f"Batch mismatch. This class is assigned to {actual_batch}.")
            if existing_session["slot_type"] != req.slot_type:
                raise HTTPException(status_code=400, detail="Attendance type does not match the selected class.")

            session_id = existing_session["id"]
            cursor.execute(
                "SELECT student_id, status FROM attendance_records WHERE session_id = ?",
                (session_id,)
            )
            old_records = {r["student_id"]: r["status"] for r in cursor.fetchall()}
            cursor.execute("""
                UPDATE attendance_sessions
                SET is_cancelled = 0, cancellation_reason = NULL, marked_by = ?,
                    day_of_week = ?, month = ?
                WHERE id = ?
            """, (marked_by_name, expected_day, req.date[:7], session_id))
            cursor.execute("DELETE FROM attendance_records WHERE session_id = ?", (session_id,))

        else:
            # No existing session was supplied. This is a genuinely new ad-hoc
            # extra class, so create one now.
            cursor.execute("""
                SELECT id, type
                FROM subjects
                WHERE id = ? AND semester_id = ?
            """, (req.subject_id, semester_id))
            subject = cursor.fetchone()
            if not subject:
                raise HTTPException(status_code=400, detail="Invalid subject for the active semester.")

            requested_batch = (req.batch or "All").strip()
            if req.slot_type == "Lab" and requested_batch == "All":
                raise HTTPException(status_code=400, detail="Lab attendance must target one specific batch.")
            if req.slot_type == "Theory" and requested_batch != "All":
                raise HTTPException(status_code=400, detail="Theory attendance must target All students.")

            cursor.execute("""
                SELECT id
                FROM attendance_sessions
                WHERE slot_id IS NULL AND subject_id = ? AND date = ? AND batch = ?
                  AND is_extra = 1
                ORDER BY id DESC
                LIMIT 1
            """, (req.subject_id, req.date, requested_batch))
            existing = cursor.fetchone()

            if existing:
                session_id = existing["id"]
                cursor.execute(
                    "SELECT student_id, status FROM attendance_records WHERE session_id = ?",
                    (session_id,)
                )
                old_records = {r["student_id"]: r["status"] for r in cursor.fetchall()}
                cursor.execute("""
                    UPDATE attendance_sessions
                    SET is_cancelled = 0, cancellation_reason = NULL, marked_by = ?,
                        day_of_week = ?, month = ?
                    WHERE id = ?
                """, (marked_by_name, expected_day, req.date[:7], session_id))
                cursor.execute("DELETE FROM attendance_records WHERE session_id = ?", (session_id,))
            else:
                cursor.execute("""
                    INSERT INTO attendance_sessions
                    (slot_id, subject_id, date, day_of_week, slot_type, batch, month, marked_by, is_cancelled, cancellation_reason, is_extra)
                    VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1)
                """, (
                    req.subject_id, req.date, expected_day, req.slot_type,
                    requested_batch, req.date[:7], marked_by_name
                ))
                session_id = cursor.lastrowid

        # Only active-semester students in the exact target batch are eligible.
        if req.batch == "All":
            cursor.execute("""
                SELECT id, category, joining_date
                FROM students
                WHERE semester_id = ?
                  AND (is_dropped IS NULL OR is_dropped = 0)
            """, (semester_id,))
        else:
            cursor.execute("""
                SELECT id, category, joining_date
                FROM students
                WHERE semester_id = ?
                  AND batch = ?
                  AND (is_dropped IS NULL OR is_dropped = 0)
            """, (semester_id, req.batch))
        eligible_students = cursor.fetchall()

        cursor.execute("SELECT lateral_joining_date FROM semesters WHERE id = ?", (semester_id,))
        sem_join = cursor.fetchone()
        default_lateral_date = sem_join["lateral_joining_date"] if sem_join else None

        valid_students = []
        for student in eligible_students:
            lateral_date = student["joining_date"] or default_lateral_date
            if student["category"] == "Lateral Entry" and lateral_date and req.date < lateral_date:
                continue
            valid_students.append(student)

        valid_ids = {s["id"] for s in valid_students}
        absent_set = set(req.absent_student_ids)
        invalid_absent_ids = absent_set - valid_ids
        if invalid_absent_ids:
            raise HTTPException(
                status_code=400,
                detail="One or more absent students are not eligible for this exact semester/batch."
            )

        records_to_insert = [
            (session_id, s["id"], "Absent" if s["id"] in absent_set else "Present")
            for s in valid_students
        ]
        cursor.executemany("""
            INSERT OR REPLACE INTO attendance_records (session_id, student_id, status)
            VALUES (?, ?, ?)
        """, records_to_insert)

        # Audit Logging: record only actual status changes during re-marking.
        if old_records:
            cursor.execute("SELECT name, code FROM subjects WHERE id = ?", (req.subject_id,))
            sub_info = cursor.fetchone()
            sub_title = f"{sub_info['code']} - {sub_info['name']}" if sub_info else "Subject"

            audit_entries = []
            for s in valid_students:
                s_id = s["id"]
                new_st = "Absent" if s_id in absent_set else "Present"
                old_st = old_records.get(s_id)
                if old_st and old_st != new_st:
                    cursor.execute("SELECT reg_no, name FROM students WHERE id = ?", (s_id,))
                    s_detail = cursor.fetchone()
                    if s_detail:
                        audit_entries.append((
                            session_id, s_id, s_detail["reg_no"], s_detail["name"],
                            req.date, sub_title, req.slot_type, marked_by_name,
                            old_st, new_st
                        ))

            if audit_entries:
                cursor.executemany("""
                    INSERT INTO attendance_audit_logs
                    (session_id, student_id, student_reg_no, student_name, date, subject_name, slot_type, changed_by, previous_status, new_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, audit_entries)

        total_present = len(valid_students) - len(absent_set)

        return {
            "status": "success",
            "session_id": session_id,
            "marked_by": marked_by_name,
            "total_marked": len(valid_students),
            "present_count": total_present,
            "absent_count": len(absent_set)
        }


@app.get("/api/attendance/audit-logs")
def get_attendance_audit_logs(student_reg: Optional[str] = None, limit: int = 50, user: dict = Depends(get_current_user)):
    """
    Returns audit trail of modified attendance records.
    CR sees all class edits; Students see edits affecting their own attendance.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        if user.get("role") == "student":
            student_reg = user.get("sub")
            cursor.execute("""
                SELECT * FROM attendance_audit_logs
                WHERE student_reg_no = ?
                ORDER BY id DESC LIMIT ?
            """, (student_reg, limit))
        else:
            if student_reg:
                cursor.execute("""
                    SELECT * FROM attendance_audit_logs
                    WHERE student_reg_no = ?
                    ORDER BY id DESC LIMIT ?
                """, (student_reg, limit))
            else:
                cursor.execute("""
                    SELECT * FROM attendance_audit_logs
                    ORDER BY id DESC LIMIT ?
                """, (limit,))
        return [dict(r) for r in cursor.fetchall()]

@app.get("/api/student/recent-sessions")
def get_recent_sessions_for_student(reg_no: Optional[str] = None, user: dict = Depends(get_current_user)):
    """
    Returns recent marked attendance feed for student:
    - Subject, date, time, who marked it (CR/LR), and student's personal status (Present/Absent).
    """
    target_reg = reg_no if (user.get("role") in ["cr", "lr"] and reg_no) else user.get("sub")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, batch, category, joining_date FROM students WHERE reg_no = ?", (target_reg,))
        stu = cursor.fetchone()
        if not stu:
            return []

        # Lateral entry students should never see classes from before their joining date
        # mislabelled as "Absent" - they simply weren't enrolled yet.
        date_clause = ""
        params = [stu["id"], stu["batch"]]
        if stu["category"] == "Lateral Entry" and stu["joining_date"]:
            date_clause = " AND s.date >= ?"
            params.append(stu["joining_date"])

        cursor.execute(f"""
            SELECT s.id as session_id, s.date, s.day_of_week, s.slot_type, s.batch, s.start_time, s.end_time,
                   s.marked_by, s.is_cancelled, s.cancellation_reason,
                   sub.name as subject_name, sub.code as subject_code, sub.faculty_name,
                   COALESCE(r.status, 'Absent') as my_status
            FROM attendance_sessions s
            JOIN subjects sub ON s.subject_id = sub.id
            LEFT JOIN attendance_records r ON r.session_id = s.id AND r.student_id = ?
            WHERE (UPPER(TRIM(s.batch)) = 'ALL' OR UPPER(TRIM(s.batch)) = UPPER(TRIM(?))){date_clause}
            ORDER BY s.date DESC, s.id DESC
            LIMIT 15
        """, params)
        rows = [dict(r) for r in cursor.fetchall()]
        # Normalize field names/values so the frontend never has to guess or fall back to
        # generic placeholders like "CR/LR" - always show exactly who marked it, and a
        # status value in the same casing the UI expects.
        for r in rows:
            r["marked_by"] = r.get("marked_by") or "Not recorded"
            r["status"] = (r.get("my_status") or "Absent").upper()
        return rows

@app.delete("/api/attendance/session/{session_id}")
def delete_attendance_session(session_id: int, authorization: Optional[str] = Header(None), user: dict = Depends(get_current_user)):
    """
    Permanently removes a marked attendance session (the 'X' action on the Live Feed).
    Restricted to CR/LR. Every affected student's record is written to the audit log
    (previous_status -> 'REMOVED') before deletion so the change is always traceable,
    and the class's conducted-class counts recalculate immediately afterwards since the
    session and its records no longer exist.
    """
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="Only CR/LR administrators can remove a marked session")

    changed_by_name = resolve_marked_by(authorization)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT s.id, s.date, s.slot_type, sub.name as subject_name, sub.code as subject_code
            FROM attendance_sessions s
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.id = ?
        """, (session_id,))
        session = cursor.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Attendance session not found")

        sub_title = f"{session['subject_code']} - {session['subject_name']}"

        cursor.execute("""
            SELECT r.student_id, r.status, st.reg_no, st.name
            FROM attendance_records r
            JOIN students st ON st.id = r.student_id
            WHERE r.session_id = ?
        """, (session_id,))
        affected = cursor.fetchall()

        audit_entries = [
            (
                session_id, a["student_id"], a["reg_no"], a["name"],
                session["date"], sub_title, session["slot_type"], changed_by_name,
                a["status"], "REMOVED"
            )
            for a in affected
        ]
        if audit_entries:
            cursor.executemany("""
                INSERT INTO attendance_audit_logs
                (session_id, student_id, student_reg_no, student_name, date, subject_name, slot_type, changed_by, previous_status, new_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, audit_entries)

        cursor.execute("DELETE FROM attendance_records WHERE session_id = ?", (session_id,))
        cursor.execute("DELETE FROM attendance_sessions WHERE id = ?", (session_id,))

        return {
            "status": "success",
            "session_id": session_id,
            "students_affected": len(affected),
            "removed_by": changed_by_name
        }

@app.post("/api/attendance/cancel-slot")
def cancel_slot(req: ClassCancelRequest, authorization: Optional[str] = Header(None), user: dict = Depends(require_staff)):
    """
    Mark a slot as cancelled for a specific date with a 2-3 line reason.
    Strictly excluded from conducted counts so student percentages are NOT penalized.
    Records CR/LR marked_by attribution.
    """
    reason = req.description.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A 2-3 line explanation is required for cancelling a class.")

    marked_by_name = resolve_marked_by(authorization)

    try:
        datetime.strptime(req.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found.")

        cursor.execute(
            "SELECT id FROM holidays WHERE semester_id = ? AND date = ?",
            (sem["id"], req.date)
        )
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="This date is already a holiday.")

        if req.slot_id:
            cursor.execute("""
                SELECT t.subject_id, t.slot_type, t.batch, t.day_of_week
                FROM timetable_slots t
                WHERE t.id = ? AND t.semester_id = ?
            """, (req.slot_id, sem["id"]))
            slot = cursor.fetchone()
            if not slot:
                raise HTTPException(status_code=400, detail="Invalid timetable slot.")
            expected_day = datetime.strptime(req.date, "%Y-%m-%d").strftime("%A")
            if slot["day_of_week"] != expected_day:
                raise HTTPException(status_code=400, detail="The selected slot does not belong to this date.")
            if slot["subject_id"] != req.subject_id or slot["slot_type"] != req.slot_type:
                raise HTTPException(status_code=400, detail="Cancellation details do not match the timetable.")
            if (slot["batch"] or "All").strip() != (req.batch or "All").strip():
                raise HTTPException(status_code=400, detail="Cancellation batch does not match the timetable.")
            req_day = expected_day
            req_batch = (slot["batch"] or "All").strip()
        else:
            req_day = datetime.strptime(req.date, "%Y-%m-%d").strftime("%A")
            req_batch = (req.batch or "All").strip()

        # Reuse an existing session whenever the selected class is already represented
        # by attendance_sessions. This is essential for custom-day and extra classes,
        # where slot_id is intentionally NULL. Otherwise cancellation would create a
        # second session and the original class would remain active.
        if req.session_id is not None:
            cursor.execute("""
                SELECT * FROM attendance_sessions
                WHERE id = ? AND date = ? AND subject_id = ?
            """, (req.session_id, req.date, req.subject_id))
            existing = cursor.fetchone()
            if not existing:
                raise HTTPException(status_code=400, detail="Invalid custom/extra class session for this date.")
            if (existing["batch"] or "All").strip() != req_batch:
                raise HTTPException(status_code=400, detail="Cancellation batch does not match the selected class.")
            if existing["slot_type"] != req.slot_type:
                raise HTTPException(status_code=400, detail="Cancellation type does not match the selected class.")
            session_id = existing["id"]
            cursor.execute("""
                UPDATE attendance_sessions
                SET is_cancelled = 1, cancellation_reason = ?, marked_by = ?
                WHERE id = ?
            """, (reason, marked_by_name, session_id))
            cursor.execute("DELETE FROM attendance_records WHERE session_id = ?", (session_id,))
        elif req.slot_id:
            cursor.execute("""
                SELECT id FROM attendance_sessions 
                WHERE slot_id = ? AND date = ?
            """, (req.slot_id, req.date))
            existing = cursor.fetchone()
            if existing:
                session_id = existing["id"]
                cursor.execute("""
                    UPDATE attendance_sessions
                    SET is_cancelled = 1, cancellation_reason = ?, marked_by = ?
                    WHERE id = ?
                """, (reason, marked_by_name, session_id))
                cursor.execute("DELETE FROM attendance_records WHERE session_id = ?", (session_id,))
            else:
                cursor.execute("""
                    INSERT INTO attendance_sessions (slot_id, subject_id, date, day_of_week, slot_type, batch, month, marked_by, is_cancelled, cancellation_reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """, (req.slot_id, req.subject_id, req.date, req.day_of_week, req.slot_type, req.batch, req.month, marked_by_name, reason))
                session_id = cursor.lastrowid
        else:
            cursor.execute("""
                INSERT INTO attendance_sessions (slot_id, subject_id, date, day_of_week, slot_type, batch, month, marked_by, is_cancelled, cancellation_reason, is_extra)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
            """, (None, req.subject_id, req.date, req.day_of_week, req.slot_type, req.batch, req.month, marked_by_name, reason))
            session_id = cursor.lastrowid

        return {
            "status": "success",
            "session_id": session_id,
            "marked_by": marked_by_name,
            "message": "Class marked as cancelled. It will not affect student attendance."
        }

@app.post("/api/attendance/uncancel-slot")
@app.post("/api/attendance/uncancel-class")
def uncancel_slot(req: ClassUncancelRequest, authorization: Optional[str] = Header(None), user: dict = Depends(require_staff)):
    """
    Allows CR to undo class cancellation if cancelled by mistake.
    Restores the slot to active timetable status.
    """
    marked_by_name = resolve_marked_by(authorization)
    with get_db() as conn:
        cursor = conn.cursor()
        sess = None
        if req.session_id:
            cursor.execute("SELECT * FROM attendance_sessions WHERE id = ?", (req.session_id,))
            sess = cursor.fetchone()
        elif req.slot_id and req.date:
            cursor.execute("SELECT * FROM attendance_sessions WHERE (slot_id = ? OR id = ?) AND date = ?", (req.slot_id, req.slot_id, req.date))
            sess = cursor.fetchone()
        elif req.subject_id and req.date:
            cursor.execute("SELECT * FROM attendance_sessions WHERE subject_id = ? AND date = ? ORDER BY id DESC LIMIT 1", (req.subject_id, req.date))
            sess = cursor.fetchone()

        if not sess:
            raise HTTPException(status_code=404, detail="No cancelled class session found for the specified slot and date.")

        # Check if attendance records were attached. If none and slot_id is present, delete empty placeholder
        cursor.execute("SELECT COUNT(*) as cnt FROM attendance_records WHERE session_id = ?", (sess["id"],))
        rec_count = cursor.fetchone()["cnt"]
        if rec_count == 0 and sess["slot_id"] is not None:
            cursor.execute("DELETE FROM attendance_sessions WHERE id = ?", (sess["id"],))
        else:
            cursor.execute("""
                UPDATE attendance_sessions 
                SET is_cancelled = 0, cancellation_reason = NULL, marked_by = ?
                WHERE id = ?
            """, (marked_by_name, sess["id"]))

        return {
            "status": "success",
            "message": "Class cancellation undone successfully. The class is now active."
        }

@app.get("/api/attendance/date-audit")
def get_date_attendance_audit(date: str, user: dict = Depends(require_staff)):
    """
    Detailed audit for a specific date:
    Shows all sessions (both conducted and cancelled), holiday status, and student breakdown.
    Accessible to CR and students.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            return {"date": date, "sessions": [], "holiday": None}

        cursor.execute("SELECT * FROM holidays WHERE semester_id = ? AND date = ?", (sem["id"], date))
        holiday = cursor.fetchone()

        cursor.execute("""
            SELECT a.id, a.slot_id, a.subject_id, a.date, a.day_of_week, a.slot_type, a.batch,
                   a.is_cancelled, a.cancellation_reason, a.marked_by, a.created_at, a.is_extra,
                   s.name as subject_name, s.code as subject_code, s.faculty_name,
                   COALESCE(t.start_time, a.start_time) as start_time,
                   COALESCE(t.end_time, a.end_time) as end_time
            FROM attendance_sessions a
            JOIN subjects s ON a.subject_id = s.id
            LEFT JOIN timetable_slots t ON a.slot_id = t.id
            WHERE a.date = ?
            ORDER BY COALESCE(t.start_time, a.start_time, '00:00') ASC
        """, (date,))
        sessions = [dict(r) for r in cursor.fetchall()]

        for sess in sessions:
            cursor.execute("""
                SELECT st.reg_no, st.name, st.batch, r.status
                FROM attendance_records r
                JOIN students st ON r.student_id = st.id
                WHERE r.session_id = ?
                ORDER BY st.reg_no ASC
            """, (sess["id"],))
            records = [dict(rec) for rec in cursor.fetchall()]
            sess["records"] = records
            sess["present_count"] = sum(1 for r in records if r["status"] == "Present")
            sess["absent_count"] = sum(1 for r in records if r["status"] == "Absent")
            sess["total_marked"] = len(records)

        return {
            "date": date,
            "holiday": dict(holiday) if holiday else None,
            "sessions": sessions
        }

# ----------------- HOLIDAYS ----------------- #

@app.get("/api/holidays")
def get_holidays(user: dict = Depends(get_current_user)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            return []
        cursor.execute("SELECT * FROM holidays WHERE semester_id = ? ORDER BY date ASC", (sem["id"],))
        return [dict(h) for h in cursor.fetchall()]

@app.post("/api/holidays")
def add_holiday(req: HolidayCreate, authorization: Optional[str] = Header(None), user: dict = Depends(require_staff)):
    """
    Declare a holiday and immediately remove its attendance impact.

    Any already-marked sessions on the date are deleted with their records.
    The weekly timetable remains unchanged, so removing the holiday later gives
    the CR a clean, unmarked class to work with.
    """
    try:
        datetime.strptime(req.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    marked_by_name = resolve_marked_by(authorization)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found")

        try:
            cursor.execute("""
                INSERT INTO holidays (semester_id, date, title, description, declared_by)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(semester_id, date) DO UPDATE SET
                    title = excluded.title,
                    description = excluded.description,
                    declared_by = excluded.declared_by
            """, (
                sem["id"], req.date, req.title.strip(),
                (req.description or "").strip(), marked_by_name
            ))

            # A holiday supersedes every attendance session for that semester/date.
            # Remove records first, then sessions.  This prevents old attendance
            # from continuing to contribute to conducted/attended totals.
            cursor.execute("""
                DELETE FROM attendance_records
                WHERE session_id IN (
                    SELECT a.id
                    FROM attendance_sessions a
                    JOIN subjects sub ON sub.id = a.subject_id
                    WHERE a.date = ? AND sub.semester_id = ?
                )
            """, (req.date, sem["id"]))
            cursor.execute("""
                DELETE FROM attendance_sessions
                WHERE id IN (
                    SELECT a.id
                    FROM attendance_sessions a
                    JOIN subjects sub ON sub.id = a.subject_id
                    WHERE a.date = ? AND sub.semester_id = ?
                )
            """, (req.date, sem["id"]))

            holiday = cursor.execute(
                "SELECT id FROM holidays WHERE semester_id = ? AND date = ?",
                (sem["id"], req.date)
            ).fetchone()
            return {
                "status": "success",
                "id": holiday["id"] if holiday else cursor.lastrowid,
                "message": "Holiday saved. Any attendance on this date was removed from calculations."
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/holidays/{holiday_id}")
def delete_holiday(holiday_id: int, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM holidays WHERE id = ?", (holiday_id,))
        return {"status": "success", "message": "Holiday deleted"}

# ----------------- DEPARTMENT FORMS & EXCEL GATHERING ----------------- #

@app.get("/api/forms")
def get_department_forms(user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            return []
        cursor.execute("""
            SELECT f.id, f.title, f.description, f.fields_json, f.is_active, f.created_at,
                   COUNT(r.id) as response_count
            FROM student_forms f
            LEFT JOIN student_form_responses r ON r.form_id = f.id
            WHERE f.semester_id = ?
            GROUP BY f.id
            ORDER BY f.created_at DESC
        """, (sem["id"],))
        rows = cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["fields"] = json.loads(d["fields_json"])
            except Exception:
                d["fields"] = []
            result.append(d)
        return result

@app.get("/api/forms/active")
def get_active_forms(user: dict = Depends(get_current_user)):
    """
    Returns active forms that students need to fill out.
    If requested by student, checks if student already submitted responses.
    """
    reg_no = user.get("sub") if user.get("role") == "student" else None
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            return []
        cursor.execute("""
            SELECT id, title, description, fields_json, is_active, created_at
            FROM student_forms
            WHERE semester_id = ? AND is_active = 1
            ORDER BY created_at DESC
        """, (sem["id"],))
        forms = [dict(f) for f in cursor.fetchall()]
        result = []
        for f in forms:
            try:
                f["fields"] = json.loads(f["fields_json"])
            except Exception:
                f["fields"] = []
            # Check if student submitted
            if reg_no:
                cursor.execute("""
                    SELECT response_json, submitted_at FROM student_form_responses
                    WHERE form_id = ? AND student_reg_no = ?
                """, (f["id"], reg_no))
                submission = cursor.fetchone()
                if submission:
                    f["submitted"] = True
                    try:
                        f["my_response"] = json.loads(submission["response_json"])
                    except Exception:
                        f["my_response"] = {}
                    f["submitted_at"] = submission["submitted_at"]
                else:
                    f["submitted"] = False
                    f["my_response"] = None
            else:
                f["submitted"] = False
            result.append(f)
        return result

@app.post("/api/forms")
def create_department_form(req: StudentFormCreate, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semesters WHERE is_active = 1 LIMIT 1")
        sem = cursor.fetchone()
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester found")
        
        fields_data = [f.model_dump() for f in req.fields]
        cursor.execute("""
            INSERT INTO student_forms (semester_id, title, description, fields_json, is_active)
            VALUES (?, ?, ?, ?, 1)
        """, (sem["id"], req.title.strip(), (req.description or "").strip(), json.dumps(fields_data)))
        form_id = cursor.lastrowid
        return {"status": "success", "id": form_id, "message": "Department form created successfully"}

@app.delete("/api/forms/{form_id}")
def delete_department_form(form_id: int, user: dict = Depends(require_staff)):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM student_form_responses WHERE form_id = ?", (form_id,))
        cursor.execute("DELETE FROM student_forms WHERE id = ?", (form_id,))
        return {"status": "success", "message": "Form and responses deleted"}

@app.post("/api/forms/{form_id}/respond")
def submit_form_response(form_id: int, req: StudentFormResponseSubmit, user: dict = Depends(get_current_user)):
    reg_no = user.get("sub")
    if not reg_no:
        raise HTTPException(status_code=400, detail="Student reg_no required")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM students WHERE reg_no = ?", (reg_no,))
        st = cursor.fetchone()
        student_id = st["id"] if st else 0
        student_name = st["name"] if st else reg_no

        # Verify form exists
        cursor.execute("SELECT id FROM student_forms WHERE id = ?", (form_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Form not found")

        # Cleanly replace any previous submission from this student for this form
        cursor.execute("DELETE FROM student_form_responses WHERE form_id = ? AND student_reg_no = ?", (form_id, reg_no))

        cursor.execute("PRAGMA table_info(student_form_responses);")
        cols = [c["name"] for c in cursor.fetchall()]
        if "student_id" in cols:
            cursor.execute("""
                INSERT INTO student_form_responses (form_id, student_id, student_reg_no, student_name, response_json, submitted_at)
                VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
            """, (form_id, student_id, reg_no, student_name, json.dumps(req.responses)))
        else:
            cursor.execute("""
                INSERT INTO student_form_responses (form_id, student_reg_no, student_name, response_json, submitted_at)
                VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
            """, (form_id, reg_no, student_name, json.dumps(req.responses)))

        return {"status": "success", "message": "Response submitted successfully"}

@app.get("/api/forms/{form_id}/responses")
def get_form_responses(form_id: int, user: dict = Depends(require_staff)):
    """
    Returns responses sorted by reg_no.
    Generates excel_tsv formatted string for 1-click copy-paste directly into Excel.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM student_forms WHERE id = ?", (form_id,))
        form = cursor.fetchone()
        if not form:
            raise HTTPException(status_code=404, detail="Form not found")

        form_data = dict(form)
        fields = []
        try:
            fields = json.loads(form_data.get("fields_json", "[]"))
        except Exception:
            pass

        cursor.execute("""
            SELECT student_reg_no, student_name, response_json, submitted_at
            FROM student_form_responses
            WHERE form_id = ?
            ORDER BY student_reg_no ASC
        """, (form_id,))
        rows = cursor.fetchall()

        responses = []
        for r in rows:
            rd = dict(r)
            try:
                rd["responses"] = json.loads(rd["response_json"])
            except Exception:
                rd["responses"] = {}
            responses.append(rd)

        # Build Excel-ready TSV (Tab Separated Values)
        # Headers: Reg No \t Name \t <Field Labels...> \t Submitted At
        headers = ["Reg. No", "Name"] + [f.get("label", f.get("key")) for f in fields] + ["Submitted At"]
        tsv_lines = ["\t".join(headers)]

        for item in responses:
            res_dict = item.get("responses", {})
            row_vals = [
                item["student_reg_no"],
                item["student_name"]
            ]
            for f in fields:
                key = f.get("key")
                val = str(res_dict.get(key, ""))
                # Escape tabs or newlines inside values
                val = val.replace("\t", " ").replace("\n", " ")
                row_vals.append(val)
            row_vals.append(str(item.get("submitted_at", "")))
            tsv_lines.append("\t".join(row_vals))

        excel_tsv = "\n".join(tsv_lines)

        return {
            "form": {
                "id": form_data["id"],
                "title": form_data["title"],
                "description": form_data["description"],
                "fields": fields,
                "created_at": form_data["created_at"]
            },
            "total_responses": len(responses),
            "responses": responses,
            "excel_tsv": excel_tsv
        }

# ----------------- LOW-ATTENDANCE EMAIL ALERTS ----------------- #

def _get_active_semester_row(cursor):
    cursor.execute("SELECT * FROM semesters WHERE is_active = 1 LIMIT 1")
    return cursor.fetchone()


def _compute_low_attendance_list(conn, month: Optional[str], threshold: float, student_ids: Optional[List[int]] = None):
    """Shared logic: returns list of dicts for students strictly below `threshold`%."""
    cursor = conn.cursor()
    sem = _get_active_semester_row(cursor)
    if not sem:
        return [], None

    if student_ids:
        placeholders = ",".join("?" * len(student_ids))
        cursor.execute(f"""
            SELECT id FROM students
            WHERE semester_id = ? AND id IN ({placeholders}) AND (is_dropped IS NULL OR is_dropped = 0)
        """, (sem["id"], *student_ids))
    else:
        cursor.execute("""
            SELECT id FROM students WHERE semester_id = ? AND (is_dropped IS NULL OR is_dropped = 0)
        """, (sem["id"],))
    ids = [r["id"] for r in cursor.fetchall()]

    month_filter = None if (not month or month == "all") else month

    results = []
    for sid in ids:
        data = calculate_student_attendance(conn, sid, month_filter)
        if not data:
            continue
        overall = data["overall"]
        if overall["conducted"] <= 0:
            continue  # nothing conducted yet - nothing meaningful to alert about
        if overall["percentage"] < threshold:
            results.append({
                "student_id": data["student"]["id"],
                "reg_no": data["student"]["reg_no"],
                "name": data["student"]["name"],
                "email": data["student"]["email"],
                "batch": data["student"]["batch"],
                "percentage": overall["percentage"],
                "conducted": overall["conducted"],
                "attended": overall["attended"],
                "missed": overall["missed"],
                "classes_for_75": overall["classes_for_75"],
                "subjects": data["subjects"],
            })
    # Every recipient view is registration-number ordered. The <75% audience is a
    # filter, not a different ranking.
    results.sort(key=lambda r: str(r["reg_no"]))
    return results, sem


@app.get("/api/attendance/low-attendance-students")
def get_low_attendance_students(
    month: Optional[str] = None,
    threshold: float = 75.0,
    user: dict = Depends(get_current_user)
):
    """
    CR/LR-only preview: which students are currently below the given attendance
    threshold (default 75%), so the CR can review the list BEFORE sending any email.
    """
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")

    with get_db() as conn:
        results, sem = _compute_low_attendance_list(conn, month, threshold)
        return {
            "threshold": threshold,
            "month": month or "all",
            "total_students_below_threshold": len(results),
            "students": results,
            "smtp_configured": email_service.is_configured()
        }


@app.post("/api/attendance/send-low-attendance-emails")
def send_low_attendance_emails(
    req: SendAttendanceAlertsRequest,
    authorization: Optional[str] = Header(None),
    user: dict = Depends(get_current_user)
):
    """
    Sends the low-attendance alert email to every student below the threshold.
    This NEVER runs automatically - it only executes when a CR/LR explicitly
    presses the 'Send Low-Attendance Alert Emails' button in the portal.
    """
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")

    if not email_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Email sending is not configured on the server yet. Set SMTP_EMAIL and SMTP_APP_PASSWORD environment variables (see README)."
        )

    threshold = req.threshold or 75.0
    sender_name = resolve_marked_by(authorization)

    with get_db() as conn:
        results, sem = _compute_low_attendance_list(conn, req.month, threshold, req.student_ids)
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester configured")

        academic_year = sem["academic_year"] or "2026-2027"
        semester_name = sem["name"] or "Current Semester"
        month_label = "" if (not req.month or req.month == "all") else req.month

        sent, failed, skipped = [], [], []

        for stu in results:
            email_addr = (stu.get("email") or "").strip()
            if not email_addr or "@" not in email_addr:
                skipped.append({"reg_no": stu["reg_no"], "name": stu["name"], "reason": "No valid email on file"})
                continue

            subject, html, plain = email_service.build_low_attendance_email_html(
                student_name=stu["name"],
                reg_no=stu["reg_no"],
                overall_percentage=stu["percentage"],
                conducted=stu["conducted"],
                attended=stu["attended"],
                missed=stu["missed"],
                classes_for_75=stu["classes_for_75"],
                subjects=stu["subjects"],
                academic_year=academic_year,
                semester_name=semester_name,
                month_label=month_label,
                threshold=threshold,
                issued_by=sender_name,
            )
            ok, err = email_service.send_email(email_addr, subject, html, plain, sender_name=sender_name)
            if ok:
                sent.append({"reg_no": stu["reg_no"], "name": stu["name"], "email": email_addr, "percentage": stu["percentage"]})
            else:
                failed.append({"reg_no": stu["reg_no"], "name": stu["name"], "email": email_addr, "error": err})

        # Log this bulk action to the audit trail for accountability, one row per email sent
        if sent:
            cursor = conn.cursor()
            cursor.executemany("""
                INSERT INTO attendance_audit_logs
                (session_id, student_id, student_reg_no, student_name, date, subject_name, slot_type, changed_by, previous_status, new_status)
                VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                (s["reg_no"], s["name"], datetime.now().strftime("%Y-%m-%d"),
                 "Low-Attendance Email Alert", "Notification", sender_name,
                 f"{format_attendance_percentage(s['percentage'])}%", "EMAIL_SENT")
                for s in sent
            ])

        return {
            "status": "success",
            "threshold": threshold,
            "total_eligible": len(results),
            "sent_count": len(sent),
            "failed_count": len(failed),
            "skipped_count": len(skipped),
            "sent": sent,
            "failed": failed,
            "skipped": skipped
        }

# ================================================================================= #
# ATTENDANCE REPORT EMAILS (Email Centre)
#
# Two report types, one pipeline:
#   MONTHLY     - statement for a single closed month
#   CUMULATIVE  - semester-to-date aggregate
#
# Four audiences, all filters over the SAME computation so the work is never repeated:
#   ALL                 - every active student (the default and the common case)
#   BELOW_MONTHLY       - students below the threshold for the selected month
#   BELOW_CUMULATIVE    - students below the threshold semester-to-date
#   SELECTED            - an explicit subset ticked by the CR
#
# Sending is MANUAL ONLY - the CR/LR reviews the recipient list and presses Send. There is
# no background scheduler and nothing fires on login; the per-student dispatch log still
# guards against accidentally mailing the same statement to the same student twice, but
# nothing here runs unless a CR/LR explicitly triggers it. /api/email/status additionally
# reports which closed months have no statement sent yet - a read-only reminder, not a
# trigger - so a month never silently goes unnoticed.
# ================================================================================= #

def _require_admin(user: dict):
    if user.get("role") not in ["cr", "lr", "admin"]:
        raise HTTPException(status_code=403, detail="CR/LR authorization required")


def _resolve_period(sem, requested: Optional[str]) -> str:
    if requested and requested != "all":
        return requested
    if sem and sem["active_month"]:
        return sem["active_month"]
    return now_ist().strftime("%Y-%m")


@app.get("/api/email/status")
def email_status(user: dict = Depends(get_current_user)):
    """Everything the Email Centre needs to render, in one round trip."""
    _require_admin(user)
    email_service.reload_smtp_config()
    with get_db() as conn:
        cursor = conn.cursor()
        sem = _get_active_semester_row(cursor)
        reminders = dispatch_engine.unsent_closed_periods(conn, sem) if sem else []

        return {
            "smtp_configured": email_service.is_configured(),
            "sender": email_service.smtp_sender_address(),
            "sender_name": email_service.SMTP_SENDER_NAME,
            "threshold": email_service.ATTENDANCE_THRESHOLD,
            "active_month": sem["active_month"] if sem else None,
            "semester_periods": dispatch_engine.semester_periods(sem),
            "reminders": reminders,
        }


@app.get("/api/email/diagnostics")
def email_diagnostics(user: dict = Depends(get_current_user)):
    """Safe SMTP diagnostics. Never returns the app password."""
    _require_admin(user)
    email_service.reload_smtp_config()
    configured = email_service.is_configured()
    return {
        "configured": configured,
        "smtp_host": email_service.SMTP_HOST,
        "smtp_port": email_service.SMTP_PORT,
        "sender": email_service.SMTP_EMAIL,
        "app_password_loaded": bool(email_service.SMTP_APP_PASSWORD),
        "env_file": str(email_service.ENV_FILE),
        "message": (
            "Credentials are loaded. If Gmail returns authentication failed, Google is rejecting the App Password."
            if configured else
            "SMTP credentials are missing from backend/.env."
        ),
    }


@app.get("/api/email/recipients")
def email_recipients(
    report_type: str = "MONTHLY",
    period: Optional[str] = None,
    audience: str = "ALL",
    threshold: Optional[float] = None,
    user: dict = Depends(get_current_user),
):
    """Preview exactly who would be mailed, before anything is sent."""
    _require_admin(user)
    with get_db() as conn:
        cursor = conn.cursor()
        sem = _get_active_semester_row(cursor)
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester configured")

        resolved_period = _resolve_period(sem, period)
        thr = threshold if threshold is not None else email_service.ATTENDANCE_THRESHOLD

        recipients = dispatch_engine.build_recipients(
            conn, sem,
            report_type=(report_type or "MONTHLY").upper(),
            period=resolved_period,
            audience=(audience or "ALL").upper(),
            threshold=thr,
        )
        sent_ids = dispatch_engine.already_sent_ids(conn, resolved_period, (report_type or "MONTHLY").upper())

        for r in recipients:
            r["already_sent"] = r["student_id"] in sent_ids
            r.pop("subjects", None)   # keep the preview payload small

        return {
            "report_type": (report_type or "MONTHLY").upper(),
            "period": resolved_period,
            "period_label": email_service.month_label(resolved_period),
            "audience": (audience or "ALL").upper(),
            "threshold": thr,
            "total": len(recipients),
            "already_sent_count": sum(1 for r in recipients if r["already_sent"]),
            "no_email_count": sum(1 for r in recipients if not r["email"]),
            "students": recipients,
            "smtp_configured": email_service.is_configured(),
        }


@app.post("/api/email/send")
def email_send(
    req: AttendanceEmailRequest,
    authorization: Optional[str] = Header(None),
    user: dict = Depends(get_current_user),
):
    """Manual send from the Email Centre. One click, any audience."""
    _require_admin(user)

    if not email_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Email sending is not configured on the server. Set SMTP_EMAIL and "
                   "SMTP_APP_PASSWORD in the environment (see README).",
        )

    report_type = (req.report_type or "MONTHLY").upper()
    if report_type not in dispatch_engine.REPORT_TYPES:
        raise HTTPException(status_code=400, detail="report_type must be MONTHLY or CUMULATIVE")

    audience = (req.audience or "ALL").upper()
    sender_name = resolve_marked_by(authorization)
    thr = req.threshold if req.threshold is not None else email_service.ATTENDANCE_THRESHOLD

    with get_db() as conn:
        cursor = conn.cursor()
        sem = _get_active_semester_row(cursor)
        if not sem:
            raise HTTPException(status_code=400, detail="No active semester configured")

        period = _resolve_period(sem, req.period)

        recipients = dispatch_engine.build_recipients(
            conn, sem, report_type=report_type, period=period,
            audience=audience, threshold=thr, student_ids=req.student_ids,
        )
        if audience == dispatch_engine.AUDIENCE_SELECTED and req.student_ids:
            wanted = set(req.student_ids)
            recipients = [r for r in recipients if r["student_id"] in wanted]

        outcome = dispatch_engine.dispatch(
            conn, sem, report_type=report_type, period=period, recipients=recipients,
            threshold=thr, trigger="MANUAL", triggered_by=sender_name,
            force_resend=bool(req.force_resend),
        )

        if outcome.get("smtp_error"):
            raise HTTPException(status_code=503, detail=outcome["smtp_error"])

        # Keep the existing audit trail populated so nothing that reads it breaks.
        if outcome["sent"]:
            cursor.executemany(
                """INSERT INTO attendance_audit_logs
                   (session_id, student_id, student_reg_no, student_name, date, subject_name,
                    slot_type, changed_by, previous_status, new_status)
                   VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [(x["reg_no"], x["name"], datetime.now().strftime("%Y-%m-%d"),
                  f"{report_type.title()} Attendance Statement", "Notification",
                  sender_name, f"{format_attendance_percentage(x['percentage'])}%", "EMAIL_SENT")
                 for x in outcome["sent"]],
            )

        return {
            "status": "success",
            "report_type": report_type,
            "period": period,
            "period_label": email_service.month_label(period),
            "audience": audience,
            "threshold": thr,
            "total_eligible": outcome["total_considered"],
            "sent_count": len(outcome["sent"]),
            "failed_count": len(outcome["failed"]),
            "skipped_count": len(outcome["skipped"]),
            "sent": outcome["sent"],
            "failed": outcome["failed"],
            "skipped": outcome["skipped"],
        }


@app.get("/api/email/history")
def email_history(
    period: Optional[str] = None,
    report_type: Optional[str] = None,
    limit: int = 300,
    user: dict = Depends(get_current_user),
):
    """The dispatch ledger - who was mailed what, when, and whether it landed."""
    _require_admin(user)
    clauses, params = [], []
    if period:
        clauses.append("period = ?")
        params.append(period)
    if report_type:
        clauses.append("report_type = ?")
        params.append(report_type.upper())
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""SELECT reg_no, student_name, email, period, report_type, trigger,
                       status, detail, percentage, triggered_by, created_at
                FROM email_dispatch_log {where}
                ORDER BY created_at DESC, id DESC LIMIT ?""",
            (*params, max(1, min(limit, 1000))),
        )
        return {"entries": [dict(r) for r in cursor.fetchall()]}


# ----------------- STATIC FILES & FRONTEND SERVING ----------------- #

PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"
AU_LOGO_PATH = PROJECT_DIR / "au-logo.jpg"

@app.get("/au-logo.jpg")
def serve_au_logo():
    if AU_LOGO_PATH.exists():
        return FileResponse(str(AU_LOGO_PATH), media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Logo not found")

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        target = FRONTEND_DIST / full_path
        if target.exists() and target.is_file():
            return FileResponse(str(target))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
