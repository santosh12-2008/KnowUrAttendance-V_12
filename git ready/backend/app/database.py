import sqlite3
import os
from pathlib import Path
from dotenv import load_dotenv
from contextlib import contextmanager

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_FILE, override=True)

DB_DIR = Path(__file__).resolve().parent.parent
env_db_path = os.environ.get("ATTENDANCE_DB_PATH")
DB_PATH = Path(env_db_path) if env_db_path else (DB_DIR / "attendance.db")

def get_db_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn

@contextmanager
def get_db():
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def _migrate_plaintext_passwords(cursor):
    """
    One-time, idempotent migration of legacy plaintext passwords to salted PBKDF2 hashes.

    Runs on every startup but only touches rows that are still plaintext, so it is safe
    to re-run. While migrating we can still SEE the plaintext, which is the only moment we
    can tell whether the value was a shipped default or a password the user actually chose -
    so we stamp `password_changed_at` for the real ones. After this migration the portal
    never has access to a plaintext password again.
    """
    from app.security import (
        hash_password, is_hashed,
        is_default_student_password, is_default_admin_password,
    )
    from datetime import datetime

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        cursor.execute("SELECT id, reg_no, password, password_changed_at FROM students WHERE password IS NOT NULL AND password != ''")
        for row in cursor.fetchall():
            if is_hashed(row["password"]):
                continue
            chosen = not is_default_student_password(row["reg_no"], row["password"])
            cursor.execute(
                "UPDATE students SET password = ?, password_changed_at = COALESCE(password_changed_at, ?) WHERE id = ?",
                (hash_password(row["password"]), now if chosen else None, row["id"]),
            )
    except Exception:
        pass

    try:
        cursor.execute("SELECT id, username, password_hash, password_changed_at FROM admin_accounts")
        for row in cursor.fetchall():
            if is_hashed(row["password_hash"]):
                continue
            chosen = not is_default_admin_password(row["username"], row["password_hash"])
            cursor.execute(
                "UPDATE admin_accounts SET password_hash = ?, password_changed_at = COALESCE(password_changed_at, ?) WHERE id = ?",
                (hash_password(row["password_hash"]), now if chosen else None, row["id"]),
            )
    except Exception:
        pass


