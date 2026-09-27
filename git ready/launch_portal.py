"""
KnowUrAttendance - fast launcher
================================

Called by start_portal.bat. It does the same job the old .bat did, but only does the
slow parts when they are actually needed:

  * pip install      -> only if requirements.txt changed or a package is missing
  * npm install      -> only if package.json / package-lock.json changed
  * npm run build    -> only if something in frontend/ is newer than the last build
  * browser          -> opens Google Chrome directly the moment the server answers
                        (no PowerShell, no fixed delay, falls back to the default browser)
  * daily DB backup  -> one safe copy per day in ./backups (keeps the last 14)

Nothing here changes the app itself. Ctrl+C in this window still stops the server.

Optional environment variables:
  PORTAL_PORT   port to use (default 8000)
  PORTAL_HOST   0.0.0.0 = reachable from phones on the same Wi-Fi (default)
                127.0.0.1 = this computer only
"""

import datetime
import importlib.util
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
DIST_INDEX = FRONTEND / "dist" / "index.html"

PORT = int(os.environ.get("PORTAL_PORT", "8000"))
HOST = os.environ.get("PORTAL_HOST", "0.0.0.0")
URL = f"http://localhost:{PORT}"
BACKUP_KEEP = 14

# import name for each package in requirements.txt
REQUIRED_MODULES = ["fastapi", "uvicorn", "pydantic", "jwt", "multipart", "dotenv"]


def say(msg=""):
    print(msg, flush=True)


def persistent_database_path():
    """Return the database path that survives replacing/extracting a new ZIP."""
    configured = os.environ.get("ATTENDANCE_DB_PATH")
    if configured:
        return Path(configured).expanduser()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "KnowUrAttendance" / "attendance.db"


def prepare_database_path():
    """Keep live data outside the extracted application folder.

    The bundled DB is used only once, when no persistent DB exists yet. After that,
    extracting a newer ZIP cannot roll the user's live attendance backwards.
    """
    target = persistent_database_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    bundled = BACKEND / "attendance.db"
    if not target.exists() and bundled.exists():
        src = sqlite3.connect(str(bundled), timeout=5)
        dst = sqlite3.connect(str(target), timeout=5)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        say(f"[data] Initialized persistent database from bundled data: {target}")
    os.environ["ATTENDANCE_DB_PATH"] = str(target)
    os.environ.setdefault("JWT_SECRET_FILE", str(target.parent / ".jwt_secret"))
    return target


# ----------------------------------------------------------------------------
# 1. Python dependencies
# ----------------------------------------------------------------------------
def missing_modules():
    return [m for m in REQUIRED_MODULES if importlib.util.find_spec(m) is None]


def ensure_python_deps():
    req = BACKEND / "requirements.txt"
    stamp = BACKEND / ".requirements.installed"
    try:
        same = stamp.exists() and stamp.read_bytes() == req.read_bytes()
    except OSError:
        same = False

    if not missing_modules() and (same or not stamp.exists()):
        # Everything importable. First run with no stamp: just record it, no pip needed.
        if not same:
            try:
                shutil.copyfile(req, stamp)
            except OSError:
                pass
        return True

    say("[setup] Installing backend dependencies (first run or requirements changed)...")
    result = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(req)])
    if result.returncode == 0:
        try:
            shutil.copyfile(req, stamp)
        except OSError:
            pass
        return True

    if missing_modules():
        say("[ERROR] Could not install: " + ", ".join(missing_modules()))
        say("        Check your internet connection and run start_portal.bat again.")
        return False
    say("[WARNING] pip had an issue but all packages are present - continuing.")
    return True


# ----------------------------------------------------------------------------
# 2. Frontend build (only when needed)
# ----------------------------------------------------------------------------
def newest_mtime(paths):
    latest = 0.0
    for p in paths:
        p = Path(p)
        if p.is_file():
            latest = max(latest, p.stat().st_mtime)
        elif p.is_dir():
            for dirpath, _dirs, files in os.walk(p):
                for name in files:
                    try:
                        latest = max(latest, os.stat(os.path.join(dirpath, name)).st_mtime)
                    except OSError:
                        pass
    return latest


