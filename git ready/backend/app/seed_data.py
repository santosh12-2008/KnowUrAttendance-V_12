import sqlite3
from datetime import datetime
from app.database import get_db

def load_au_cse_template(conn: sqlite3.Connection):
    """
    Loads the standard AUCE(A) CSE 2-1 template structure, taken from the official
    "TENTATIVE TIME TABLE" circular (Class: 2/4 B.Tech (CSE), I Sem, Room No: FFCL-5,
    revised 15-09-2026):
    - Semester: B.Tech CSE - 2nd Year I Sem (2-1)
    - 10 Standard Subjects (5 Theory + 4 Labs + 1 self-study/online)
    - Standard Weekly Timetable (Monday to Saturday, Theory & Labs)
    - Placeholder batch ranges (CR must fill in the real registration-number ranges,
      since these differ every admission year)
    Does NOT populate any student roster or fake attendance records - the CR remains
    the true data source for that. Only the parts that are the same on the printed
    timetable every year are pre-filled.
    """
    cursor = conn.cursor()

    # Clear existing
    cursor.execute("DELETE FROM attendance_records;")
    cursor.execute("DELETE FROM attendance_sessions;")
    cursor.execute("DELETE FROM students;")
    cursor.execute("DELETE FROM batch_ranges;")
    cursor.execute("DELETE FROM timetable_slots;")
    cursor.execute("DELETE FROM subjects;")
    cursor.execute("DELETE FROM semesters;")

    # 1. Semester
    cursor.execute("""
        INSERT INTO semesters (academic_year, name, start_month, end_month, active_month, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
    """, (
        "2026-2027",
        "B.Tech CSE - 2nd Year I Sem (2-1)",
        "2026-08",
        "2026-12",
        "2026-09"
    ))
    semester_id = cursor.lastrowid

    # 2. Subjects (codes/faculty exactly as printed on the timetable circular)
    subjects_data = [
        ("CS2101", "Discrete Mathematical Structures", "Theory", "Dr. Ch. Swapna (TTA)"),
        ("CS2102", "Computer Organization and Architecture", "Theory", "Dr. K. Rajakumar"),
        ("CS2103", "Probability, Statistics and Queuing Theory", "Theory", "Ms. Radha Kumari (TTA)"),
        ("CS2104", "Operating Systems", "Theory", "Prof. S. Vizinanda Row"),
        ("CS2105", "Object Oriented Programming through Java", "Theory", "Prof. K. Venkat Rao"),
        ("CS2110", "Environmental Science", "Theory", "Self Study"),
        ("CS2106", "Computer Organization and Architecture Lab", "Lab", "Mr. P. Mahesh (TTA)"),
        ("CS2107", "Object Oriented Programming through Java Lab", "Lab", "Ms. P. V. Aruna Sri (TTA)"),
        ("CS2108", "Operating Systems Lab", "Lab", "Prof. S. Vizinanda Row / Mr. R. Venkata Ramana (RS)"),
        ("CS2109", "Intellectual Property Rights", "Theory", "HSS Department (Online)"),
    ]

    subject_id_map = {}
    for code, name, stype, faculty in subjects_data:
        cursor.execute("""
            INSERT INTO subjects (semester_id, code, name, type, faculty_name)
            VALUES (?, ?, ?, ?, ?)
        """, (semester_id, code, name, stype, faculty))
        subject_id_map[code] = cursor.lastrowid

    # 3. Batch Ranges - left as clear placeholders. Registration-number prefixes change
    #    every admission year/branch, so guessing a real-looking one here would be worse
    #    than an obvious placeholder the CR is expected to replace in Step 4.
    ranges = [
        ("Batch 1", "", ""),
        ("Batch 2", "", ""),
        ("Batch 3", "", ""),
    ]
    for bname, sreg, ereg in ranges:
        cursor.execute("""
            INSERT INTO batch_ranges (semester_id, batch_name, start_reg_no, end_reg_no)
            VALUES (?, ?, ?, ?)
        """, (semester_id, bname, sreg, ereg))

    # 4. Weekly Timetable Slots.
    # Only real, attendance-tracked subjects are represented here (Theory/Lab periods that
    # appear in the subjects table above). Non-academic blocks printed on the same circular
    # (NCC/NSS, Remedial Class, Swatch Bharat, Library/Self Study) aren't subjects with a
    # faculty in-charge, so they're intentionally left off the attendance timetable.
    # Where the circular shows two/three labs running in parallel for different batches in
    # the same slot (e.g. "COA LAB-1/OS LAB-3"), each batch gets its own row.
    slots = [
        ("Monday", "09:00 AM", "09:50 AM", subject_id_map["CS2103"], "Theory", "All"),
        ("Monday", "10:40 AM", "12:20 PM", subject_id_map["CS2106"], "Lab", "Batch 1"),
        ("Monday", "10:40 AM", "12:20 PM", subject_id_map["CS2108"], "Lab", "Batch 3"),
        ("Tuesday", "09:00 AM", "10:40 AM", subject_id_map["CS2107"], "Lab", "Batch 3"),
        ("Tuesday", "10:40 AM", "12:20 PM", subject_id_map["CS2105"], "Theory", "All"),
        ("Tuesday", "01:30 PM", "03:10 PM", subject_id_map["CS2103"], "Theory", "All"),
        ("Wednesday", "09:00 AM", "10:40 AM", subject_id_map["CS2104"], "Theory", "All"),
        ("Wednesday", "10:40 AM", "12:20 PM", subject_id_map["CS2101"], "Theory", "All"),
        ("Thursday", "09:00 AM", "10:40 AM", subject_id_map["CS2104"], "Theory", "All"),
        ("Thursday", "10:40 AM", "12:20 PM", subject_id_map["CS2105"], "Theory", "All"),
        ("Friday", "09:00 AM", "10:40 AM", subject_id_map["CS2102"], "Theory", "All"),
        ("Friday", "10:40 AM", "12:20 PM", subject_id_map["CS2101"], "Theory", "All"),
        ("Friday", "01:30 PM", "03:10 PM", subject_id_map["CS2108"], "Lab", "Batch 1"),
        ("Friday", "01:30 PM", "03:10 PM", subject_id_map["CS2107"], "Lab", "Batch 2"),
        ("Saturday", "09:00 AM", "10:40 AM", subject_id_map["CS2102"], "Theory", "All"),
        ("Saturday", "10:40 AM", "12:20 PM", subject_id_map["CS2106"], "Lab", "Batch 2"),
        ("Saturday", "01:30 PM", "03:10 PM", subject_id_map["CS2108"], "Lab", "Batch 2"),
        ("Saturday", "01:30 PM", "03:10 PM", subject_id_map["CS2107"], "Lab", "Batch 1"),
        ("Saturday", "01:30 PM", "03:10 PM", subject_id_map["CS2106"], "Lab", "Batch 3"),
    ]

    for dow, stime, etime, sub_id, stype, bname in slots:
        cursor.execute("""
            INSERT INTO timetable_slots (semester_id, day_of_week, start_time, end_time, subject_id, slot_type, batch)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (semester_id, dow, stime, etime, sub_id, stype, bname))

    return {
        "semester_id": semester_id,
        "subjects_count": len(subjects_data),
        "slots_count": len(slots),
        "batch_ranges_count": len(ranges)
    }

def seed_database_if_empty():
    """
    Ensure at least a minimal semester exists so API doesn't 404 on clean boot.
    CR has complete control to edit, reset, or populate via the setup wizard.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM semesters")
        count = cursor.fetchone()[0]
        if count == 0:
            load_au_cse_template(conn)
