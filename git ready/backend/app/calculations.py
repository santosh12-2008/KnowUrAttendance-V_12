from typing import Dict, Any, List
import sqlite3

def get_percentage_color(percentage: float) -> str:
    """
    Returns color token based on percentage:
    > 90: green
    > 75 and <= 90: orange
    < 75: red
    """
    if percentage > 90.0:
        return "green"
    elif percentage > 75.0:
        return "orange"
    else:
        return "red"


def _distinct_conducted_session_count(conn: sqlite3.Connection, semester_id: int, month_filter: str = None, subject_id: int = None) -> int:
    """Count real conducted sessions while collapsing exact legacy timed duplicates.

    Untimed legacy rows remain distinct because there is no safe period identity to merge.
    """
    cursor = conn.cursor()
    clauses = [
        "sub.semester_id = ?",
        "(a.is_cancelled IS NULL OR a.is_cancelled = 0)",
        "a.id IN (SELECT DISTINCT session_id FROM attendance_records)"
    ]
    params = [semester_id]
    if month_filter and month_filter != "all":
        clauses.append("a.month = ?")
        params.append(month_filter)
    if subject_id is not None:
        clauses.append("a.subject_id = ?")
        params.append(subject_id)
    cursor.execute(f"""
        SELECT a.id, a.date, a.subject_id, a.slot_type, a.batch, a.start_time, a.end_time
        FROM attendance_sessions a
        JOIN subjects sub ON sub.id = a.subject_id
        WHERE {' AND '.join(clauses)}
    """, params)
    unique = set()
    for row in cursor.fetchall():
        start = str(row["start_time"] or "").strip().upper().replace(".", ":")
        end = str(row["end_time"] or "").strip().upper().replace(".", ":")
        if not start and not end:
            key = ("legacy", row["id"])
        else:
            key = (row["date"], row["subject_id"], (row["slot_type"] or "Theory").strip(),
                   (row["batch"] or "All").strip(), start, end)
        unique.add(key)
    return len(unique)

