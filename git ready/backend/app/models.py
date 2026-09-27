from pydantic import BaseModel, Field
from typing import Optional, List

class LoginRequest(BaseModel):
    reg_no: Optional[str] = None # Used as Reg No for student, or Username for admin
    username: Optional[str] = None # Alias for admin username
    password: str
    role: str = "student" # 'cr', 'lr', or 'student'

class SemesterCreate(BaseModel):
    academic_year: str = "2026-2027"
    name: str
    start_month: str
    end_month: str
    active_month: str

class SemesterDeleteRequest(BaseModel):
    confirmation: str

class SemesterCreateNew(BaseModel):
    academic_year: str = "2026-2027"
    name: str
    start_month: str
    end_month: str
    active_month: str
    continue_student_details: bool = False

class SemesterUpdate(BaseModel):
    academic_year: Optional[str] = None
    name: Optional[str] = None
    start_month: Optional[str] = None
    end_month: Optional[str] = None
    active_month: Optional[str] = None

class MonthUpdate(BaseModel):
    active_month: str

class SubjectCreate(BaseModel):
    code: str
    name: str
    type: str # 'Theory' or 'Lab'
    faculty_name: str # Mandatory Professor / Faculty Incharge Name

class SubjectUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    faculty_name: Optional[str] = None

class TimetableSlotCreate(BaseModel):
    day_of_week: str
    start_time: str
    end_time: str
    # Either subject_id (used by the regular Timetable Manager, which already knows the
    # real DB id) or subject_code (used by the Setup Wizard, which only knows the subject's
    # code and can't safely guess its DB id once subjects are upserted instead of
    # recreated) must be provided. Falls back to 0/absent handled by the caller.
    subject_id: Optional[int] = None
    subject_code: Optional[str] = None
    slot_type: str # 'Theory' or 'Lab'
    batch: str = "All" # 'All', 'Batch 1', 'Batch 2', 'Batch 3'

class TimetableSlotUpdate(BaseModel):
    day_of_week: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    subject_id: Optional[int] = None
    slot_type: Optional[str] = None
    batch: Optional[str] = None

class BatchRangeCreate(BaseModel):
    batch_name: str # 'Batch 1', 'Batch 2', 'Batch 3'
    start_reg_no: str
    end_reg_no: str

class StudentCreate(BaseModel):
    # NOTE: registration-number formats differ across classes/branches/years, so this is
    # intentionally NOT pinned to exactly 12 digits any more. Forcing that length used to
    # reject the WHOLE setup submission (semester, subjects and timetable included) the
    # moment a single roster row didn't match one hardcoded format.
    reg_no: str = Field(..., min_length=1, max_length=30)
    name: str = Field(..., max_length=100)
    batch: str = "Batch 1" # 'Batch 1', 'Batch 2', 'Batch 3'
    mobile: Optional[str] = ""
    email: Optional[str] = ""
    category: Optional[str] = "EAPCET Admission"
    admission_no: Optional[str] = ""
    joining_date: Optional[str] = None # YYYY-MM-DD for lateral entries

class StudentUpdate(BaseModel):
    name: Optional[str] = None
    batch: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    category: Optional[str] = None
    admission_no: Optional[str] = None
    joining_date: Optional[str] = None

class BulkStudentImportItem(BaseModel):
    reg_no: str = Field(..., min_length=1, max_length=30)
    name: str = Field(..., max_length=100)
    batch: Optional[str] = "Batch 1"
    mobile: Optional[str] = ""
    email: Optional[str] = ""
    category: Optional[str] = "EAPCET Admission"
    admission_no: Optional[str] = ""
    joining_date: Optional[str] = None

class BulkStudentImportRequest(BaseModel):
    students: List[BulkStudentImportItem]

class SetupWizardPayload(BaseModel):
    semester: SemesterCreate
    subjects: List[SubjectCreate]
    timetable: List[TimetableSlotCreate]
    batch_ranges: List[BatchRangeCreate]
    # Deliberately raw dicts, not List[StudentCreate]: with a strict Pydantic model, ONE
    # malformed roster row (blank name, weird reg no, etc.) rejects the entire request with
    # a 422 before the handler even runs - which wipes out the semester/subjects/timetable
    # the CR already filled in correctly. The handler validates each row itself, saves every
    # good row, and reports the bad ones back instead of discarding everything.
    students: List[dict] = []

class AttendanceMarkRequest(BaseModel):
    date: str # YYYY-MM-DD
    day_of_week: str
    subject_id: int
    slot_id: Optional[int] = None
    session_id: Optional[int] = None  # Existing custom/extra session when slot_id is NULL
    slot_type: str # 'Theory' or 'Lab'
    batch: str = "All" # 'All', 'Batch 1', 'Batch 2', 'Batch 3'
    month: str # YYYY-MM
    absent_student_ids: List[int] = []

