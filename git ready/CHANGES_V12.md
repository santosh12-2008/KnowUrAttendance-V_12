# V12 Hardening Notes

V12 focuses on reliability, authentication recovery, semester isolation, backup/restore validation, attendance integrity, and safer deployment behavior.

## Security and reliability

- Added access and refresh token handling with silent access-token renewal in the frontend.
- Refresh tokens cannot be used as access tokens.
- JWT signing uses an environment-configured or persistent generated secret. No signing secret is shipped in source control.
- Protected attendance overview/statistics routes and sensitive semester operations.
- Passwords are hashed with salted PBKDF2-HMAC-SHA256.
- CR/LR bootstrap credentials are supplied through environment variables instead of source code.
- Attendance attribution no longer falls back to a hardcoded person's identity.
- JSON backup/restore validates the backup structure and restores transactionally.

## Semester/data handling

- Creating a new semester no longer silently replaces the active semester.
- Attendance is not copied into a newly created semester.
- Student details can be copied between semesters when explicitly requested.
- Semester deletion requires an authorized role and an explicit confirmation phrase.
- Registration numbers are scoped to a semester rather than globally unique.
- Lateral-entry attendance uses the configured joining-date rules.

## Timetable and attendance

- Attendance-bearing timetable entries were checked against the project timetable source.
- Non-attendance activities are excluded from attendance marking.
- Attendance percentages are calculated from recorded sessions and are not rounded upward across the 75% threshold.

## GitHub/deployment hygiene

- Real attendance databases and backups are excluded from the repository.
- `.env` files and generated JWT secrets are excluded.
- The frontend production bundle is treated as a build artifact and is excluded from Git.
- CI runs the backend test suite and a fresh frontend build.
- Docker and Render configuration remain available for deployment.