def calculate_student_attendance(conn: sqlite3.Connection, student_id: int, month_filter: str = None) -> Dict[str, Any]:
    """
    Calculates dynamic attendance for a single student:
    - Overall attendance (conducted, attended, missed, percentage, color)
    - Subject-wise attendance breakdown
    - Monthly breakdown
    Percentages are dynamically computed, never pulled from static storage.
    """
    cursor = conn.cursor()

    # Get student info
    cursor.execute("SELECT * FROM students WHERE id = ?", (student_id,))
    student = cursor.fetchone()
    if not student:
        return None

    student_batch = student["batch"]
    student_category = student["category"]
    joining_date = student["joining_date"]
    semester_id = student["semester_id"]

    # Registration numbers 125+ are always lateral. Each lateral student may have
    # an individual joining date; the semester date is only the fallback/default.
    effective_joining_date = None
    try:
        is_lateral = int(str(student["reg_no"])[-3:]) >= 125
    except Exception:
        is_lateral = student_category == "Lateral Entry"
    if is_lateral:
        cursor.execute("SELECT lateral_joining_date FROM semesters WHERE id = ?", (semester_id,))
        sem_row = cursor.fetchone()
        effective_joining_date = (joining_date or (sem_row["lateral_joining_date"] if sem_row else None) or "2026-08-02").strip()

    # Fetch subjects
    cursor.execute("""
        SELECT * FROM subjects 
        WHERE semester_id = ? 
        ORDER BY type DESC, code ASC
    """, (semester_id,))
    subjects = cursor.fetchall()

    month_clause = ""
    query_params = [student_id, student_batch]
    
    # Lateral entry protection: only consider sessions on or after joining date
    date_clause = ""
    if effective_joining_date:
        date_clause = " AND s.date >= ?"
        query_params.append(effective_joining_date)

    if month_filter and month_filter != "all":
        month_clause = " AND s.month = ?"
        query_params.append(month_filter)

    # Get all conducted sessions relevant to this student
    # A session strictly counts towards a student's conducted total ONLY if
    # the student was actually marked in that session, ensuring Lab sessions of one batch
    # (e.g. Batch 1) are never added to conducted classes of another batch (e.g. Batch 2)
    query = f"""
        SELECT 
            s.id AS session_id,
            s.subject_id,
            s.date,
            s.day_of_week,
            s.slot_type,
            s.batch,
            s.month,
            s.start_time,
            s.end_time,
            r.status AS status
        FROM attendance_sessions s
        JOIN attendance_records r ON r.session_id = s.id AND r.student_id = ?
        WHERE (UPPER(TRIM(s.batch)) = 'ALL' OR UPPER(TRIM(s.batch)) = UPPER(TRIM(?)))
        AND (s.is_cancelled IS NULL OR s.is_cancelled = 0)
        {date_clause}
        {month_clause}
        ORDER BY s.date DESC
    """
    
    cursor.execute(query, query_params)
    raw_sessions = cursor.fetchall()

    # Defensive read-time deduplication for legacy duplicate attendance sessions. This
    # never deletes or rewrites historical rows. Exact same-day subject/type/batch
    # sessions are treated as one real class for a student's totals; if duplicate rows
    # disagree, Present wins because one positive record is sufficient to establish
    # that the student attended that class.
    unique = {}
    for row in raw_sessions:
        start = str(row["start_time"] or "").strip().upper().replace(".", ":")
        end = str(row["end_time"] or "").strip().upper().replace(".", ":")
        # Older/imported sessions may legitimately have no timing metadata. Do not
        # collapse those merely because they share a date/subject; only timed sessions
        # can be confidently identified as exact duplicate timetable periods.
        if not start and not end:
            key = ("legacy-session", row["session_id"])
        else:
            key = (row["date"], row["subject_id"], (row["slot_type"] or "Theory").strip(),
                   (row["batch"] or "All").strip(), start, end)
        prev = unique.get(key)
        if prev is None or (prev["status"] != "Present" and row["status"] == "Present"):
            unique[key] = row
    sessions = list(unique.values())

    total_conducted = len(sessions)
    total_attended = sum(1 for s in sessions if s["status"] == "Present")
    total_missed = total_conducted - total_attended
    overall_percentage = (total_attended / total_conducted * 100.0) if total_conducted > 0 else 0.0

    # Calculate target classes needed to reach 75% or 90%
    # Threshold planning is based on exact attendance counts, never on a rounded
    # percentage.  Find the smallest integer x such that:
    #   (attended + x) / (conducted + x) >= target.
    classes_for_75 = 0
    if total_conducted > 0 and (total_attended * 100) < (75 * total_conducted):
        classes_for_75 = max(0, 3 * total_conducted - 4 * total_attended)

    classes_for_90 = 0
    if total_conducted > 0 and (total_attended * 100) < (90 * total_conducted):
        classes_for_90 = max(0, 9 * total_conducted - 10 * total_attended)

    # Subject-wise calculation
    subject_map = {}
    for sub in subjects:
        sub_id = sub["id"]
        sub_sessions = [s for s in sessions if s["subject_id"] == sub_id]
        conducted = len(sub_sessions)
        attended = sum(1 for s in sub_sessions if s["status"] == "Present")
        missed = conducted - attended
        pct = (attended / conducted * 100.0) if conducted > 0 else 0.0
        color = get_percentage_color(pct) if conducted > 0 else "neutral"

        subject_map[sub_id] = {
            "id": sub_id,
            "code": sub["code"],
            "name": sub["name"],
            "type": sub["type"],
            "faculty_name": sub["faculty_name"] or "Faculty",
            "conducted": conducted,
            "attended": attended,
            "missed": missed,
            "percentage": pct,
            "color": color
        }

    return {
        "student": {
            "id": student["id"],
            "reg_no": student["reg_no"],
            "name": student["name"],
            "email": student["email"],
            "mobile": student["mobile"],
            "batch": student["batch"],
            "category": student["category"],
            "admission_no": student["admission_no"],
            "joining_date": effective_joining_date,
            "semester_id": student["semester_id"],
            "is_dropped": bool(student["is_dropped"]) if "is_dropped" in student.keys() else False,
            "dropped_reason": student["dropped_reason"] if "dropped_reason" in student.keys() else None,
            "dropped_date": student["dropped_date"] if "dropped_date" in student.keys() else None
        },
        "overall": {
            "conducted": total_conducted,
            "attended": total_attended,
            "missed": total_missed,
            "percentage": overall_percentage,
            "color": get_percentage_color(overall_percentage) if total_conducted > 0 else "neutral",
            "classes_for_75": classes_for_75,
            "classes_for_90": classes_for_90
        },
        "subjects": list(subject_map.values()),
        "recent_sessions": [dict(s) for s in sessions[:15]],
        "cancelled_sessions": [dict(c) for c in conn.cursor().execute("""
            SELECT s.id, s.date, s.day_of_week, s.slot_type, s.cancellation_reason, sub.name as subject_name, sub.code as subject_code
            FROM attendance_sessions s
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE (UPPER(TRIM(s.batch)) = 'ALL' OR UPPER(TRIM(s.batch)) = UPPER(TRIM(?))) AND s.is_cancelled = 1
            ORDER BY s.date DESC LIMIT 5
        """, (student_batch,)).fetchall()]
    }

