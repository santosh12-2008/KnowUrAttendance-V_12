from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db, reset_academic_data

client = TestClient(app)


def login(role='cr', identifier='test_cr', password='TestCR!123456'):
    r = client.post('/api/auth/login', json={'reg_no': identifier, 'password': password, 'role': role})
    assert r.status_code == 200, r.text
    return r.json()


def setup_data():
    with get_db() as conn:
        reset_academic_data(conn)
        c = conn.cursor()
        c.execute("""INSERT INTO semesters
            (academic_year,name,start_month,end_month,active_month,is_active,setup_complete,lateral_joining_date)
            VALUES ('2026-2027','B.Tech CSE - 2-1','2026-06','2026-11','2026-09',1,1,'2026-08-02')""")
        sem = c.lastrowid
        c.execute("INSERT INTO subjects (semester_id,code,name,type,faculty_name) VALUES (?,?,?,?,?)",
                  (sem,'CS2101','DMS','Theory','Faculty'))
        sub = c.lastrowid
        c.execute("INSERT INTO timetable_slots (semester_id,day_of_week,start_time,end_time,subject_id,slot_type,batch) VALUES (?,?,?,?,?,?,?)",
                  (sem,'Monday','09:00 AM','09:50 AM',sub,'Theory','All'))
        slot = c.lastrowid
        c.execute("""INSERT INTO students
            (reg_no,name,batch,mobile,email,category,admission_no,semester_id)
            VALUES (?,?,?,?,?,?,?,?)""",
                  ('999999000001','Student One','Batch 1','', 's1@example.com','EAPCET Admission','A1',sem))
        stu = c.lastrowid
        c.execute("INSERT INTO attendance_sessions (slot_id,subject_id,date,day_of_week,slot_type,batch,month,marked_by,start_time,end_time) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (slot,sub,'2026-09-01','Monday','Theory','All','2026-09','CR','09:00 AM','09:50 AM'))
        sess = c.lastrowid
        c.execute("INSERT INTO attendance_records (session_id,student_id,status) VALUES (?,?,?)", (sess,stu,'Present'))
    return sem, sub, stu, sess


def test_refresh_token_contract():
    setup_data()
    data = login()
    assert data.get('refresh_token')
    r = client.post('/api/auth/refresh', json={'refresh_token': data['refresh_token']})
    assert r.status_code == 200, r.text
    assert r.json().get('token')
    # A refresh token must never be accepted as an access token.
    denied = client.get('/api/auth/me', headers={'Authorization': f"Bearer {data['refresh_token']}"})
    assert denied.status_code == 401


def test_sensitive_routes_require_authentication():
    setup_data()
    assert client.get('/api/attendance/overview', headers={'Authorization': ''}).status_code == 401
    assert client.get('/api/attendance/statistics', headers={'Authorization': ''}).status_code == 401
    assert client.post('/api/attendance/mark', json={
        'date':'2026-09-02','day_of_week':'Wednesday','subject_id':1,
        'slot_id':None,'slot_type':'Theory','batch':'All','month':'2026-09','absent_student_ids':[]
    }, headers={'Authorization': ''}).status_code == 401


def test_new_semester_does_not_replace_active_and_copies_students_only():
    sem1, sub, stu, sess = setup_data()
    cr = login()
    headers={'Authorization': f"Bearer {cr['token']}"}
    r = client.post('/api/semesters/new', headers=headers, json={
        'academic_year':'2026-2027','name':'B.Tech CSE - 2-2',
        'start_month':'2026-12','end_month':'2027-04','active_month':'2026-12',
        'continue_student_details':True
    })
    assert r.status_code == 200, r.text
    sem2 = r.json()['id']
    assert r.json()['students_copied'] == 1
    semesters = client.get('/api/semesters', headers=headers).json()
    active = next(s for s in semesters if s['id'] == sem1)
    new = next(s for s in semesters if s['id'] == sem2)
    assert active['is_active'] == 1
    assert new['is_active'] == 0
    with get_db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM attendance_sessions WHERE id = ?', (sess,)).fetchone()[0] == 1
        copied = conn.execute('SELECT * FROM students WHERE semester_id=?', (sem2,)).fetchone()
        assert copied is not None
        assert copied['reg_no'] == '999999000001'
        assert conn.execute('SELECT COUNT(*) FROM attendance_sessions').fetchone()[0] == 1


def test_semester_switch_and_two_step_delete():
    sem1, *_ = setup_data()
    cr = login()
    headers={'Authorization': f"Bearer {cr['token']}"}
    created = client.post('/api/semesters/new', headers=headers, json={
        'academic_year':'2026-2027','name':'B.Tech CSE - 2-2',
        'start_month':'2026-12','end_month':'2027-04','active_month':'2026-12',
        'continue_student_details':False
    }).json()
    sem2=created['id']
    sw = client.put(f'/api/semesters/{sem2}/activate', headers=headers)
    assert sw.status_code == 200
    assert client.get('/api/semesters/active').json()['id'] == sem2
    bad = client.request('DELETE', f'/api/semesters/{sem1}', headers=headers, json={'confirmation':'DELETE'})
    assert bad.status_code == 400
    good = client.request('DELETE', f'/api/semesters/{sem1}', headers=headers, json={'confirmation':'DELETE SEMESTER'})
    assert good.status_code == 200, good.text
    assert client.get('/api/semesters/active').json()['id'] == sem2


def test_backup_contains_attendance_data():
    setup_data()
    cr = login()
    headers={'Authorization': f"Bearer {cr['token']}"}
    r = client.get('/api/backup/download-json', headers=headers)
    assert r.status_code == 200
    tables = r.json()['tables']
    assert len(tables['attendance_sessions']) == 1
    assert len(tables['attendance_records']) == 1
    assert len(tables['students']) == 1
