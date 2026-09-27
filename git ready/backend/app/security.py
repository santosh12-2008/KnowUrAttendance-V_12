"""
Password security for KnowUrAttendance (AUCE(A) CSE Department).

Design goals
------------
1. No plaintext passwords at rest. Everything is stored as a salted PBKDF2-HMAC-SHA256
   digest using ONLY the Python standard library (no new dependency, works offline,
   works on the college machine without pip access).

2. Backwards compatible. The existing database stores plaintext passwords. `verify_password`
   transparently accepts a legacy plaintext value and reports `needs_upgrade=True`, so the
   caller can silently re-write it as a hash on the next successful login. Nobody is locked out.

3. Default passwords stop working the moment a real password is set. This is enforced here
   (`is_default_student_password`) and in auth.py, not scattered across the codebase.

Stored format:  pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
"""

import hashlib
import hmac
import os
from pathlib import Path
import secrets
from typing import Optional, Tuple

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 260_000
SALT_BYTES = 16

# Demo / bootstrap passwords that must never be accepted once a real password exists.
GENERIC_DEFAULTS = {"password123", "changeme", "admin", "12345678"}


def hash_password(raw_password: str) -> str:
    """Return a salted PBKDF2 digest string for `raw_password`."""
    raw = (raw_password or "").strip()
    salt = secrets.token_bytes(SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt, ITERATIONS)
    return f"{ALGORITHM}${ITERATIONS}${salt.hex()}${dk.hex()}"


def is_hashed(stored: Optional[str]) -> bool:
    return bool(stored) and str(stored).startswith(f"{ALGORITHM}$")


def verify_password(raw_password: str, stored: Optional[str]) -> Tuple[bool, bool]:
    """
    Check `raw_password` against `stored`.

    Returns (is_valid, needs_upgrade). `needs_upgrade` is True when the stored value was a
    legacy plaintext password that matched - the caller should re-save it as a hash.
    """
    raw = (raw_password or "").strip()
    if not raw or not stored:
        return False, False

    stored = str(stored)

    if not is_hashed(stored):
        # Legacy plaintext row from an older build of the portal.
        return (hmac.compare_digest(raw, stored.strip()), True)

    try:
        _algo, iterations, salt_hex, hash_hex = stored.split("$", 3)
        dk = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations))
        return (hmac.compare_digest(dk.hex(), hash_hex), False)
    except Exception:
        return False, False


def default_student_passwords(reg_no: str) -> list:
    """The first-login passwords a student may use BEFORE they set their own."""
    reg = (reg_no or "").strip()
    tail = reg[-4:] if len(reg) >= 4 else reg
    return [f"{reg}@CSE", f"au@{tail}"] + sorted(GENERIC_DEFAULTS)


def is_default_student_password(reg_no: str, candidate: str) -> bool:
    cand = (candidate or "").strip()
    if not cand:
        return False
    return cand in default_student_passwords(reg_no)


def default_admin_passwords(username: str = "") -> list:
    """Return configured bootstrap passwords plus generic weak defaults.

    Bootstrap credentials come from environment variables and are never hard-coded.
    """
    user = (username or "").strip().lower()
    base = sorted(GENERIC_DEFAULTS)
    configured = [
        os.environ.get("ADMIN_CR_PASSWORD", "").strip(),
        os.environ.get("ADMIN_LR_PASSWORD", "").strip(),
    ]
    base.extend(p for p in configured if p)
    if user:
        base.append(f"{user}@CSE")
    return base


def is_default_admin_password(username: str, candidate: str) -> bool:
    cand = (candidate or "").strip()
    if not cand:
        return False
    return cand in default_admin_passwords(username)


def validate_new_password(raw_password: str, *, reg_no: str = "", username: str = "") -> Optional[str]:
    """
    Returns an error message if the proposed password is unacceptable, else None.
    Deliberately lenient on complexity (students must be able to remember it) but hard
    on reusing any shipped default, which is the actual privacy risk.
    """
    pwd = (raw_password or "").strip()
    if len(pwd) < 6:
        return "Password must be at least 6 characters long."
    if len(pwd) > 128:
        return "Password must be 128 characters or fewer."
    if reg_no and is_default_student_password(reg_no, pwd):
        return "You cannot reuse a default portal password. Please choose a different one."
    if username and is_default_admin_password(username, pwd):
        return "You cannot reuse a default portal password. Please choose a different one."
    if pwd.lower() in GENERIC_DEFAULTS:
        return "That password is too common. Please choose a different one."
    if reg_no and pwd == reg_no:
        return "Your password cannot be the same as your registration number."
    return None


def get_secret_key() -> str:
    """Return a persistent JWT signing key without shipping a forgeable hard-coded secret."""
    env_key = os.environ.get("JWT_SECRET_KEY", "").strip()
    if env_key:
        return env_key

    configured_file = os.environ.get("JWT_SECRET_FILE", "").strip()
    if configured_file:
        secret_path = Path(configured_file).expanduser()
    elif os.name == "nt":
        secret_path = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "KnowUrAttendance" / ".jwt_secret"
    else:
        secret_path = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "KnowUrAttendance" / ".jwt_secret"

    try:
        secret_path.parent.mkdir(parents=True, exist_ok=True)
        if secret_path.exists():
            value = secret_path.read_text(encoding="utf-8").strip()
            if value:
                return value
        value = secrets.token_hex(32)
        secret_path.write_text(value, encoding="utf-8")
        try:
            os.chmod(secret_path, 0o600)
        except OSError:
            pass
        return value
    except OSError:
        # Last-resort process-local secret. This is only reached when the configured
        # persistent location is not writable. The launcher normally supplies a writable path.
        return secrets.token_hex(32)
