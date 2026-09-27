"""Regression tests: how attendance percentages are DISPLAYED.

Rules (must hold in the portal AND in every email):
  * exactly 2 digits after the point           74.94117647... -> 74.94
  * exactly 0 and exactly 100 use ONE digit    0 -> 0.0    100 -> 100.0
  * rounding never carries a student across 75 / 90 / 100   74.996 -> 74.99, never 75.00
  * the portal (JavaScript) and the emails (Python) always show the same text

Runs under pytest (uses the shared conftest test database) or on its own:
    cd backend && python -m unittest tests.test_percentage_format -v
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Never touch the real database: use a throw-away file unless pytest's conftest
# already selected the isolated test database.
if not os.environ.get("ATTENDANCE_DB_PATH"):
    os.environ["ATTENDANCE_DB_PATH"] = str(
        Path(tempfile.mkdtemp(prefix="kua_fmt_")) / "test_format.db"
    )

from app import database  # noqa: E402

if "test" not in database.DB_PATH.name.lower():  # pragma: no cover - safety net
    raise RuntimeError(f"Refusing to run against a non-test database: {database.DB_PATH}")

from app import calculations, dispatch, email_service  # noqa: E402
from app.formatting import format_attendance_percentage as fmt  # noqa: E402

JS_FORMATTER = REPO / "frontend" / "src" / "utils" / "attendance.js"
NODE = shutil.which("node")

DECIMAL_PCT = re.compile(r"(\d+\.\d+)%")


def _js_format(values):
    """Run the portal's real JavaScript formatter over `values`."""
    script = (
        f'import {{ formatAttendancePercentage as f }} from {json.dumps(JS_FORMATTER.as_uri())};\n'
        'import fs from "fs";\n'
        'const v = JSON.parse(fs.readFileSync(0, "utf8"));\n'
        'process.stdout.write(JSON.stringify(v.map(f)));\n'
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as fh:
        fh.write(script)
        path = fh.name
    try:
        out = subprocess.run([NODE, path], input=json.dumps(values),
                             capture_output=True, text=True, timeout=120)
    finally:
        os.unlink(path)
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)


def _visible_text(html: str) -> str:
    """Strip <style> blocks and tags so only what a student actually reads remains."""
    html = re.sub(r"(?is)<style.*?</style>", " ", html)
    return re.sub(r"<[^>]+>", " ", html)


def _assert_percentages_well_formed(testcase, text, where):
    """Every 'NN.NN%' in `text` must be 2-decimal, or exactly 0.0 / 100.0."""
    for number in DECIMAL_PCT.findall(text):
        decimals = len(number.split(".")[1])
        if number in ("0.0", "100.0"):
            continue
        testcase.assertEqual(decimals, 2, f"{where}: '{number}%' does not have exactly 2 decimals")
        testcase.assertNotIn(number, ("0.00", "100.00"), f"{where}: '{number}%' should be 0.0 / 100.0")


class FormatterRules(unittest.TestCase):
    def test_two_decimals(self):
        self.assertEqual(fmt(74.94117647058823), "74.94")
        self.assertEqual(fmt(74.94), "74.94")
        self.assertEqual(fmt(82.05128205128206), "82.05")
        self.assertEqual(fmt(50), "50.00")
        self.assertEqual(fmt(75.0), "75.00")
        self.assertEqual(fmt(90.0), "90.00")

    def test_zero_and_hundred_use_one_decimal(self):
        self.assertEqual(fmt(0), "0.0")
        self.assertEqual(fmt(0.0), "0.0")
        self.assertEqual(fmt(100), "100.0")
        self.assertEqual(fmt(100.0), "100.0")

    def test_rounding_never_crosses_a_threshold(self):
        self.assertEqual(fmt(74.994999), "74.99")
        self.assertEqual(fmt(74.996), "74.99")     # NOT 75.00
        self.assertEqual(fmt(74.99999), "74.99")
        self.assertEqual(fmt(89.996), "89.99")     # NOT 90.00
        self.assertEqual(fmt(99.996), "99.99")     # NOT 100.00
        self.assertEqual(fmt(99.99999), "99.99")
        self.assertEqual(fmt(75.004), "75.00")     # genuinely above 75: fine

    def test_ties_round_half_up_like_javascript(self):
        # 25/32 classes = 78.125 exactly.  Python's own :.2f gives 78.12 (half-even).
        self.assertEqual(fmt(25 / 32 * 100), "78.13")
        self.assertEqual(fmt(1 / 32 * 100), "3.13")

    def test_bad_input_is_safe(self):
        for bad in (None, "", "abc", float("nan"), float("inf"), -5):
            self.assertIn(fmt(bad), ("0.0", "100.0"))
        self.assertEqual(fmt("74.94"), "74.94")

    def test_tiny_nonzero_is_not_shown_as_zero(self):
        self.assertEqual(fmt(0.004), "0.01")

    def test_old_import_locations_still_work(self):
        # Older code/tests import the name from these modules.
        self.assertIs(email_service.format_attendance_percentage, fmt)