def frontend_is_stale():
    if not DIST_INDEX.exists():
        return True
    built = DIST_INDEX.stat().st_mtime
    newest_source = newest_mtime([
        FRONTEND / "src", FRONTEND / "public", FRONTEND / "index.html",
        FRONTEND / "package.json", FRONTEND / "vite.config.js",
    ])
    return newest_source > built


def node_modules_stale():
    marker = FRONTEND / "node_modules" / ".package-lock.json"
    if not marker.exists():
        return True
    m = marker.stat().st_mtime
    for name in ("package.json", "package-lock.json"):
        f = FRONTEND / name
        if f.exists() and f.stat().st_mtime > m:
            return True
    return False


def ensure_frontend():
    if not frontend_is_stale():
        return True

    have_dist = DIST_INDEX.exists()
    if not shutil.which("npm"):
        if have_dist:
            # A working prebuilt bundle is safer than refusing to start the portal merely
            # because Node.js is unavailable. The bundle contains the session-recovery shim;
            # if Node.js is installed later, this function will rebuild from the current source.
            say("[WARNING] Node.js/npm is not available, so the existing frontend bundle will be used.")
            say("          Install Node.js LTS and restart later to rebuild from the latest frontend source.")
            return True
        say("[ERROR] Node.js/npm was not found and there is no built frontend yet.")
        say("        Install the LTS version from https://nodejs.org/ and run again.")
        return False

    say("[setup] Frontend changed since the last build - rebuilding (only when code changes)...")
    if node_modules_stale():
        r = subprocess.run("npm install --no-audit --no-fund", shell=True, cwd=str(FRONTEND))
        if r.returncode == 0:
            marker = FRONTEND / "node_modules" / ".package-lock.json"
            try:
                if marker.exists():
                    os.utime(marker, None)
            except OSError:
                pass
        else:
            if have_dist:
                say("[WARNING] npm install failed, so the verified existing frontend bundle will be used.")
                say("          The portal can still start. Rebuild later when npm/network access is available.")
                return True
            say("[ERROR] npm install failed and there is no built frontend bundle.")
            return False

    r = subprocess.run("npm run build", shell=True, cwd=str(FRONTEND))
    if r.returncode != 0:
        if have_dist:
            say("[WARNING] Frontend rebuild failed, so the verified existing frontend bundle will be used.")
            say("          The portal can still start. Rebuild later when the Node/npm environment is healthy.")
            return True
        say("[ERROR] Frontend build failed and there is no built frontend bundle.")
        return False
    return True


# ----------------------------------------------------------------------------
# 3. Daily database backup (safe while the DB is in WAL mode)
# ----------------------------------------------------------------------------
def daily_backup():
    try:
        env_path = os.environ.get("ATTENDANCE_DB_PATH")
        db = Path(env_path) if env_path else BACKEND / "attendance.db"
        if not db.exists():
            return
        folder = ROOT / "backups"
        folder.mkdir(exist_ok=True)
        target = folder / f"attendance_{datetime.date.today():%Y-%m-%d}.db"
        if target.exists():
            return
        src = sqlite3.connect(str(db), timeout=5)
        dst = sqlite3.connect(str(target))
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        for old in sorted(folder.glob("attendance_*.db"))[:-BACKUP_KEEP]:
            old.unlink()
        say(f"[backup] Saved today's database backup -> backups\\{target.name}")
    except Exception as exc:  # a backup problem must never stop the portal
        say(f"[WARNING] Daily backup skipped: {exc}")


# ----------------------------------------------------------------------------
# 4. Browser + networking helpers
# ----------------------------------------------------------------------------
def port_open(port, timeout=0.3):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def portal_already_running():
    try:
        with urllib.request.urlopen(URL + "/openapi.json", timeout=2) as resp:
            title = json.load(resp).get("info", {}).get("title", "")
            return "KnowUrAttendance" in title
    except Exception:
        return False