def calculate_class_overview(conn: sqlite3.Connection, semester_id: int, month_filter: str = None) -> Dict[str, Any]:
    """
    Computes class-wide metrics:
    - Average attendance %
    - Distribution (>90%, 75-90%, <75%)
    - Student list with dynamic attendance percentages (active + dropped indicator)
    """
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM students WHERE semester_id = ? ORDER BY reg_no ASC", (semester_id,))
    students = cursor.fetchall()

    student_stats = []
    total_class_conducted = 0
    total_class_attended = 0

    count_safe = 0      # > 90%
    count_moderate = 0  # 75 - 90%
    count_shortage = 0  # < 75%

    for s in students:
        is_dropped = bool(s["is_dropped"]) if "is_dropped" in s.keys() else False
        s_data = calculate_student_attendance(conn, s["id"], month_filter)
        ov = s_data["overall"]
        pct = ov["percentage"]

        if not is_dropped:
            total_class_conducted += ov["conducted"]
            total_class_attended += ov["attended"]
            if ov["conducted"] > 0:
                if pct > 90.0:
                    count_safe += 1
                elif pct > 75.0:
                    count_moderate += 1
                else:
                    count_shortage += 1

        student_stats.append({
            "id": s["id"],
            "reg_no": s["reg_no"],
            "reg_no_last3": s["reg_no"][-3:] if len(s["reg_no"]) >= 3 else s["reg_no"],
            "name": s["name"],
            "batch": s["batch"],
            "mobile": s["mobile"],
            "email": s["email"],
            "category": s["category"],
            "admission_no": s["admission_no"],
            "joining_date": s["joining_date"] if "joining_date" in s.keys() else None,
            "conducted": ov["conducted"],
            "attended": ov["attended"],
            "missed": ov["missed"],
            "percentage": pct,
            "color": ov["color"],
            "is_dropped": is_dropped,
            "dropped_reason": s["dropped_reason"] if "dropped_reason" in s.keys() else None,
            "dropped_date": s["dropped_date"] if "dropped_date" in s.keys() else None
        })

    active_students_count = sum(1 for s in students if not (bool(s["is_dropped"]) if "is_dropped" in s.keys() else False))
    class_average = (total_class_attended / total_class_conducted * 100.0) if total_class_conducted > 0 else 0.0

    distinct_sessions_count = _distinct_conducted_session_count(conn, semester_id, month_filter)

    return {
        "class_average": class_average,
        "total_students": len(students),
        "active_students": active_students_count,
        "total_sessions_count": distinct_sessions_count,
        "distribution": {
            "safe_above_90": count_safe,
            "moderate_75_90": count_moderate,
            "shortage_below_75": count_shortage
        },
        "students": student_stats
    }