class ClassCancelRequest(BaseModel):
    date: str # YYYY-MM-DD
    day_of_week: str
    subject_id: int
    slot_id: Optional[int] = None
    session_id: Optional[int] = None  # Existing custom/extra session when slot_id is NULL
    slot_type: str
    batch: str = "All"
    month: str
    description: str # 2-3 line reason for cancellation

class HolidayCreate(BaseModel):
    date: str # YYYY-MM-DD
    title: str # e.g. 'Gandhi Jayanti', 'National Holiday'
    description: Optional[str] = ""

class StudentFormField(BaseModel):
    key: str # e.g. 'apaar_id', 'blood_group', 'father_name'
    label: str # e.g. 'APAAR / ABC ID', 'Blood Group'
    type: str = "text" # 'text', 'select', 'number'
    required: bool = True
    options: Optional[List[str]] = None

class StudentFormCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    fields: List[StudentFormField]

class StudentFormResponseSubmit(BaseModel):
    responses: dict # {"apaar_id": "123456789", "blood_group": "O+"}

class ExtraClassCreate(BaseModel):
    date: str # YYYY-MM-DD
    subject_id: int
    slot_type: str = "Theory" # 'Theory' or 'Lab'
    batch: str = "All" # 'All', 'Batch 1', 'Batch 2', 'Batch 3'
    start_time: str # e.g. "03:30 PM"
    end_time: str # e.g. "05:10 PM"
    faculty_name: Optional[str] = None
    notes: Optional[str] = None

class LateralJoiningDateUpdate(BaseModel):
    joining_date: str # YYYY-MM-DD

class StudentDropRequest(BaseModel):
    dropped_reason: Optional[str] = None
    dropped_date: Optional[str] = None
    reason: Optional[str] = None
    date: Optional[str] = None

class CustomDaySlotItem(BaseModel):
    subject_id: int
    slot_type: str = "Theory" # 'Theory' or 'Lab'
    batch: str = "All" # 'All', 'Batch 1', 'Batch 2', 'Batch 3'
    start_time: str
    end_time: str
    faculty_name: Optional[str] = ""

class CustomDayTimetableRequest(BaseModel):
    date: str # YYYY-MM-DD
    slots: List[CustomDaySlotItem]

class ClassUncancelRequest(BaseModel):
    date: str # YYYY-MM-DD
    subject_id: Optional[int] = None
    slot_id: Optional[int] = None
    session_id: Optional[int] = None

class ChangeAdminPasswordRequest(BaseModel):
    current_password: str
    new_password: str
    target_role: Optional[str] = None # 'cr' or 'lr'

class ChangeStudentPasswordRequest(BaseModel):
    current_password: str
    new_password: str

class ForgotPasswordRequest(BaseModel):
    reg_no: str
    new_password: str

class PasswordRequestAction(BaseModel):
    action: str # 'APPROVE' or 'DENY'

class StudentHelpdeskRequest(BaseModel):
    category: str # 'Attendance Correction', 'Bonafide / Certificate', 'Leave / Permission', 'General'
    subject: str
    message: str

class StudentRequestStatusUpdate(BaseModel):
    status: str # 'PENDING', 'IN_PROGRESS', 'RESOLVED'
    cr_note: Optional[str] = None

class SmartImportRequest(BaseModel):
    raw_text: str
    overwrite_existing: bool = False

class SemesterActivateRequest(BaseModel):
    semester_id: int

class SendAttendanceAlertsRequest(BaseModel):
    month: Optional[str] = None            # 'all' or 'YYYY-MM'; None/omitted = current active month
    threshold: Optional[float] = 75.0       # send to students strictly below this percentage
    student_ids: Optional[List[int]] = None # optional explicit subset (from the preview list)




# ----------------- ATTENDANCE EMAIL REPORTS ----------------- #

class AttendanceEmailRequest(BaseModel):
    """Manual send, triggered by the CR/LR from the Email Centre."""
    report_type: str = "MONTHLY"             # 'MONTHLY' | 'CUMULATIVE'
    period: Optional[str] = None             # 'YYYY-MM'; None = current active month
    audience: str = "ALL"                    # 'ALL' | 'BELOW_MONTHLY' | 'BELOW_CUMULATIVE' | 'SELECTED'
    threshold: Optional[float] = None        # defaults to the configured minimum (75)
    student_ids: Optional[List[int]] = None  # only used when audience == 'SELECTED'
    force_resend: bool = False               # re-send even if already logged for this period