def find_chrome():
    candidates = []
    if os.name == "nt":
        try:
            import winreg
            for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(
                        root, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
                    ) as key:
                        candidates.append(Path(winreg.QueryValue(key, None)))
                except OSError:
                    pass
        except ImportError:
            pass
        for env in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = os.environ.get(env)
            if base:
                candidates.append(Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe")
    for name in ("chrome", "google-chrome", "chromium"):
        found = shutil.which(name)
        if found:
            candidates.append(Path(found))
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def open_in_browser():
    chrome = find_chrome()
    if chrome:
        try:
            flags = 0
            if os.name == "nt":
                flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            subprocess.Popen([chrome, URL], creationflags=flags, close_fds=True)
            return
        except OSError:
            pass
    import webbrowser
    say("[INFO] Chrome not found - opening your default browser instead.")
    webbrowser.open(URL)


def open_when_ready(started_at):
    # Poll the port every 0.2s. uvicorn only starts listening after the app has fully
    # loaded, so an open port means the site will load - no more "site can't be reached".
    for _ in range(300):
        if port_open(PORT):
            say(f"[OK] Portal is up in {time.time() - started_at:.1f}s - opening Chrome...")
            open_in_browser()
            return
        time.sleep(0.2)


def lan_addresses():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no packet is sent; just picks the active adapter
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith(("127.", "169.254.")))


def jwt_configured():
    if os.environ.get("JWT_SECRET_KEY", "").strip():
        return True
    env_file = BACKEND / ".env"
    if env_file.exists():
        for line in env_file.read_text(errors="ignore").splitlines():
            line = line.strip()
            if line.startswith("JWT_SECRET_KEY=") and line.split("=", 1)[1].strip():
                return True
    return False


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main():
    started = time.time()

    # Make sure this launcher sits inside the real project folder.
    missing = [n for n, ok in (
        ("backend\\app\\main.py", (BACKEND / "app" / "main.py").is_file()),
        ("frontend\\package.json", (FRONTEND / "package.json").is_file()),
    ) if not ok]
    if missing:
        say("[ERROR] This launcher is not inside your full project folder.")
        say("        Missing: " + ", ".join(missing))
        say(f"        It is running from: {ROOT}")
        say("        Copy start_portal.bat, launch_portal.py, create_desktop_shortcut.bat,")
        say("        portal.ico and .gitignore INTO your original know-ur-attendance folder")
        say("        (the one that contains the 'backend' and 'frontend' folders), and")
        say("        backend\\requirements.txt into its 'backend' folder.")
        return 1

    # Already running (e.g. you double-clicked twice)? Just open Chrome and leave.
    if port_open(PORT):
        if portal_already_running():
            say(f"[INFO] Portal is already running on port {PORT} - opening Chrome.")
            open_in_browser()
            return 0
        say(f"[ERROR] Port {PORT} is being used by another program.")
        say("        Close it, or set PORTAL_PORT to a different number, then try again.")
        return 1

    if not ensure_python_deps():
        return 1
    if not ensure_frontend():
        return 1
    db_path = prepare_database_path()
    daily_backup()

    if not jwt_configured():
        say("[NOTICE] JWT_SECRET_KEY is not set in backend\\.env - login tokens use the default key")
        say("         from the source code. See the launcher notes to set one (takes 1 minute).")

    say()
    say(f"[INFO] Persistent database file: {db_path}")
    if HOST == "0.0.0.0":
        ips = lan_addresses()
        if ips:
            say("[INFO] Phones on the SAME Wi-Fi can open the portal at:")
            for ip in ips:
                say(f"         http://{ip}:{PORT}")
        say("       (First time only: allow Python through the Windows Firewall, tick Private + Public.)")
    else:
        say("[INFO] Local-only mode: this computer only.")
    say("[INFO] Press Ctrl+C in this window to stop the server.")
    say("=" * 70)
    say()

    threading.Thread(target=open_when_ready, args=(started,), daemon=True).start()

    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    os.environ["PYTHONPATH"] = "."
    import uvicorn
    try:
        uvicorn.run("app.main:app", host=HOST, port=PORT)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
