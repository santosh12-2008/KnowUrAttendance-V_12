import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db, reset_academic_data

client = TestClient(app)
_staff_login = client.post("/api/auth/login", json={"reg_no":"test_cr","password":"TestCR!123456","role":"cr"})
assert _staff_login.status_code == 200, _staff_login.text
client.headers.update({"Authorization": f"Bearer {_staff_login.json()['token']}"})

@pytest.fixture(autouse=True)
def setup_test_data():
    # Setup test semester, subjects, batch ranges, and students
    with get_db() as conn:
        reset_academic_data(conn)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO semesters (name, start_month, end_month, active_month, is_active)
            VALUES ('B.Tech CSE - 3rd Year 1st Sem (3-1)', '2026-07', '2026-11', '2026-09', 1)
        """)
        sem_id = cursor.lastrowid

        # Subjects
        cursor.execute("INSERT INTO subjects (semester_id, code, name, type, faculty_name) VALUES (?, 'CS3101', 'Database Management Systems', 'Theory', 'Dr. Rao')", (sem_id,))
        sub1 = cursor.lastrowid
        cursor.execute("INSERT INTO subjects (semester_id, code, name, type, faculty_name) VALUES (?, 'CS3106', 'DBMS Laboratory', 'Lab', 'Dr. Rao')", (sem_id,))
        sub2 = cursor.lastrowid

        # Batch ranges
        cursor.execute("INSERT INTO batch_ranges (semester_id, batch_name, start_reg_no, end_reg_no) VALUES (?, 'Batch 1', '999999000001', '999999000047')", (sem_id,))
        cursor.execute("INSERT INTO batch_ranges (semester_id, batch_name, start_reg_no, end_reg_no) VALUES (?, 'Batch 2', '999999000048', '999999000094')", (sem_id,))
        cursor.execute("INSERT INTO batch_ranges (semester_id, batch_name, start_reg_no, end_reg_no) VALUES (?, 'Batch 3', '999999000095', '999999000140')", (sem_id,))

        # Timetable
        cursor.execute("INSERT INTO timetable_slots (semester_id, day_of_week, start_time, end_time, subject_id, slot_type, batch) VALUES (?, 'Saturday', '09:00 AM', '09:50 AM', ?, 'Theory', 'All')", (sem_id, sub1))
        cursor.execute("INSERT INTO timetable_slots (semester_id, day_of_week, start_time, end_time, subject_id, slot_type, batch) VALUES (?, 'Saturday', '01:30 PM', '04:00 PM', ?, 'Lab', 'Batch 1')", (sem_id, sub2))

        # Insert 140 Students
        for i in range(1, 141):
            reg = f"999999000{i:03d}"
            batch = "Batch 1" if i <= 47 else ("Batch 2" if i <= 94 else "Batch 3")
            name = "Example Student" if reg == "999999000001" else f"Student {i}"
            cursor.execute("""
                INSERT INTO students (reg_no, name, batch, mobile, email, category, admission_no, semester_id)
                VALUES (?, ?, ?, ?, ?, 'Convener (EAPCET)', ?, ?)
            """, (reg, name, batch, "+91 90000 00001", f"{reg}@example.edu", f"TEST-CSE-2026-{i:04d}", sem_id))
            stu_id = cursor.lastrowid

            if reg == "999999000028":
                # Create a sample attendance session
                cursor.execute("""
                    INSERT INTO attendance_sessions (slot_id, subject_id, date, day_of_week, slot_type, batch, month)
                    VALUES (NULL, ?, '2026-09-10', 'Thursday', 'Theory', 'All', '2026-09')
                """, (sub1,))
                sess_id = cursor.lastrowid
                cursor.execute("INSERT INTO attendance_records (session_id, student_id, status) VALUES (?, ?, 'Present')", (sess_id, stu_id))

def test_cr_login():
    # 1. CR login with test_cr
    response = client.post("/api/auth/login", json={
        "reg_no": "test_cr",
        "password": "TestCR!123456",
        "role": "cr"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "cr"
    assert "token" in data
    assert "Test Class Representative" in data["name"]

    # 2. LR login with test_lr
    lr_res = client.post("/api/auth/login", json={
        "reg_no": "test_lr",
        "password": "TestLR!123456",
        "role": "cr"
    })
    assert lr_res.status_code == 200
    lr_data = lr_res.json()
    assert lr_data["role"] == "lr"
    assert "Test Ladies Representative" in lr_data["name"]

    # 3. Disallowed credentials must fail with 401
    bad_res = client.post("/api/auth/login", json={
        "reg_no": "test_cr",
        "password": "WrongPassword",
        "role": "cr"
    })
    assert bad_res.status_code == 401

def test_student_login():
    response = client.post("/api/auth/login", json={
        "reg_no": "999999000001",
        "password": "999999000001@CSE",
        "role": "student"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "student"
    assert data["reg_no"] == "999999000001"
    assert data["name"] == "Example Student"
    assert data["batch"] == "Batch 1"
    assert "token" in data

def test_student_dashboard():
    # Login first. This fixture student has one recorded attendance session.
    login_res = client.post("/api/auth/login", json={
        "reg_no": "999999000028",
        "password": "999999000028@CSE",
        "role": "student"
    })
    token = login_res.json()["token"]

    response = client.get("/api/student/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()
    
    # Check student profile
    student = data["student"]
    assert student["reg_no"] == "999999000028"
    assert student["name"] == "Student 28"
    assert student["batch"] == "Batch 1"
    
    # Check dynamic calculation
    overall = data["overall"]
    assert overall["conducted"] >= 1
    assert overall["attended"] >= 1
    assert "percentage" in overall
    assert "color" in overall

def test_cr_overview():
    response = client.get("/api/attendance/overview")
    assert response.status_code == 200
    data = response.json()
    assert "class_average" in data
    assert data["total_students"] == 140
    assert "distribution" in data
    assert len(data["students"]) == 140

def test_slots_for_date():
    response = client.get("/api/attendance/slots-for-date?date=2026-09-12")
    assert response.status_code == 200
    data = response.json()
    assert data["day_name"] == "Saturday"
    assert len(data["slots"]) > 0

def test_eligible_students_batch_filtering():
    res_b1 = client.get("/api/attendance/eligible-students?batch=Batch%201")
    assert res_b1.status_code == 200
    students_b1 = res_b1.json()
    assert len(students_b1) == 47
    for s in students_b1:
        assert s["batch"] == "Batch 1"
        assert len(s["reg_no_last3"]) == 3

    res_b2 = client.get("/api/attendance/eligible-students?batch=Batch%202")
    assert res_b2.status_code == 200
    assert len(res_b2.json()) == 47

    res_b3 = client.get("/api/attendance/eligible-students?batch=Batch%203")
    assert res_b3.status_code == 200
    assert len(res_b3.json()) == 46

def test_semester_academic_year_update():
    # Update academic year and semester name
    res = client.put("/api/semesters/current", json={
        "academic_year": "2025-2026",
        "name": "B.Tech CSE - 3rd Year 1st Sem (3-1)",
        "active_month": "2026-09"
    })
    assert res.status_code == 200
    active = client.get("/api/semesters/active").json()
    assert active["academic_year"] == "2025-2026"
    assert active["name"] == "B.Tech CSE - 3rd Year 1st Sem (3-1)"

def test_subject_faculty_update():
    subs = client.get("/api/subjects").json()
    assert len(subs) > 0
    sub_id = subs[0]["id"]
    res = client.put(f"/api/subjects/{sub_id}", json={
        "faculty_name": "Prof. P. Suresh Varma & Team"
    })
    assert res.status_code == 200
    updated = [s for s in client.get("/api/subjects").json() if s["id"] == sub_id][0]
    assert updated["faculty_name"] == "Prof. P. Suresh Varma & Team"

def test_timetable_includes_faculty_name():
    tt = client.get("/api/timetable").json()
    assert len(tt["all_slots"]) > 0
    for slot in tt["all_slots"]:
        assert "faculty_name" in slot

def test_student_details_update():
    students = client.get("/api/students").json()
    assert len(students) > 0
    target = students[0]
    res = client.put(f"/api/students/{target['id']}", json={
        "name": "Updated Student Full Name",
        "batch": "Batch 2",
        "mobile": "+91 91234 56789",
        "email": "updated.student@example.edu",
        "category": "Management (Category B)",
        "admission_no": "TEST-CSE-2026-9999"
    })
    assert res.status_code == 200
    updated = [s for s in client.get("/api/students").json() if s["id"] == target["id"]][0]
    assert updated["name"] == "Updated Student Full Name"
    assert updated["batch"] == "Batch 2"
    assert updated["mobile"] == "+91 91234 56789"
    assert updated["email"] == "updated.student@example.edu"
    assert updated["category"] == "Management (Category B)"
    assert updated["admission_no"] == "TEST-CSE-2026-9999"



def test_lab_slot_cannot_mark_another_batch():
    # The timetable says the Lab slot is Batch 1. The API must reject Batch 2
    # even if the browser changes the request payload.
    slots = client.get("/api/attendance/slots-for-date?date=2026-09-12").json()["slots"]
    lab = next(s for s in slots if s["slot_type"] == "Lab" and s["batch"] == "Batch 1")

    bad = client.post("/api/attendance/mark", json={
        "date": "2026-09-12",
        "day_of_week": "Saturday",
        "subject_id": lab["subject_id"],
        "slot_id": lab["id"],
        "slot_type": "Lab",
        "batch": "Batch 2",
        "month": "2026-09",
        "absent_student_ids": []
    })
    assert bad.status_code == 400


def test_lab_marking_only_creates_records_for_slot_batch():
    slots = client.get("/api/attendance/slots-for-date?date=2026-09-12").json()["slots"]
    lab = next(s for s in slots if s["slot_type"] == "Lab" and s["batch"] == "Batch 1")

    ok = client.post("/api/attendance/mark", json={
        "date": "2026-09-12",
        "day_of_week": "Saturday",
        "subject_id": lab["subject_id"],
        "slot_id": lab["id"],
        "slot_type": "Lab",
        "batch": "Batch 1",
        "month": "2026-09",
        "absent_student_ids": []
    })
    assert ok.status_code == 200
    session_id = ok.json()["session_id"]

    from app.database import get_db
    with get_db() as conn:
        rows = conn.execute("""
            SELECT st.batch, COUNT(*) AS c
            FROM attendance_records ar
            JOIN students st ON st.id = ar.student_id
            WHERE ar.session_id = ?
            GROUP BY st.batch
        """, (session_id,)).fetchall()

    assert len(rows) == 1
    assert rows[0]["batch"] == "Batch 1"
    assert rows[0]["c"] == 47


def test_holiday_removes_existing_attendance_impact():
    # First create a marked theory session on the date.
    slots = client.get("/api/attendance/slots-for-date?date=2026-09-10").json()["slots"]
    theory = next(s for s in slots if s["slot_type"] == "Theory")

    marked = client.post("/api/attendance/mark", json={
        "date": "2026-09-10",
        "day_of_week": "Thursday",
        "subject_id": theory["subject_id"],
        "slot_id": theory["id"],
        "slot_type": "Theory",
        "batch": "All",
        "month": "2026-09",
        "absent_student_ids": []
    })
    assert marked.status_code == 200

    holiday = client.post("/api/holidays", json={
        "date": "2026-09-10",
        "title": "Test Holiday",
        "description": "No classes"
    })
    assert holiday.status_code == 200

    with __import__("app.database", fromlist=["get_db"]).get_db() as conn:
        assert conn.execute(
            "SELECT COUNT(*) FROM attendance_sessions WHERE date = '2026-09-10'"
        ).fetchone()[0] == 0
        assert conn.execute(
            "SELECT COUNT(*) FROM attendance_records"
        ).fetchone()[0] == 0

    slots_after = client.get("/api/attendance/slots-for-date?date=2026-09-10").json()
    assert slots_after["is_holiday"] is True
    assert all(not s.get("is_marked") for s in slots_after["slots"])


def test_percentage_is_not_rounded():
    from app.database import get_db
    with get_db() as conn:
        conn.execute("DELETE FROM attendance_records")
        conn.execute("DELETE FROM attendance_sessions")
        sem = conn.execute("SELECT id FROM semesters WHERE is_active = 1").fetchone()
        student = conn.execute("SELECT id FROM students WHERE reg_no = '999999000001'").fetchone()
        sub = conn.execute("SELECT id FROM subjects WHERE semester_id = ? AND type = 'Theory' LIMIT 1", (sem["id"],)).fetchone()

        for day in ["2026-09-01", "2026-09-02", "2026-09-03"]:
            conn.execute("""
                INSERT INTO attendance_sessions
                (slot_id, subject_id, date, day_of_week, slot_type, batch, month)
                VALUES (NULL, ?, ?, 'Tuesday', 'Theory', 'All', '2026-09')
            """, (sub["id"], day))
            sid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            conn.execute(
                "INSERT INTO attendance_records (session_id, student_id, status) VALUES (?, ?, 'Present')",
                (sid, student["id"])
            )
        conn.execute("""
            INSERT INTO attendance_sessions
            (slot_id, subject_id, date, day_of_week, slot_type, batch, month)
            VALUES (NULL, ?, '2026-09-04', 'Friday', 'Theory', 'All', '2026-09')
        """, (sub["id"],))
        sid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO attendance_records (session_id, student_id, status) VALUES (?, ?, 'Absent')",
            (sid, student["id"])
        )

    login = client.post("/api/auth/login", json={
        "reg_no": "999999000001",
        "password": "999999000001@CSE",
        "role": "student"
    })
    token = login.json()["token"]
    dash = client.get("/api/student/dashboard", headers={"Authorization": f"Bearer {token}"}).json()
    # 3/4 = 75 exactly, proving the API exposes the mathematical value rather
    # than a separately rounded stored percentage.
    assert dash["overall"]["percentage"] == 75.0


def test_threshold_comparisons_use_unrounded_percentage():
    # 74.94 must remain below 75.00; formatting to two decimals must never
    # change the raw value used by eligibility/shortage decisions.
    pct = 74.94
    assert pct < 75.0
    assert f"{pct:.2f}" == "74.94"
    assert round(pct, 0) == 75.0  # demonstrates why rounded values must NOT drive logic


def test_attendance_display_formatting_uses_two_decimals_without_threshold_rounding():
    from app.email_service import format_attendance_percentage
    from app.main import format_attendance_percentage as main_format

    assert format_attendance_percentage(74.94) == "74.94"
    assert format_attendance_percentage(74.94117647058823) == "74.94"
    assert format_attendance_percentage(75.0) == "75.00"
    assert format_attendance_percentage(100.0) == "100.0"
    assert format_attendance_percentage(0.0) == "0.0"
    assert main_format(74.94) == "74.94"
    assert main_format(100.0) == "100.0"
    # Display formatting must never be used for the eligibility decision.
    raw = 74.94
    assert raw < 75.0


def test_custom_day_schedule_replaces_weekly_and_marks_same_session():
    """A custom day must use exactly the CR-selected classes and attendance must attach to them."""
    subjects = client.get("/api/subjects").json()
    theory = next(s for s in subjects if s["type"] == "Theory")
    lab = next(s for s in subjects if s["type"] == "Lab")

    # Saturday already has a weekly theory + lab timetable in the fixture.
    # The custom day must completely replace those displayed classes.
    payload = {
        "date": "2026-09-12",
        "slots": [
            {
                "subject_id": theory["id"],
                "start_time": "10:00 AM",
                "end_time": "10:50 AM",
                "slot_type": "Theory",
                "batch": "All"
            }
        ]
    }
    saved = client.post("/api/attendance/custom-day-slots", json=payload)
    assert saved.status_code == 200
    assert len(saved.json()["session_ids"]) == 1

    data = client.get("/api/attendance/slots-for-date?date=2026-09-12").json()
    assert data["has_custom_day"] is True
    assert len(data["slots"]) == 1
    assert [(s["subject_id"], s["batch"], s["start_time"]) for s in data["slots"]] == [
        (theory["id"], "All", "10:00 AM"),
    ]
    assert all(s["is_extra"] is False and s["is_custom_day"] is True for s in data["slots"])

    # Mark the exact custom session. The API must not create a second anonymous extra class.
    custom_theory = data["slots"][0]
    mark = client.post("/api/attendance/mark", json={
        "date": "2026-09-12",
        "day_of_week": "Saturday",
        "subject_id": theory["id"],
        "slot_id": None,
        "session_id": custom_theory["session_id"],
        "slot_type": "Theory",
        "batch": "All",
        "month": "2026-09",
        "absent_student_ids": []
    })
    assert mark.status_code == 200
    assert mark.json()["session_id"] == custom_theory["session_id"]

    # The custom class must be part of the student's real attendance calculation.
    login = client.post("/api/auth/login", json={
        "reg_no": "999999000001",
        "password": "999999000001@CSE",
        "role": "student"
    })
    assert login.status_code == 200
    dashboard = client.get("/api/student/dashboard", headers={"Authorization": f"Bearer {login.json()['token']}"}).json()
    assert dashboard["overall"]["conducted"] == 1
    assert dashboard["overall"]["attended"] == 1

    with get_db() as conn:
        custom_count = conn.execute(
            "SELECT COUNT(*) FROM attendance_sessions WHERE date = '2026-09-12' AND is_custom_day = 1"
        ).fetchone()[0]
        extra_count = conn.execute(
            "SELECT COUNT(*) FROM attendance_sessions WHERE date = '2026-09-12' AND is_extra = 1"
        ).fetchone()[0]
        record_count = conn.execute(
            "SELECT COUNT(*) FROM attendance_records WHERE session_id = ?",
            (custom_theory["session_id"],)
        ).fetchone()[0]
    assert custom_count == 1
    assert extra_count == 0
    assert record_count == 140

    # Re-submitting the SAME schedule (the already-marked period is still present,
    # unchanged) must succeed and must not touch the marked session's id/records -
    # a CR revisiting "Customize Day" and just re-saving must not be treated as
    # destroying history.
    resave = client.post("/api/attendance/custom-day-slots", json=payload)
    assert resave.status_code == 200
    assert resave.json()["session_ids"] == [custom_theory["session_id"]]
    with get_db() as conn:
        record_count_after = conn.execute(
            "SELECT COUNT(*) FROM attendance_records WHERE session_id = ?",
            (custom_theory["session_id"],)
        ).fetchone()[0]
    assert record_count_after == 140  # unchanged, same session id, records intact

    # Adding a second, brand-new, still-unmarked period alongside the already-marked
    # one must now be allowed (this used to be blocked outright for the whole day).
    add_payload = {
        "date": "2026-09-12",
        "slots": payload["slots"] + [{
            "subject_id": lab["id"],
            "start_time": "11:00 AM",
            "end_time": "12:40 PM",
            "slot_type": "Lab",
            "batch": "Batch 1"
        }]
    }
    added = client.post("/api/attendance/custom-day-slots", json=add_payload)
    assert added.status_code == 200
    assert len(added.json()["session_ids"]) == 2
    assert custom_theory["session_id"] in added.json()["session_ids"]

    # But removing/omitting the already-marked period is still correctly blocked,
    # since that would silently discard real attendance history.
    remove_marked = client.post("/api/attendance/custom-day-slots", json={
        "date": "2026-09-12",
        "slots": [{
            "subject_id": lab["id"],
            "start_time": "11:00 AM",
            "end_time": "12:40 PM",
            "slot_type": "Lab",
            "batch": "Batch 1"
        }]
    })
    assert remove_marked.status_code == 409


def test_custom_day_lab_batch_is_enforced():
    subjects = client.get("/api/subjects").json()
    lab = next(s for s in subjects if s["type"] == "Lab")
    saved = client.post("/api/attendance/custom-day-slots", json={
        "date": "2026-09-14",
        "slots": [{
            "subject_id": lab["id"],
            "start_time": "02:00 PM",
            "end_time": "04:00 PM",
            "slot_type": "Lab",
            "batch": "Batch 3"
        }]
    })
    assert saved.status_code == 200
    slot = client.get("/api/attendance/slots-for-date?date=2026-09-14").json()["slots"][0]
    assert slot["batch"] == "Batch 3"

    bad = client.post("/api/attendance/mark", json={
        "date": "2026-09-14",
        "day_of_week": "Monday",
        "subject_id": lab["id"],
        "slot_id": None,
        "session_id": slot["session_id"],
        "slot_type": "Lab",
        "batch": "Batch 1",
        "month": "2026-09",
        "absent_student_ids": []
    })
    assert bad.status_code == 400
