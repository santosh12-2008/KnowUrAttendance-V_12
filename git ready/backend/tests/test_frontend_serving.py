import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db, reset_academic_data

client = TestClient(app)
_staff_login = client.post("/api/auth/login", json={"reg_no":"test_cr","password":"TestCR!123456","role":"cr"})
assert _staff_login.status_code == 200, _staff_login.text
client.headers.update({"Authorization": f"Bearer {_staff_login.json()['token']}"})

@pytest.fixture(autouse=True)
def setup_frontend_test_data():
    with get_db() as conn:
        reset_academic_data(conn)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO semesters (name, start_month, end_month, active_month, is_active)
            VALUES ('B.Tech CSE - 3rd Year 1st Sem (3-1)', '2026-07', '2026-11', '2026-09', 1)
        """)
        sem_id = cursor.lastrowid
        cursor.execute("INSERT INTO subjects (semester_id, code, name, type, faculty_name) VALUES (?, 'CS3101', 'Database Management Systems', 'Theory', 'Dr. Rao')", (sem_id,))
        sub_id = cursor.lastrowid
        cursor.execute("""
            INSERT INTO students (reg_no, name, batch, mobile, email, category, admission_no, semester_id)
            VALUES ('999999000001', 'Example Student', 'Batch 1', '+91 90000 00001', 'student@example.edu', 'Convener (EAPCET)', 'TEST-CSE-2026-0028', ?)
        """, (sem_id,))
        stu_id = cursor.lastrowid

        # Insert 1 session
        cursor.execute("""
            INSERT INTO attendance_sessions (slot_id, subject_id, date, day_of_week, slot_type, batch, month)
            VALUES (NULL, ?, '2026-09-10', 'Thursday', 'Theory', 'All', '2026-09')
        """, (sub_id,))
        sess_id = cursor.lastrowid
        cursor.execute("INSERT INTO attendance_records (session_id, student_id, status) VALUES (?, ?, 'Present')", (sess_id, stu_id))

def test_root_serves_frontend_html():
    if not (Path(__file__).resolve().parents[2] / "frontend" / "dist" / "index.html").exists():
        pytest.skip("frontend/dist is a build artifact and is not committed to source control")
    res = client.get("/")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "KnowUrAttendance" in res.text

def test_au_logo_serving():
    res = client.get("/au-logo.jpg")
    assert res.status_code == 200
    assert "image/jpeg" in res.headers["content-type"]
    assert len(res.content) > 10000

def test_attendance_marking_dynamic_update():
    # Student 999999000001
    # 1. Fetch initial dashboard
    login_res = client.post("/api/auth/login", json={
        "reg_no": "999999000001",
        "password": "999999000001@CSE",
        "role": "student"
    })
    token = login_res.json()["token"]
    student_id = login_res.json()["user_id"]

    res_before = client.get("/api/student/dashboard", headers={"Authorization": f"Bearer {token}"})
    initial_conducted = res_before.json()["overall"]["conducted"]
    initial_attended = res_before.json()["overall"]["attended"]

    # 2. CR marks a new attendance session for today where 999999000001 is marked Absent
    mark_res = client.post("/api/attendance/mark", json={
        "date": "2026-09-12",
        "day_of_week": "Saturday",
        "subject_id": 1,
        "slot_id": None,
        "slot_type": "Theory",
        "batch": "All",
        "month": "2026-09",
        "absent_student_ids": [student_id]
    })
    assert mark_res.status_code == 200
    data = mark_res.json()
    assert data["status"] == "success"

    # 3. Fetch updated student dashboard - conducted increases by 1, attended remains same
    res_after = client.get("/api/student/dashboard", headers={"Authorization": f"Bearer {token}"})
    updated_conducted = res_after.json()["overall"]["conducted"]
    updated_attended = res_after.json()["overall"]["attended"]

    assert updated_conducted == initial_conducted + 1
    assert updated_attended == initial_attended
