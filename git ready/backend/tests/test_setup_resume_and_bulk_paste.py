"""
Covers the three CR Setup Wizard problems fixed in this revision:
  1. /api/setup/full must upsert (not wipe-and-recreate) so re-running the wizard to finish
     an incomplete step never loses previously-saved data.
  2. /api/setup/status must report exactly what's saved and which step is still incomplete,
     so the wizard can resume instead of restarting from Step 1.
  3. The tabular roster parser used by /api/students/smart-import must handle a real
     Excel/Sheets paste: blank cells in the middle of a row, a header row in any column
     order, and the department's default column order when there's no header.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app, _parse_tabular_roster

client = TestClient(app)
_staff_login = client.post("/api/auth/login", json={"reg_no":"test_cr","password":"TestCR!123456","role":"cr"})
assert _staff_login.status_code == 200, _staff_login.text
client.headers.update({"Authorization": f"Bearer {_staff_login.json()['token']}"})


def _base_payload(**overrides):
    payload = {
        "semester": {
            "name": "B.Tech CSE - 2nd Year I Sem (2-1)",
            "start_month": "2026-08",
            "end_month": "2026-12",
            "active_month": "2026-09"
        },
        "subjects": [],
        "timetable": [],
        "batch_ranges": [],
        "students": []
    }
    payload.update(overrides)
    return payload


def test_setup_full_is_non_destructive_across_partial_submits():
    """Simulates a CR finishing Step 2 (subjects) in one visit, then coming back later
    to finish Step 5 (students) without resubmitting subjects/timetable - both must survive."""
    client.post("/api/setup/reset")

    step_a = _base_payload(subjects=[
        {"code": "CS2101", "name": "Discrete Mathematical Structures", "type": "Theory", "faculty_name": "Dr. Swapna"}
    ])
    res_a = client.post("/api/setup/full", json=step_a)
    assert res_a.status_code == 200
    assert res_a.json()["subjects_count"] == 1

    # Second visit: only students this time, subjects/timetable payload empty.
    step_b = _base_payload(students=[
        {"reg_no": "999999000001", "name": "Example Student", "batch": "Batch 1"}
    ])
    res_b = client.post("/api/setup/full", json=step_b)
    assert res_b.status_code == 200
    assert res_b.json()["students_count"] == 1

    status = client.get("/api/setup/status").json()
    assert status["has_active_semester"] is True
    assert len(status["subjects"]) == 1, "subjects from the first visit must not be wiped by the second"
    assert status["students_count"] == 1
    # subjects exist, timetable/batch_ranges still empty -> next incomplete step is 3
    assert status["next_step"] == 3


def test_setup_status_reports_next_step_5_once_everything_but_students_is_done():
    client.post("/api/setup/reset")
    payload = _base_payload(
        subjects=[{"code": "CS2101", "name": "DMS", "type": "Theory", "faculty_name": "Dr. Swapna"}],
        timetable=[{"day_of_week": "Monday", "start_time": "09:00 AM", "end_time": "10:40 AM",
                     "subject_code": "CS2101", "slot_type": "Theory", "batch": "All"}],
        batch_ranges=[{"batch_name": "Batch 1", "start_reg_no": "999999000001", "end_reg_no": "999999000047"}],
    )
    res = client.post("/api/setup/full", json=payload)
    assert res.status_code == 200

    status = client.get("/api/setup/status").json()
    assert status["next_step"] == 5
    # timetable slot must have been linked to the real subject by code, not a guessed id
    assert status["timetable"][0]["subject_code"] == "CS2101"


def test_setup_status_reports_step_1_when_nothing_saved_yet():
    client.post("/api/setup/reset")
    status = client.get("/api/setup/status").json()
    assert status["has_active_semester"] is False
    assert status["next_step"] == 1


# ---------------------------------------------------------------------------
# Tabular roster paste parsing
# ---------------------------------------------------------------------------

def test_tabular_parser_handles_header_in_default_order_with_blank_cells():
    raw = (
        "Name of the Candidate\tRegistration Number\tMobile Number\tAdmn.No\tEmail Address\tCategory of admission\n"
        "Example Student\t999999000001\t9000000001\t\tstudent@example.edu\tConvener (EAPCET)\n"
        "Example Student 2\t999999000002\t\t\t\t\n"
    )
    result = _parse_tabular_roster(raw, ranges=[])
    records = {r["reg_no"]: r for r in result["records"]}
    assert len(records) == 2
    assert records["999999000001"]["name"] == "Example Student"
    assert records["999999000001"]["mobile"] == "9000000001"
    # Blank mobile/admission/email/category on row 2 must NOT shift into other fields.
    assert records["999999000002"]["name"] == "Example Student 2"
    assert records["999999000002"]["mobile"] == ""
    assert records["999999000002"]["email"].startswith("999999000002@")


def test_tabular_parser_handles_reordered_header():
    raw = (
        "Registration Number,Name of the Candidate,Category of admission,Mobile Number\n"
        "999999000030,P Ramesh,Management (Category B),9000000001\n"
    )
    result = _parse_tabular_roster(raw, ranges=[])
    assert len(result["records"]) == 1
    r = result["records"][0]
    assert r["reg_no"] == "999999000030"
    assert r["name"] == "P Ramesh"
    assert r["mobile"] == "9000000001"


def test_tabular_parser_falls_back_to_default_order_with_no_header():
    raw = "P Ramesh\t999999000031\t9000000002\t\t\t\n"
    result = _parse_tabular_roster(raw, ranges=[])
    assert len(result["records"]) == 1
    r = result["records"][0]
    assert r["name"] == "P Ramesh"
    assert r["reg_no"] == "999999000031"


def test_tabular_parser_reports_skipped_rows_with_reasons():
    raw = (
        "Name of the Candidate\tRegistration Number\n"
        "Bad Row\t12345\n"          # not 12 digits
        "\t999999000032\n"          # missing name
    )
    result = _parse_tabular_roster(raw, ranges=[])
    assert len(result["records"]) == 0
    assert len(result["skipped"]) == 2


def test_tabular_parser_returns_none_for_freeform_notes():
    # Free-text WhatsApp-style notes should NOT be treated as a table.
    raw = "999999000001 Example Student 9000000001 Batch 1"
    assert _parse_tabular_roster(raw, ranges=[]) is None
