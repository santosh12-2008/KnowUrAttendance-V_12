import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
_staff_login = client.post("/api/auth/login", json={"reg_no":"test_cr","password":"TestCR!123456","role":"cr"})
assert _staff_login.status_code == 200, _staff_login.text
client.headers.update({"Authorization": f"Bearer {_staff_login.json()['token']}"})

def test_reset_database():
    res = client.post("/api/setup/reset")
    assert res.status_code == 200
    assert res.json()["status"] == "success"

    # Verify student list is empty
    stu_res = client.get("/api/students")
    assert stu_res.status_code == 200
    assert len(stu_res.json()) == 0

def test_full_setup_wizard():
    payload = {
        "semester": {
            "name": "B.Tech CSE - 3rd Year 1st Sem (3-1)",
            "start_month": "2026-07",
            "end_month": "2026-11",
            "active_month": "2026-09"
        },
        "subjects": [
            { "code": "CS3101", "name": "Database Management Systems", "type": "Theory", "faculty_name": "Dr. Rao" },
            { "code": "CS3106", "name": "DBMS Laboratory", "type": "Lab", "faculty_name": "Dr. Rao & Team" }
        ],
        "timetable": [
            { "day_of_week": "Monday", "start_time": "09:00 AM", "end_time": "09:50 AM", "subject_id": 1, "slot_type": "Theory", "batch": "All" },
            { "day_of_week": "Monday", "start_time": "01:30 PM", "end_time": "04:00 PM", "subject_id": 2, "slot_type": "Lab", "batch": "Batch 1" }
        ],
        "batch_ranges": [
            { "batch_name": "Batch 1", "start_reg_no": "999999000001", "end_reg_no": "999999000047" },
            { "batch_name": "Batch 2", "start_reg_no": "999999000048", "end_reg_no": "999999000094" },
            { "batch_name": "Batch 3", "start_reg_no": "999999000095", "end_reg_no": "999999000140" }
        ],
        "students": [
            {
                "reg_no": "999999000001",
                "name": "Example Student",
                "batch": "Batch 1",
                "mobile": "+91 90000 00001",
                "email": "student.999999000001@example.edu",
                "category": "Convener (EAPCET)",
                "admission_no": "TEST-CSE-2026-0028"
            }
        ]
    }

    res = client.post("/api/setup/full", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["subjects_count"] == 2
    assert data["slots_count"] == 2
    assert data["batch_ranges_count"] == 3
    assert data["students_count"] == 1

def test_bulk_student_import_auto_batch():
    # Import students without specifying batch, should auto-assign based on ranges
    bulk_payload = {
        "students": [
            { "reg_no": "999999000010", "name": "Example Student 10", "batch": "", "mobile": "9000000010", "email": "" },
            { "reg_no": "999999000060", "name": "Example Student 60", "batch": "", "mobile": "9000000060", "email": "" },
            { "reg_no": "999999000110", "name": "Example Student 110", "batch": "", "mobile": "9000000110", "email": "" }
        ]
    }

    res = client.post("/api/students/bulk-import", json=bulk_payload)
    assert res.status_code == 200
    assert res.json()["inserted_count"] == 3

    # Check students and their assigned batches
    stu_res = client.get("/api/students")
    students = stu_res.json()
    s_map = {s["reg_no"]: s for s in students}

    assert s_map["999999000010"]["batch"] == "Batch 1"
    assert s_map["999999000060"]["batch"] == "Batch 2"
    assert s_map["999999000110"]["batch"] == "Batch 3"

def test_load_template():
    res = client.post("/api/setup/load-template")
    assert res.status_code == 200
    assert res.json()["status"] == "success"
