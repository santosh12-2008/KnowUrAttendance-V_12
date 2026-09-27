# KnowUrAttendance

A full-stack attendance management portal for college classes, built with **React + Vite**, **FastAPI**, and **SQLite**.

> This repository is the **source-code edition**. Real student records, attendance history, backups, credentials, JWT secrets, and `.env` files are intentionally excluded from Git.

## Features

- Student, CR, and LR portals
- Attendance marking and editing with audit logs
- Theory and batch-wise lab attendance
- Student attendance dashboards by month and semester
- Semester creation, activation, switching, and protected deletion
- Lateral-entry joining-date handling
- Student helpdesk and password-reset workflows
- Bulk student import from pasted text
- Low-attendance email alerts triggered explicitly by CR/LR
- JSON and SQLite backup/restore support
- JWT access + refresh token authentication
- Password hashing with PBKDF2-HMAC-SHA256
- Responsive React UI
- Docker and Render deployment configuration

## Architecture

```text
Browser
  │
  ▼
React + Vite frontend
  │  /api/*
  ▼
FastAPI backend
  │
  ▼
SQLite database
```

The backend also serves the compiled frontend in production.

## Requirements

- Python 3.10+
- Node.js 20+ for frontend development/builds
- npm
- Git

## Local setup

### 1. Clone

```bash
git clone <your-repository-url>
cd KnowUrAttendance
```

### 2. Create the backend environment file

Windows PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

Linux/macOS:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set strong CR/LR bootstrap credentials. **Never commit this file.**

### 3. Install Python dependencies

```bash
python -m venv .venv
```

Windows:

```powershell
.\.venv\Scripts\Activate.ps1
```

Linux/macOS:

```bash
source .venv/bin/activate
```

Then:

```bash
python -m pip install -r backend/requirements.txt
```

### 4. Build the frontend

```bash
cd frontend
npm ci
npm run build
cd ..
```

### 5. Start the portal

```bash
python launch_portal.py
```

Or on Windows:

```text
start_portal.bat
```

The launcher uses a persistent user-data directory for the live SQLite database and JWT secret, so replacing the source folder does not automatically overwrite the live database.

## Development mode

Backend:

```bash
uvicorn backend.app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm run dev
```

API documentation is available at `/docs` when the FastAPI server is running.

## Testing

Run the backend test suite:

```bash
cd backend
python -m pytest -q
```

Tests use an isolated temporary SQLite database and test-only credentials supplied through the test environment. They do not require the production database.

## Environment variables

| Variable | Purpose |
|---|---|
| `ATTENDANCE_DB_PATH` | SQLite database location |
| `JWT_SECRET_KEY` | Explicit JWT signing secret |
| `JWT_SECRET_FILE` | Persistent file for generated JWT secret |
| `ADMIN_CR_USERNAME` | First-run CR username |
| `ADMIN_CR_PASSWORD` | First-run CR password |
| `ADMIN_CR_NAME` | CR display name |
| `ADMIN_LR_USERNAME` | First-run LR username |
| `ADMIN_LR_PASSWORD` | First-run LR password |
| `ADMIN_LR_NAME` | LR display name |
| `SMTP_EMAIL` | SMTP sender account |
| `SMTP_APP_PASSWORD` | SMTP app password |
| `SMTP_SENDER_NAME` | Email display name |
| `BRANCH_SHORT` | Short branch label used in emails |
| `COLLEGE_SHORT` | Short college label used in emails |

## Email alerts

Low-attendance emails are **not sent automatically just because the portal opens**. A CR/LR explicitly starts the send workflow.

For Gmail, use an App Password rather than a normal account password. Store it only in environment variables or the deployment platform's secret store.

## Deployment

### Docker

The repository contains a multi-stage `Dockerfile` that builds the React frontend and runs FastAPI with Uvicorn.

```bash
docker build -t know-ur-attendance .
docker run --rm -p 8000:8000 \
  -e ADMIN_CR_USERNAME=change-me \
  -e ADMIN_CR_PASSWORD='use-a-strong-password' \
  -e ADMIN_LR_USERNAME=change-me-too \
  -e ADMIN_LR_PASSWORD='use-another-strong-password' \
  know-ur-attendance
```

For real deployments, use a persistent volume for the SQLite database and a secret manager/environment settings for credentials.

### Render

`render.yaml` is included as a starting point. Configure the bootstrap admin credentials and SMTP secrets in Render's environment settings. Do not put secrets in `render.yaml`.

## Security notes

- Do not commit `backend/.env`.
- Do not commit `backend/attendance.db`.
- Do not commit database backups.
- Do not commit JWT secret files.
- Do not place real student data in fixtures or screenshots.
- Use strong, unique CR/LR passwords in every deployment.
- SQLite is appropriate for a small single-instance deployment. A larger multi-instance deployment should use a server database and shared storage strategy.

## Repository hygiene

The `.gitignore` intentionally excludes:

- SQLite databases and WAL/SHM files
- backups
- `.env` files
- Python caches and virtual environments
- Node `node_modules`
- build artifacts
- local JWT secrets

Before pushing a repository for the first time, run:

```bash
git status
git diff --cached
```

and verify that no database, `.env`, secret, or personal-data file is staged.

## License

No license has been selected for this repository yet. Add one before distributing the project publicly under explicit reuse terms.