def _migrate_students_to_semester_scoped_reg_no():
    """Remove the legacy global reg_no UNIQUE constraint.

    Registration numbers may recur across semesters, while remaining unique inside a
    semester. Existing IDs and attendance foreign keys are preserved.
    """
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        cols = [r[1] for r in conn.execute("PRAGMA table_info(students)").fetchall()]
        sql_row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='students'").fetchone()
        table_sql = sql_row[0] if sql_row else ''
        if not cols or 'semester_id' not in cols:
            return
        if 'reg_no TEXT UNIQUE' not in table_sql:
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_students_reg_sem ON students(reg_no, semester_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_students_semester_reg ON students(semester_id, reg_no)")
            conn.commit()
            return
        conn.execute("DROP TABLE IF EXISTS students__new")
        conn.execute("""
            CREATE TABLE students__new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reg_no TEXT NOT NULL,
                name TEXT NOT NULL,
                batch TEXT NOT NULL,
                mobile TEXT,
                email TEXT,
                category TEXT,
                admission_no TEXT,
                semester_id INTEGER NOT NULL,
                joining_date TEXT,
                is_dropped INTEGER DEFAULT 0,
                dropped_reason TEXT,
                dropped_date TEXT,
                password TEXT,
                password_changed_at TEXT,
                FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE
            )
        """)
        target_cols = ['id','reg_no','name','batch','mobile','email','category','admission_no','semester_id',
                       'joining_date','is_dropped','dropped_reason','dropped_date','password','password_changed_at']
        defaults = {'joining_date':'NULL','is_dropped':'0','dropped_reason':'NULL','dropped_date':'NULL',
                    'password':'NULL','password_changed_at':'NULL'}
        expr = ', '.join(c if c in cols else defaults.get(c, 'NULL') for c in target_cols)
        conn.execute(f"INSERT INTO students__new ({', '.join(target_cols)}) SELECT {expr} FROM students")
        conn.execute("DROP TABLE students")
        conn.execute("ALTER TABLE students__new RENAME TO students")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_students_reg_sem ON students(reg_no, semester_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_students_semester_reg ON students(semester_id, reg_no)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_students_reg ON students(reg_no)")
        conn.commit()
    finally:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.close()


def init_db():
    _migrate_students_to_semester_scoped_reg_no()
    with get_db() as conn:
        cursor = conn.cursor()

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS semesters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            academic_year TEXT DEFAULT '2026-2027',
            name TEXT NOT NULL,
            start_month TEXT NOT NULL,
            end_month TEXT NOT NULL,
            active_month TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        );
        """)

        # Migration: ensure academic_year column exists
        cursor.execute("PRAGMA table_info(semesters);")
        cols = [row["name"] for row in cursor.fetchall()]
        if "academic_year" not in cols:
            cursor.execute("ALTER TABLE semesters ADD COLUMN academic_year TEXT DEFAULT '2026-2027';")


        cursor.execute("""
        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL, -- 'Theory' or 'Lab'
            faculty_name TEXT,
            FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS timetable_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER NOT NULL,
            day_of_week TEXT NOT NULL, -- 'Monday', 'Tuesday', ...
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            subject_id INTEGER NOT NULL,
            slot_type TEXT NOT NULL, -- 'Theory' or 'Lab'
            batch TEXT NOT NULL DEFAULT 'All', -- 'All', 'Batch 1', 'Batch 2', 'Batch 3'
            FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
            FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS batch_ranges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER NOT NULL,
            batch_name TEXT NOT NULL, -- 'Batch 1', 'Batch 2', 'Batch 3'
            start_reg_no TEXT NOT NULL,
            end_reg_no TEXT NOT NULL,
            FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reg_no TEXT NOT NULL, -- unique per semester
            name TEXT NOT NULL,          -- up to 100 chars
            batch TEXT NOT NULL,         -- 'Batch 1', 'Batch 2', 'Batch 3'
            mobile TEXT,
            email TEXT,
            category TEXT,               -- 'Convener (EAPCET)', 'Management', 'Lateral Entry', etc.
            admission_no TEXT,
            semester_id INTEGER NOT NULL,
            FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE
        );
        """)

        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_students_reg_sem ON students(reg_no, semester_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_students_semester_reg ON students(semester_id, reg_no)")

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS attendance_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_id INTEGER,
            subject_id INTEGER NOT NULL,
            date TEXT NOT NULL,          -- YYYY-MM-DD
            day_of_week TEXT NOT NULL,
            slot_type TEXT NOT NULL,     -- 'Theory' or 'Lab'
            batch TEXT NOT NULL DEFAULT 'All', -- 'All', 'Batch 1', 'Batch 2', 'Batch 3'
            month TEXT NOT NULL,         -- YYYY-MM
            marked_by TEXT DEFAULT 'CR',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (slot_id) REFERENCES timetable_slots(id) ON DELETE SET NULL,
            FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS custom_day_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            marked_by TEXT DEFAULT 'CR',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(semester_id, date),
            FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS attendance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            status TEXT NOT NULL, -- 'Present' or 'Absent'
            FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE(session_id, student_id)
        );
        """)

        # Migration: ensure is_cancelled and cancellation_reason exist in attendance_sessions
        cursor.execute("PRAGMA table_info(attendance_sessions);")
        session_cols = [row["name"] for row in cursor.fetchall()]
        if "is_cancelled" not in session_cols:
            cursor.execute("ALTER TABLE attendance_sessions ADD COLUMN is_cancelled INTEGER DEFAULT 0;")
        if "cancellation_reason" not in session_cols:
            cursor.execute("ALTER TABLE attendance_sessions ADD COLUMN cancellation_reason TEXT;")
        if "is_extra" not in session_cols:
            cursor.execute("ALTER TABLE attendance_sessions ADD COLUMN is_extra INTEGER DEFAULT 0;")
        if "start_time" not in session_cols:
            cursor.execute("ALTER TABLE attendance_sessions ADD COLUMN start_time TEXT;")
        if "end_time" not in session_cols:
            cursor.execute("ALTER TABLE attendance_sessions ADD COLUMN end_time TEXT;")

        if "is_custom_day" not in session_cols:
            cursor.execute("ALTER TABLE attendance_sessions ADD COLUMN is_custom_day INTEGER DEFAULT 0;")

        # Migration: ensure students table has joining_date, is_dropped, dropped_reason, dropped_date
        cursor.execute("PRAGMA table_info(students);")
        student_cols = [row["name"] for row in cursor.fetchall()]
        if "joining_date" not in student_cols:
            cursor.execute("ALTER TABLE students ADD COLUMN joining_date TEXT;")
        if "is_dropped" not in student_cols:
            cursor.execute("ALTER TABLE students ADD COLUMN is_dropped INTEGER DEFAULT 0;")
        if "dropped_reason" not in student_cols:
            cursor.execute("ALTER TABLE students ADD COLUMN dropped_reason TEXT;")
        if "dropped_date" not in student_cols:
            cursor.execute("ALTER TABLE students ADD COLUMN dropped_date TEXT;")

        # Semester setup state + lateral joining-date configuration.
        cursor.execute("PRAGMA table_info(semesters);")
        sem_cols = [row["name"] for row in cursor.fetchall()]
        if "setup_complete" not in sem_cols:
            cursor.execute("ALTER TABLE semesters ADD COLUMN setup_complete INTEGER DEFAULT 1;")
        if "lateral_joining_date" not in sem_cols:
            cursor.execute("ALTER TABLE semesters ADD COLUMN lateral_joining_date TEXT DEFAULT '2026-08-02';")

        # Attendance Audit Logs Table (tracks who changed attendance, what change, when, and to whom)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS attendance_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            student_id INTEGER,
            student_reg_no TEXT,
            student_name TEXT,
            date TEXT NOT NULL,
            subject_name TEXT,
            slot_type TEXT,
            changed_by TEXT NOT NULL,
            previous_status TEXT NOT NULL,
            new_status TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Holidays Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS holidays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER NOT NULL,
            date TEXT NOT NULL,         -- YYYY-MM-DD
            title TEXT NOT NULL,        -- e.g. 'Gandhi Jayanti', 'AU Tech Fest'
            description TEXT,           -- 2-3 lines reason
            declared_by TEXT DEFAULT 'CR',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE,
            UNIQUE(semester_id, date)
        );
        """)

        # Department Data Gathering Forms Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS student_forms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            fields_json TEXT NOT NULL,       -- JSON string array of field definitions
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE
        );
        """)

        # Department Form Student Responses Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS student_form_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            form_id INTEGER NOT NULL,
            student_reg_no TEXT NOT NULL,
            student_name TEXT NOT NULL,
            response_json TEXT NOT NULL,    -- JSON string key-value answers
            submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (form_id) REFERENCES student_forms(id) ON DELETE CASCADE,
            UNIQUE(form_id, student_reg_no)
        );
        """)

        # Auto-migration if old schema existed
        cursor.execute("PRAGMA table_info(student_forms);")
        form_cols = [row["name"] for row in cursor.fetchall()]
        if "fields_json" not in form_cols and "fields" in form_cols:
            cursor.execute("ALTER TABLE student_forms RENAME COLUMN fields TO fields_json;")
        
        cursor.execute("PRAGMA table_info(student_form_responses);")
        resp_cols = [row["name"] for row in cursor.fetchall()]
        if "response_json" not in resp_cols and "responses" in resp_cols:
            cursor.execute("ALTER TABLE student_form_responses RENAME COLUMN responses TO response_json;")
        if "student_reg_no" not in resp_cols and "reg_no" in resp_cols:
            cursor.execute("ALTER TABLE student_form_responses RENAME COLUMN reg_no TO student_reg_no;")
        if "student_name" not in resp_cols:
            cursor.execute("ALTER TABLE student_form_responses ADD COLUMN student_name TEXT DEFAULT '';")

        # Migration: ensure students table has password
        if "password" not in student_cols:
            cursor.execute("ALTER TABLE students ADD COLUMN password TEXT;")

        # Admin Accounts Table (for CR and LR credentials)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS admin_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL, -- 'cr' or 'lr'
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Bootstrap admin accounts from environment variables only.
        # Never ship real usernames or passwords in source control.
        cursor.execute("SELECT COUNT(*) FROM admin_accounts")
        if cursor.fetchone()[0] == 0:
            from app.security import hash_password
            bootstrap = [
                (os.environ.get("ADMIN_CR_USERNAME", "").strip(),
                 os.environ.get("ADMIN_CR_PASSWORD", "").strip(),
                 os.environ.get("ADMIN_CR_NAME", "Class Representative").strip() or "Class Representative",
                 "cr"),
                (os.environ.get("ADMIN_LR_USERNAME", "").strip(),
                 os.environ.get("ADMIN_LR_PASSWORD", "").strip(),
                 os.environ.get("ADMIN_LR_NAME", "Ladies Representative").strip() or "Ladies Representative",
                 "lr"),
            ]
            for username, password, name, role in bootstrap:
                if username and password:
                    cursor.execute(
                        "INSERT INTO admin_accounts (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
                        (username, hash_password(password), name, role),
                    )

        # Password Reset Requests Table (Students submit, CR approves/denies)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS password_reset_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_reg_no TEXT NOT NULL,
            student_name TEXT NOT NULL,
            requested_password TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'DENIED'
            requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
            resolved_at TEXT,
            resolved_by TEXT
        );
        """)

        # Student Helpdesk & Work Requests Table (Students submit inquiries/requests to CR)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS student_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_reg_no TEXT NOT NULL,
            student_name TEXT NOT NULL,
            student_batch TEXT NOT NULL,
            category TEXT NOT NULL, -- 'Attendance Correction', 'Bonafide / Certificate', 'Leave / Permission', 'General'
            subject TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'IN_PROGRESS', 'RESOLVED'
            cr_note TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # ---------------------------------------------------------------- #
        # PASSWORD PRIVACY MIGRATIONS
        # `password_changed_at` is the single source of truth for "this account has a real
        # password now". Once it is stamped, auth.py refuses every shipped default password.
        # ---------------------------------------------------------------- #
        cursor.execute("PRAGMA table_info(students);")
        student_cols_now = [row["name"] for row in cursor.fetchall()]
        if "password_changed_at" not in student_cols_now:
            cursor.execute("ALTER TABLE students ADD COLUMN password_changed_at TEXT;")

        cursor.execute("PRAGMA table_info(admin_accounts);")
        admin_cols = [row["name"] for row in cursor.fetchall()]
        if "password_changed_at" not in admin_cols:
            cursor.execute("ALTER TABLE admin_accounts ADD COLUMN password_changed_at TEXT;")

        _migrate_plaintext_passwords(cursor)

        # ---------------------------------------------------------------- #
        # EMAIL DISPATCH LEDGER
        # There is no always-on scheduler on this deployment, so month-end reports are
        # dispatched opportunistically when a CR/LR opens the portal. That makes
        # idempotency mandatory: the UNIQUE constraint below guarantees a student can
        # receive at most ONE monthly and ONE cumulative report per period, no matter how
        # many times the portal is opened or how many tabs are running.
        # ---------------------------------------------------------------- #
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS email_dispatch_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER,
            student_id INTEGER,
            reg_no TEXT,
            student_name TEXT,
            email TEXT,
            period TEXT NOT NULL,        -- 'YYYY-MM' the report covers
            report_type TEXT NOT NULL,   -- 'MONTHLY' | 'CUMULATIVE'
            trigger TEXT DEFAULT 'AUTO', -- 'AUTO' | 'MANUAL'
            status TEXT NOT NULL,        -- 'SENT' | 'FAILED' | 'SKIPPED'
            detail TEXT,
            percentage REAL,
            triggered_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_id, period, report_type)
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS email_dispatch_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semester_id INTEGER,
            period TEXT NOT NULL,
            report_type TEXT NOT NULL,
            status TEXT DEFAULT 'RUNNING',   -- 'RUNNING' | 'COMPLETED' | 'FAILED'
            sent_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            skipped_count INTEGER DEFAULT 0,
            triggered_by TEXT,
            started_at TEXT DEFAULT CURRENT_TIMESTAMP,
            finished_at TEXT,
            UNIQUE(semester_id, period, report_type)
        );
        """)

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_dispatch_period ON email_dispatch_log(period, report_type);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_dispatch_student ON email_dispatch_log(student_id);")

        # Holiday integrity repair: older builds allowed a holiday to coexist with
        # already-marked sessions. Holiday dates must never contribute to attendance.
        cursor.execute("""
            SELECT a.id
            FROM attendance_sessions a
            JOIN subjects sub ON sub.id = a.subject_id
            JOIN holidays h ON h.semester_id = sub.semester_id AND h.date = a.date
        """)
        holiday_session_ids = [r["id"] for r in cursor.fetchall()]
        if holiday_session_ids:
            placeholders = ",".join("?" for _ in holiday_session_ids)
            cursor.execute(
                f"DELETE FROM attendance_records WHERE session_id IN ({placeholders})",
                holiday_session_ids
            )
            cursor.execute(
                f"DELETE FROM attendance_sessions WHERE id IN ({placeholders})",
                holiday_session_ids
            )

        # Attendance integrity repair: an older frontend could change the batch of
        # a Lab session after it was opened. Such a session is unsafe to count because
        # its records belong to the wrong roster. Isolate it by cancelling it and
        # removing its records. The CR can then re-mark the class using the timetable
        # batch. This is idempotent and only touches provably inconsistent Lab sessions.
        cursor.execute("""
            SELECT a.id
            FROM attendance_sessions a
            JOIN timetable_slots t ON t.id = a.slot_id
            WHERE a.slot_type = 'Lab'
              AND t.slot_type = 'Lab'
              AND TRIM(COALESCE(a.batch, '')) <> TRIM(COALESCE(t.batch, ''))
              AND (a.is_cancelled IS NULL OR a.is_cancelled = 0)
        """)
        corrupt_lab_session_ids = [r["id"] for r in cursor.fetchall()]
        if corrupt_lab_session_ids:
            placeholders = ",".join("?" for _ in corrupt_lab_session_ids)
            cursor.execute(
                f"DELETE FROM attendance_records WHERE session_id IN ({placeholders})",
                corrupt_lab_session_ids
            )
            cursor.execute(
                f"""UPDATE attendance_sessions
                    SET is_cancelled = 1,
                        cancellation_reason = 'Attendance integrity repair: Lab batch did not match timetable. Please re-mark this class.',
                        marked_by = 'SYSTEM'
                    WHERE id IN ({placeholders})""",
                corrupt_lab_session_ids
            )

        # Prevent duplicate attendance sessions for one timetable slot on one date.
        # Extra/custom sessions have slot_id NULL and remain outside this constraint.
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_slot_date
            ON attendance_sessions(slot_id, date)
            WHERE slot_id IS NOT NULL
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_students_reg ON students(reg_no);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_date ON attendance_sessions(date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_records_student ON attendance_records(student_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_records_session ON attendance_records(session_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_form_resp_reg ON student_form_responses(student_reg_no);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pwd_resets_status ON password_reset_requests(status);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_student_reqs_reg ON student_requests(student_reg_no);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_student_reqs_status ON student_requests(status);")

def reset_academic_data(conn: sqlite3.Connection):
    """
    Cleans all academic tables so the CR can start completely fresh.
    """
    cursor = conn.cursor()
    cursor.execute("DELETE FROM email_dispatch_log;")
    cursor.execute("DELETE FROM email_dispatch_runs;")
    cursor.execute("DELETE FROM student_requests;")
    cursor.execute("DELETE FROM password_reset_requests;")
    cursor.execute("DELETE FROM student_form_responses;")
    cursor.execute("DELETE FROM student_forms;")
    cursor.execute("DELETE FROM holidays;")
    cursor.execute("DELETE FROM attendance_records;")
    cursor.execute("DELETE FROM attendance_sessions;")
    cursor.execute("DELETE FROM students;")
    cursor.execute("DELETE FROM batch_ranges;")
    cursor.execute("DELETE FROM timetable_slots;")
    cursor.execute("DELETE FROM subjects;")
    cursor.execute("DELETE FROM semesters;")
    cursor.execute("DELETE FROM sqlite_sequence WHERE name IN ('semesters', 'subjects', 'timetable_slots', 'batch_ranges', 'students', 'attendance_sessions', 'attendance_records', 'holidays', 'student_forms', 'student_form_responses', 'password_reset_requests', 'student_requests', 'email_dispatch_log', 'email_dispatch_runs');")


