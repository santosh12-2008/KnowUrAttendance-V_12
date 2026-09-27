import jwt
import datetime
import sqlite3
from typing import Dict, Any, Optional

from app.security import (
    hash_password,
    verify_password,
    is_default_student_password,
    is_default_admin_password,
    get_secret_key,
)

SECRET_KEY = get_secret_key()
ALGORITHM = "HS256"

# Admin accounts are bootstrapped from environment variables by database.init_db().
# No real credentials are stored in source control.
ADMIN_CREDENTIALS = {}


def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None):
    to_encode = data.copy()
    # A semester runs for several months and there is no silent token-refresh flow in
    # the frontend, so a short (previously 7-day) expiry meant every user was silently
    # logged out mid-semester: API calls would start failing with an unauthenticated
    # error (e.g. "Database download failed", dashboard failing to load) with no
    # indication that the fix is simply to log in again. 180 days comfortably covers a
    # full semester span; the person still has to log in again after that.
    expire = datetime.datetime.now(datetime.timezone.utc) + (expires_delta or datetime.timedelta(days=30))
    to_encode.update({"exp": expire, "token_type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict, expires_delta: Optional[datetime.timedelta] = None):
    """Create a long-lived refresh token used by the web client to silently renew access."""
    to_encode = data.copy()
    expire = datetime.datetime.now(datetime.timezone.utc) + (expires_delta or datetime.timedelta(days=365))
    to_encode.update({"exp": expire, "token_type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def refresh_access_token(refresh_token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("token_type") != "refresh":
            return None
        access_payload = {k: v for k, v in payload.items() if k not in {"exp", "token_type"}}
        return create_access_token(access_payload)
    except Exception:
        return None


def upgrade_legacy_session(access_token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(access_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("token_type") == "refresh":
            return None
        clean = {k: v for k, v in payload.items() if k not in {"exp", "token_type"}}
        return create_refresh_token(clean)
    except Exception:
        return None


def verify_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("token_type") == "refresh":
            return None
        return payload
    except Exception:
        return None


def _row_value(row, key, default=None):
    try:
        if row is None:
            return default
        keys = row.keys() if hasattr(row, "keys") else []
        return row[key] if key in keys else default
    except Exception:
        return default


def _authenticate_admin(conn: sqlite3.Connection, user_key: str, clean_pwd: str, clean_role: str):
    """
    CR / LR login.

    Resolution order:
      1. Exact username match (the correct, unambiguous path).
      2. Role match, only when the identifier was literally the role name ('cr'/'lr').

    There is deliberately NO fallback to the shipped ADMIN_CREDENTIALS here. The old build
    fell back to them whenever the stored password did not match, then wrote the default
    straight back into admin_accounts - which is why changed CR/LR passwords appeared not
    to save. Seeding now happens once, in init_db, and never again.
    """
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM admin_accounts WHERE LOWER(username) = ?", (user_key,))
    admin = cursor.fetchone()

    if not admin and user_key in ("cr", "lr", "admin"):
        lookup_role = "cr" if user_key == "admin" else user_key
        cursor.execute("SELECT * FROM admin_accounts WHERE LOWER(role) = ?", (lookup_role,))
        admin = cursor.fetchone()

    if not admin:
        return None

    stored = _row_value(admin, "password_hash")
    changed_at = _row_value(admin, "password_changed_at")

    is_valid, needs_upgrade = verify_password(clean_pwd, stored)

    # Privacy guard: once a real password has been set, a shipped default can never open
    # this account again - even if somebody restores an old database file.
    if is_valid and changed_at and is_default_admin_password(admin["username"], clean_pwd):
        return None

    if not is_valid:
        return None

    if needs_upgrade:
        # Silently migrate a legacy plaintext row to a salted hash on successful login.
        cursor.execute(
            "UPDATE admin_accounts SET password_hash = ? WHERE id = ?",
            (hash_password(clean_pwd), admin["id"]),
        )

    must_change = bool(not changed_at and is_default_admin_password(admin["username"], clean_pwd))

    token_data = {
        "sub": admin["username"],
        "role": admin["role"],
        "name": admin["name"],
        "user_id": 0,
    }
    return {
        "token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "role": admin["role"],
        "reg_no": admin["username"],
        "name": admin["name"],
        "user_id": 0,
        "must_change_password": must_change,
    }


def _authenticate_student(conn: sqlite3.Connection, clean_id: str, clean_pwd: str):
    cursor = conn.cursor()
    cursor.execute("""SELECT s.* FROM students s
        JOIN semesters sem ON sem.id = s.semester_id
        WHERE s.reg_no = ? AND sem.is_active = 1
        ORDER BY s.id DESC LIMIT 1""", (clean_id,))
    student = cursor.fetchone()
    if not student:
        return None

    stored = _row_value(student, "password")
    changed_at = _row_value(student, "password_changed_at")
    has_own_password = bool(changed_at)

    is_valid = False
    used_default = False

    if stored:
        ok, needs_upgrade = verify_password(clean_pwd, stored)
        if ok:
            is_valid = True
            if needs_upgrade:
                cursor.execute(
                    "UPDATE students SET password = ? WHERE id = ?",
                    (hash_password(clean_pwd), student["id"]),
                )

    # First-login convenience: a student who has never set a password may use the
    # issued default. The moment they set their own (password_changed_at is stamped),
    # every default is rejected permanently.
    if not is_valid and not has_own_password and is_default_student_password(clean_id, clean_pwd):
        is_valid = True
        used_default = True

    if not is_valid:
        return None

    token_data = {
        "sub": clean_id,
        "role": "student",
        "name": student["name"],
        "user_id": student["id"],
    }
    return {
        "token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "role": "student",
        "reg_no": student["reg_no"],
        "name": student["name"],
        "user_id": student["id"],
        "batch": student["batch"],
        "email": student["email"],
        "mobile": student["mobile"],
        "category": student["category"],
        "admission_no": student["admission_no"],
        "semester_id": student["semester_id"],
        "must_change_password": used_default,
    }


def authenticate_user(conn: sqlite3.Connection, identifier: str, password: str, role: str) -> Optional[Dict[str, Any]]:
    clean_id = (identifier or "").strip()
    clean_pwd = (password or "").strip()
    clean_role = (role or "student").strip().lower()

    if not clean_id or not clean_pwd:
        return None

    if clean_role in ["cr", "lr", "admin"]:
        user_key = clean_id.lower().replace(" ", "")
        return _authenticate_admin(conn, user_key, clean_pwd, clean_role)

    return _authenticate_student(conn, clean_id, clean_pwd)