@unittest.skipUnless(NODE, "node is not installed")
class PortalAndEmailAgree(unittest.TestCase):
    def test_python_and_javascript_produce_identical_text(self):
        values = {0.0, 100.0, 74.94, 74.996, 89.996, 99.996, 78.125, 3.125, 1.005, 0.004}
        for conducted in range(1, 301):          # every attended/conducted a class could have
            for attended in range(conducted + 1):
                values.add(attended / conducted * 100.0)
        values = sorted(values)
        js = _js_format(values)
        py = [fmt(v) for v in values]
        mismatches = [(v, p, j) for v, p, j in zip(values, py, js) if p != j]
        self.assertEqual(mismatches, [], f"first mismatches: {mismatches[:5]}")


class _FakeSmtp:
    """Stands in for the real mail connection so no email is ever sent."""
    sent = []
    ready = True
    error = ""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def send(self, addr, subject, html, plain, sender_name=""):
        _FakeSmtp.sent.append({"to": addr, "subject": subject, "html": html, "plain": plain})
        return True, ""


class EndToEndEmails(unittest.TestCase):
    """Real database + real calculations + real dispatch; only the SMTP socket is faked."""

    # (name, present in A[32], present in B[7], present in earlier-month B[3])
    STUDENTS = [
        ("Tie Case",      25, 7, 1),   # A = 78.125 exactly -> must read 78.13
        ("Perfect",       32, 7, 3),   # 100 everywhere      -> 100.0
        ("Zero",           0, 0, 0),   # 0 everywhere        -> 0.0
        ("Exactly 75",    24, 5, 2),   # A = 75.00 exactly
        ("Awkward Decimals", 31, 6, 2),
        ("Low",           17, 3, 1),
    ]

    @classmethod
    def setUpClass(cls):
        database.init_db()
        with database.get_db() as conn:
            database.reset_academic_data(conn)
            cur = conn.cursor()
            cur.execute("""INSERT INTO semesters (name, start_month, end_month, active_month, is_active)
                           VALUES ('B.Tech CSE - 2nd Year 1st Sem (2-1)', '2026-08', '2026-12', '2026-09', 1)""")
            sem_id = cur.lastrowid
            subj = {}
            for code, name in (("CS2101", "Data Structures"), ("CS2102", "Operating Systems")):
                cur.execute("INSERT INTO subjects (semester_id, code, name, type, faculty_name) "
                            "VALUES (?, ?, ?, 'Theory', 'Dr. X')", (sem_id, code, name))
                subj[code] = cur.lastrowid

            def make_sessions(subject_id, count, month):
                ids = []
                for i in range(count):
                    cur.execute("""INSERT INTO attendance_sessions
                                   (slot_id, subject_id, date, day_of_week, slot_type, batch, month)
                                   VALUES (NULL, ?, ?, 'Monday', 'Theory', 'All', ?)""",
                                (subject_id, f"{month}-{(i % 27) + 1:02d}", month))
                    ids.append(cur.lastrowid)
                return ids

            sess_a = make_sessions(subj["CS2101"], 32, "2026-09")
            sess_b = make_sessions(subj["CS2102"], 7, "2026-09")
            sess_c = make_sessions(subj["CS2102"], 3, "2026-08")

            for idx, (name, pa, pb, pc) in enumerate(cls.STUDENTS, start=1):
                reg = f"99999900{idx:04d}"
                cur.execute("""INSERT INTO students (reg_no, name, batch, email, semester_id)
                               VALUES (?, ?, 'Batch 1', ?, ?)""",
                            (reg, name, f"{reg}@example.test", sem_id))
                sid = cur.lastrowid
                for sessions, present in ((sess_a, pa), (sess_b, pb), (sess_c, pc)):
                    for k, sess in enumerate(sessions):
                        cur.execute("INSERT INTO attendance_records (session_id, student_id, status) "
                                    "VALUES (?, ?, ?)", (sess, sid, "Present" if k < present else "Absent"))

    @classmethod
    def tearDownClass(cls):
        with database.get_db() as conn:
            database.reset_academic_data(conn)

    def _send_all(self, report_type, period):
        _FakeSmtp.sent = []
        real_smtp, real_delay = email_service.SmtpSession, dispatch.INTER_MESSAGE_DELAY
        email_service.SmtpSession, dispatch.INTER_MESSAGE_DELAY = _FakeSmtp, 0
        try:
            with database.get_db() as conn:
                sem = conn.execute("SELECT * FROM semesters WHERE is_active = 1").fetchone()
                recipients = dispatch.build_recipients(conn, sem, report_type=report_type, period=period)
                result = dispatch.dispatch(conn, sem, report_type=report_type, period=period,
                                           recipients=recipients, trigger="MANUAL", triggered_by="Test CR",
                                           force_resend=True)
        finally:
            email_service.SmtpSession, dispatch.INTER_MESSAGE_DELAY = real_smtp, real_delay
        self.assertEqual(result["failed"], [], result)
        self.assertEqual(len(_FakeSmtp.sent), len(self.STUDENTS))
        return recipients, list(_FakeSmtp.sent)

    def _check(self, report_type, period):
        recipients, emails = self._send_all(report_type, period)
        by_email = {m["to"]: m for m in emails}
        checked_subject_cells = 0
        for r in recipients:
            mail = by_email[r["email"]]
            where = f"{report_type}/{r['name']}"
            shown = fmt(r["percentage"])

            # 1. headline number: subject line, big number in the HTML, and plain text all agree
            self.assertIn(f"| {shown}%", mail["subject"], where)
            self.assertIn(f"{shown}%", _visible_text(mail["html"]), where)
            self.assertIn(f"Attendance: {shown}%", mail["plain"], where)

            # 2. every subject in the table shows the formatted value, never the raw float
            for s in r["subjects"]:
                if s["conducted"] <= 0:
                    continue
                cell = f"{fmt(s['percentage'])}%"
                self.assertIn(cell, _visible_text(mail["html"]), where)
                self.assertIn(f"({cell})", mail["plain"], where)
                raw = repr(float(s["percentage"]))
                if len(raw.split(".")[1]) > 2:          # a long raw value must never leak out
                    self.assertNotIn(raw, mail["html"], where)
                    self.assertNotIn(raw, mail["plain"], where)
                    self.assertNotIn(raw, mail["subject"], where)
                checked_subject_cells += 1

            # 3. no percentage anywhere has the wrong number of decimals
            for label in ("subject", "plain"):
                _assert_percentages_well_formed(self, mail[label], f"{where} {label}")
            _assert_percentages_well_formed(self, _visible_text(mail["html"]), f"{where} html")
        self.assertGreater(checked_subject_cells, 0)
        return recipients, emails

    def test_monthly_emails(self):
        recipients, _ = self._check("MONTHLY", "2026-09")
        shown = {r["name"]: fmt(r["percentage"]) for r in recipients}
        self.assertEqual(shown["Perfect"], "100.0")
        self.assertEqual(shown["Zero"], "0.0")

    def test_cumulative_emails(self):
        self._check("CUMULATIVE", "2026-09")

    def test_the_tie_case_reads_the_same_in_email_and_portal(self):
        # 25/32 in Data Structures = 78.125 -> "78.13" in the email table.
        _, emails = self._check("MONTHLY", "2026-09")
        tie = next(m for m in emails if "999999000001" in m["to"])
        self.assertIn("78.13%", _visible_text(tie["html"]))
        self.assertNotIn("78.12", tie["html"] + tie["plain"])

    def test_class_average_is_raw_for_logic_and_formats_to_two_decimals(self):
        with database.get_db() as conn:
            sem = conn.execute("SELECT * FROM semesters WHERE is_active = 1").fetchone()
            overview = calculations.calculate_class_overview(conn, sem["id"])
            stats = calculations.calculate_class_statistics(conn, sem["id"])
        avg = overview["class_average"]
        self.assertGreater(len(repr(float(avg)).split(".")[1]), 2,
                           "class_average should stay unrounded for logic (the UI formats it)")
        self.assertRegex(fmt(avg), r"^\d{1,2}\.\d{2}$")
        for sub in stats["subjects"]:
            self.assertRegex(fmt(sub["average_percentage"]), r"^(\d{1,2}\.\d{2}|0\.0|100\.0)$")
        if NODE:
            values = [avg] + [s["average_percentage"] for s in stats["subjects"]]
            self.assertEqual(_js_format(values), [fmt(v) for v in values])


if __name__ == "__main__":
    unittest.main(verbosity=2)