def calculate_class_statistics(conn: sqlite3.Connection, semester_id: int, month_filter: str = None) -> Dict[str, Any]:
    """
    Computes deep class statistics for CR and Students (academic unity focused):
    - Overall class attendance %
    - Subject-wise class attendance average %
    - Lab Batch distribution (Batch 1, Batch 2, Batch 3)
    - Condonation distribution
    Note: Category-wise percentages removed to preserve class unity.
    """
    cursor = conn.cursor()

    # Get subjects
    cursor.execute("SELECT * FROM subjects WHERE semester_id = ? ORDER BY type DESC, code ASC", (semester_id,))
    subjects = [dict(s) for s in cursor.fetchall()]

    # Get active non-dropped students only
    cursor.execute("""
        SELECT * FROM students 
        WHERE semester_id = ? AND (is_dropped IS NULL OR is_dropped = 0) 
        ORDER BY reg_no ASC
    """, (semester_id,))
    students = cursor.fetchall()

    total_students = len(students)
    if total_students == 0:
        return {
            "class_average": 0.0,
            "color": "neutral",
            "total_students": 0,
            "total_distinct_sessions": 0,
            "distribution": {"safe_above_90": 0, "moderate_75_90": 0, "shortage_below_75": 0},
            "subjects": [],
            "categories": [],
            "batches": []
        }

    subject_aggregates = {
        s["id"]: {
            "id": s["id"],
            "code": s["code"],
            "name": s["name"],
            "type": s["type"],
            "faculty_name": s["faculty_name"] or "Faculty",
            "total_possible": 0,
            "total_attended": 0,
            "sessions_count": 0
        }
        for s in subjects
    }

    month_clause = " AND month = ?" if (month_filter and month_filter != "all") else ""
    month_params = [month_filter] if (month_filter and month_filter != "all") else []

    for s in subjects:
        subject_aggregates[s["id"]]["sessions_count"] = _distinct_conducted_session_count(
            conn, semester_id, month_filter, s["id"]
        )

    category_stats = {}
    batch_stats = {
        "Batch 1": {"attended": 0, "conducted": 0, "count": 0},
        "Batch 2": {"attended": 0, "conducted": 0, "count": 0},
        "Batch 3": {"attended": 0, "conducted": 0, "count": 0}
    }
    
    total_class_conducted = 0
    total_class_attended = 0

    count_safe = 0
    count_moderate = 0
    count_shortage = 0

    for s in students:
        s_data = calculate_student_attendance(conn, s["id"], month_filter)
        ov = s_data["overall"]
        total_class_conducted += ov["conducted"]
        total_class_attended += ov["attended"]

        pct = ov["percentage"]
        if ov["conducted"] > 0:
            if pct > 90.0:
                count_safe += 1
            elif pct > 75.0:
                count_moderate += 1
            else:
                count_shortage += 1

        cat = s["category"] or "EAPCET Admission"
        if cat not in category_stats:
            category_stats[cat] = {"attended": 0, "conducted": 0, "count": 0}
        category_stats[cat]["count"] += 1
        category_stats[cat]["attended"] += ov["attended"]
        category_stats[cat]["conducted"] += ov["conducted"]

        b = s["batch"] or "Batch 1"
        if b not in batch_stats:
            batch_stats[b] = {"attended": 0, "conducted": 0, "count": 0}
        batch_stats[b]["count"] += 1
        batch_stats[b]["attended"] += ov["attended"]
        batch_stats[b]["conducted"] += ov["conducted"]

        for sub in s_data["subjects"]:
            sub_id = sub["id"]
            if sub_id in subject_aggregates:
                subject_aggregates[sub_id]["total_possible"] += sub["conducted"]
                subject_aggregates[sub_id]["total_attended"] += sub["attended"]

    class_average = (total_class_attended / total_class_conducted * 100.0) if total_class_conducted > 0 else 0.0

    subject_results = []
    for s_id, data in subject_aggregates.items():
        poss = data["total_possible"]
        att = data["total_attended"]
        sub_pct = (att / poss * 100.0) if poss > 0 else 0.0
        subject_results.append({
            "id": data["id"],
            "code": data["code"],
            "name": data["name"],
            "type": data["type"],
            "faculty_name": data["faculty_name"],
            "sessions_count": data["sessions_count"],
            "average_percentage": sub_pct,
            "color": get_percentage_color(sub_pct) if poss > 0 else "neutral"
        })

    category_results = []
    for cat_name, c_data in category_stats.items():
        c_pct = (c_data["attended"] / c_data["conducted"] * 100.0) if c_data["conducted"] > 0 else 0.0
        category_results.append({
            "category": cat_name,
            "student_count": c_data["count"],
            "average_percentage": c_pct,
            "color": get_percentage_color(c_pct) if c_data["conducted"] > 0 else "neutral"
        })

    batch_results = []
    for b_name, b_data in batch_stats.items():
        b_pct = (b_data["attended"] / b_data["conducted"] * 100.0) if b_data["conducted"] > 0 else 0.0
        batch_results.append({
            "batch": b_name,
            "student_count": b_data["count"],
            "average_percentage": b_pct,
            "color": get_percentage_color(b_pct) if b_data["conducted"] > 0 else "neutral"
        })

    total_distinct_sessions = _distinct_conducted_session_count(conn, semester_id, month_filter)

    return {
        "class_average": class_average,
        "color": get_percentage_color(class_average) if total_class_conducted > 0 else "neutral",
        "total_students": total_students,
        "total_distinct_sessions": total_distinct_sessions,
        "distribution": {
            "safe_above_90": count_safe,
            "moderate_75_90": count_moderate,
            "shortage_below_75": count_shortage
        },
        "subjects": subject_results,
        "categories": [],
        "batches": batch_results
    }

