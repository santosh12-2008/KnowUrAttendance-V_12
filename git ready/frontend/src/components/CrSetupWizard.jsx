import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, BookOpen, Clock, Users, CheckCircle2, ChevronRight, 
  ChevronLeft, Plus, Trash2, Sliders, FileText, Sparkles, AlertCircle, Save,
  RotateCcw, Info
} from 'lucide-react';

// ----------------------------------------------------------------------------------
// Default template - CLASS: 2/4 B.Tech (CSE), I Sem, Room No: FFCL-5
// (from the official TENTATIVE TIME TABLE circular, revised 15-09-2026)
// Used only when the CR has never saved anything yet (fresh install / after an explicit
// "Reset Database"). Once real data exists in the backend or in the browser's draft, that
// takes over instead of these placeholders.
// ----------------------------------------------------------------------------------
const DEFAULT_SEMESTER = {
  academic_year: '2026-2027',
  name: 'B.Tech CSE - 2nd Year I Sem (2-1)',
  start_month: '2026-08',
  end_month: '2026-12',
  active_month: '2026-09'
};

const DEFAULT_SUBJECTS = [
  { code: 'CS2101', name: 'Discrete Mathematical Structures', type: 'Theory', faculty_name: 'Dr. Ch. Swapna (TTA)' },
  { code: 'CS2102', name: 'Computer Organization and Architecture', type: 'Theory', faculty_name: 'Dr. K. Rajakumar' },
  { code: 'CS2103', name: 'Probability, Statistics and Queuing Theory', type: 'Theory', faculty_name: 'Ms. Radha Kumari (TTA)' },
  { code: 'CS2104', name: 'Operating Systems', type: 'Theory', faculty_name: 'Prof. S. Vizinanda Row' },
  { code: 'CS2105', name: 'Object Oriented Programming through Java', type: 'Theory', faculty_name: 'Prof. K. Venkat Rao' },
  { code: 'CS2110', name: 'Environmental Science', type: 'Theory', faculty_name: 'Self Study' },
  { code: 'CS2106', name: 'Computer Organization and Architecture Lab', type: 'Lab', faculty_name: 'Mr. P. Mahesh (TTA)' },
  { code: 'CS2107', name: 'Object Oriented Programming through Java Lab', type: 'Lab', faculty_name: 'Ms. P. V. Aruna Sri (TTA)' },
  { code: 'CS2108', name: 'Operating Systems Lab', type: 'Lab', faculty_name: 'Prof. S. Vizinanda Row / Mr. R. Venkata Ramana (RS)' },
  { code: 'CS2109', name: 'Intellectual Property Rights', type: 'Theory', faculty_name: 'HSS Department (Online)' }
];

// Labs shown as e.g. "COA LAB-1/OS LAB-3" on the circular become one row per batch below.
const DEFAULT_TIMETABLE = [
  { day_of_week: 'Monday', start_time: '09:00 AM', end_time: '10:40 AM', subject_code: 'CS2103', slot_type: 'Theory', batch: 'All' },
  { day_of_week: 'Monday', start_time: '10:40 AM', end_time: '12:20 PM', subject_code: 'CS2106', slot_type: 'Lab', batch: 'Batch 1' },
  { day_of_week: 'Monday', start_time: '10:40 AM', end_time: '12:20 PM', subject_code: 'CS2108', slot_type: 'Lab', batch: 'Batch 3' },

  { day_of_week: 'Tuesday', start_time: '09:00 AM', end_time: '10:40 AM', subject_code: 'CS2107', slot_type: 'Lab', batch: 'Batch 3' },
  { day_of_week: 'Tuesday', start_time: '10:40 AM', end_time: '12:20 PM', subject_code: 'CS2105', slot_type: 'Theory', batch: 'All' },
  { day_of_week: 'Tuesday', start_time: '01:30 PM', end_time: '03:10 PM', subject_code: 'CS2103', slot_type: 'Theory', batch: 'All' },

  { day_of_week: 'Wednesday', start_time: '09:00 AM', end_time: '10:40 AM', subject_code: 'CS2104', slot_type: 'Theory', batch: 'All' },
  { day_of_week: 'Wednesday', start_time: '10:40 AM', end_time: '12:20 PM', subject_code: 'CS2101', slot_type: 'Theory', batch: 'All' },

  { day_of_week: 'Thursday', start_time: '09:00 AM', end_time: '10:40 AM', subject_code: 'CS2104', slot_type: 'Theory', batch: 'All' },
  { day_of_week: 'Thursday', start_time: '10:40 AM', end_time: '12:20 PM', subject_code: 'CS2105', slot_type: 'Theory', batch: 'All' },

  { day_of_week: 'Friday', start_time: '09:00 AM', end_time: '10:40 AM', subject_code: 'CS2102', slot_type: 'Theory', batch: 'All' },
  { day_of_week: 'Friday', start_time: '10:40 AM', end_time: '12:20 PM', subject_code: 'CS2101', slot_type: 'Theory', batch: 'All' },
  { day_of_week: 'Friday', start_time: '01:30 PM', end_time: '03:10 PM', subject_code: 'CS2108', slot_type: 'Lab', batch: 'Batch 1' },
  { day_of_week: 'Friday', start_time: '01:30 PM', end_time: '03:10 PM', subject_code: 'CS2107', slot_type: 'Lab', batch: 'Batch 2' },

  { day_of_week: 'Saturday', start_time: '09:00 AM', end_time: '10:40 AM', subject_code: 'CS2102', slot_type: 'Theory', batch: 'All' },
  { day_of_week: 'Saturday', start_time: '10:40 AM', end_time: '12:20 PM', subject_code: 'CS2106', slot_type: 'Lab', batch: 'Batch 2' },
  { day_of_week: 'Saturday', start_time: '01:30 PM', end_time: '03:10 PM', subject_code: 'CS2108', slot_type: 'Lab', batch: 'Batch 2' },
  { day_of_week: 'Saturday', start_time: '01:30 PM', end_time: '03:10 PM', subject_code: 'CS2107', slot_type: 'Lab', batch: 'Batch 1' },
  { day_of_week: 'Saturday', start_time: '01:30 PM', end_time: '03:10 PM', subject_code: 'CS2106', slot_type: 'Lab', batch: 'Batch 3' }
];

// Left blank on purpose - registration-number prefixes change every admission year, so a
// fake-looking default here would be actively misleading. The CR fills these in Step 4.
const DEFAULT_BATCH_RANGES = [
  { batch_name: 'Batch 1', start_reg_no: '', end_reg_no: '' },
  { batch_name: 'Batch 2', start_reg_no: '', end_reg_no: '' },
  { batch_name: 'Batch 3', start_reg_no: '', end_reg_no: '' }
];

const DRAFT_KEY = 'cr_setup_wizard_draft_v2';

export default function CrSetupWizard({ onSetupComplete, onCancel }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successNote, setSuccessNote] = useState('');
  const [skippedRows, setSkippedRows] = useState([]);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [resumeNote, setResumeNote] = useState(''); // shown once, tells the CR what was restored
  const hydrated = useRef(false); // guards the autosave effect from firing before we've loaded anything

  // 1. Semester & Calendar Duration
  const [semester, setSemester] = useState(DEFAULT_SEMESTER);

  // 2. Subjects in Semester
  const [subjects, setSubjects] = useState(DEFAULT_SUBJECTS);

  const [newSub, setNewSub] = useState({ code: '', name: '', type: 'Theory', faculty_name: '' });

  // 3. Timetable Slots
  const [activeDay, setActiveDay] = useState('Monday');
  const [timetable, setTimetable] = useState(DEFAULT_TIMETABLE);

  const [newSlot, setNewSlot] = useState({
    subject_code: 'CS2101',
    start_time: '09:00 AM',
    end_time: '09:50 AM',
    slot_type: 'Theory',
    batch: 'All'
  });

  // 4. Batch Allocation Ranges
  const [batchRanges, setBatchRanges] = useState(DEFAULT_BATCH_RANGES);

  // 5. Students Roster
  const [students, setStudents] = useState([]);
  const [studentInputMode, setStudentInputMode] = useState('bulk'); // 'bulk' or 'single'
  const [bulkText, setBulkText] = useState('');
  const [singleStudent, setSingleStudent] = useState({
    reg_no: '',
    name: '',
    batch: 'Batch 1',
    mobile: '',
    email: '',
    category: 'Convener (EAPCET)',
    admission_no: ''
  });

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // -------------------------------------------------------------------------------
  // Resume support: on mount, figure out what's already saved (backend first - that's
  // the durable source of truth - falling back to a local in-progress draft if the
  // backend has nothing yet), and pick up exactly where the CR left off instead of
  // making them start the whole wizard over from Step 1.
  // -------------------------------------------------------------------------------
  useEffect(() => {
    let draft = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) draft = JSON.parse(raw);
    } catch {
      draft = null;
    }

    (async () => {
      try {
        const res = await fetch('/api/setup/status');
        const data = res.ok ? await res.json() : null;

        if (data && data.has_active_semester) {
          // Backend has real saved data - this is the source of truth.
          const sem = data.semester || {};
          setSemester({
            academic_year: sem.academic_year || DEFAULT_SEMESTER.academic_year,
            name: sem.name || DEFAULT_SEMESTER.name,
            start_month: sem.start_month || DEFAULT_SEMESTER.start_month,
            end_month: sem.end_month || DEFAULT_SEMESTER.end_month,
            active_month: sem.active_month || DEFAULT_SEMESTER.active_month
          });

          if (data.subjects && data.subjects.length > 0) {
            setSubjects(data.subjects.map(s => ({
              code: s.code, name: s.name, type: s.type, faculty_name: s.faculty_name || ''
            })));
          }
          if (data.timetable && data.timetable.length > 0) {
            setTimetable(data.timetable.map(t => ({
              day_of_week: t.day_of_week, start_time: t.start_time, end_time: t.end_time,
              subject_code: t.subject_code, slot_type: t.slot_type, batch: t.batch
            })));
          }
          if (data.batch_ranges && data.batch_ranges.length > 0) {
            setBatchRanges(data.batch_ranges.map(b => ({
              batch_name: b.batch_name, start_reg_no: b.start_reg_no, end_reg_no: b.end_reg_no
            })));
          }
          if (data.students && data.students.length > 0) {
            setStudents(data.students);
          }

          setCurrentStep(data.next_step || 1);
          if (data.next_step && data.next_step > 1) {
            setResumeNote(
              `Welcome back — picking up right where you left off, at Step ${data.next_step}. ` +
              `Everything you already saved (semester, subjects, timetable, batch ranges${data.students_count ? ', students' : ''}) is still here.`
            );
          }
        } else if (draft && draft.students) {
          // Nothing saved to the backend yet, but there's an unsaved local draft
          // (e.g. the CR closed the tab mid-way through Step 5) - restore it.
          if (draft.semester) setSemester(draft.semester);
          if (draft.subjects) setSubjects(draft.subjects);
          if (draft.timetable) setTimetable(draft.timetable);
          if (draft.batchRanges) setBatchRanges(draft.batchRanges);
          if (draft.students) setStudents(draft.students);
          if (draft.currentStep) setCurrentStep(draft.currentStep);
          setResumeNote('Restored your unsaved progress from this browser — nothing was lost.');
        }
      } catch {
        // Backend unreachable - fall back to local draft only.
        if (draft && draft.students) {
          if (draft.semester) setSemester(draft.semester);
          if (draft.subjects) setSubjects(draft.subjects);
          if (draft.timetable) setTimetable(draft.timetable);
          if (draft.batchRanges) setBatchRanges(draft.batchRanges);
          if (draft.students) setStudents(draft.students);
          if (draft.currentStep) setCurrentStep(draft.currentStep);
          setResumeNote('Restored your unsaved progress from this browser — nothing was lost.');
        }
      } finally {
        hydrated.current = true;
        setLoadingExisting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave every change to a local draft, so a crashed tab / accidental refresh never
  // loses what the CR has typed, even before they hit "Commit Setup".
  useEffect(() => {
    if (!hydrated.current) return; // don't overwrite a real draft with initial defaults
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          semester, subjects, timetable, batchRanges, students, currentStep,
          savedAt: new Date().toISOString()
        }));
      } catch {
        // localStorage full/unavailable - non-fatal, backend save on Commit still works.
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [semester, subjects, timetable, batchRanges, students, currentStep]);

  const clearDraftAndReset = () => {
    if (!window.confirm('Start completely fresh? This clears everything typed in this wizard on this device (it does NOT touch anything already saved to the server).')) {
      return;
    }
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setSemester(DEFAULT_SEMESTER);
    setSubjects(DEFAULT_SUBJECTS);
    setTimetable(DEFAULT_TIMETABLE);
    setBatchRanges(DEFAULT_BATCH_RANGES);
    setStudents([]);
    setCurrentStep(1);
    setResumeNote('');
  };

  // Helper to determine batch from reg_no
  const determineBatch = (regNo) => {
    for (const r of batchRanges) {
      if (regNo >= r.start_reg_no && regNo <= r.end_reg_no) {
        return r.batch_name;
      }
    }
    try {
      const last3 = parseInt(regNo.slice(-3), 10);
      if (last3 <= 47) return 'Batch 1';
      if (last3 <= 94) return 'Batch 2';
      return 'Batch 3';
    } catch {
      return 'Batch 1';
    }
  };

  // Quick helper to generate sample 140 AU CSE students
  const handleGenerateSample140 = () => {
    const list = [];
    for (let i = 1; i <= 140; i++) {
      const reg = `999999000${String(i).padStart(3, '0')}`;
      let name = `Student ${String(i).padStart(3, '0')}`;
      let batch = determineBatch(reg);
      let mobile = `+91 90000${String(10000 + i)}`;
      let email = `student.${reg.slice(-4)}@example.edu`;


      list.push({
        reg_no: reg,
        name: name,
        batch: batch,
        mobile: mobile,
        email: email,
        category: 'Convener (EAPCET)',
        admission_no: `TEST-CSE-2026-${String(i).padStart(4, '0')}`
      });
    }
    setStudents(list);
  };

  // ------------------------------------------------------------------------------
  // Bulk paste parsing. Built to survive a raw copy-paste straight out of an Excel /
  // Google Sheets column selection, which is what the CR actually does in practice:
  //   Name of the Candidate | Registration Number | Mobile Number | Admn.No | Email Address | Category of admission
  // Two things the old parser got wrong, fixed here:
  //   1. It split on ANY run of commas/tabs, so a blank cell in the middle of a row
  //      (very common in Excel exports - e.g. no mobile number yet) collapsed the gap
  //      and silently shifted every column after it one place to the left.
  //   2. It assumed a single fixed column order. If the sheet's headers are present we
  //      now read them and map columns by name (any order works); if there's no header
  //      row we fall back to the department's standard export order above.
  // ------------------------------------------------------------------------------
  const BULK_HEADER_PATTERNS = [
    { field: 'name', patterns: ['name of the candidate', 'candidate name', 'student name', 'full name', 'name'] },
    { field: 'reg_no', patterns: ['registration number', 'reg. no', 'reg no', 'regno', 'reg.no', 'register no', 'roll number', 'roll no'] },
    { field: 'mobile', patterns: ['mobile number', 'mobile no', 'mobile', 'phone number', 'phone', 'contact number', 'contact'] },
    { field: 'admission_no', patterns: ['admn.no', 'admn no', 'admission number', 'admission no', 'adm no', 'admno'] },
    { field: 'email', patterns: ['email address', 'e-mail', 'email'] },
    { field: 'category', patterns: ['category of admission', 'admission category', 'category', 'quota'] }
  ];
  // Default order used when the pasted block has no recognizable header row -
  // matches the AUCE(A) CSE roster export the CR pastes from.
  const DEFAULT_BULK_COLUMN_ORDER = ['name', 'reg_no', 'mobile', 'admission_no', 'email', 'category'];

  const detectBulkDelimiter = (line) => {
    if (line.includes('\t')) return '\t';
    if (line.includes(',')) return ',';
    return '\t';
  };

  // Splits on a single delimiter character (never collapses "," or "\t\t") so an
  // empty cell between two real values stays a real, positional empty string.
  const splitBulkRow = (line, delimiter) => line.split(delimiter).map(c => c.trim());

  const detectBulkHeader = (cells) => {
    const map = {};
    cells.forEach((cell, idx) => {
      const norm = cell.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!norm) return;
      for (const { field, patterns } of BULK_HEADER_PATTERNS) {
        if (map[field] !== undefined) continue;
        if (patterns.some(p => norm.includes(p))) {
          map[field] = idx;
          break;
        }
      }
    });
    const recognized = Object.keys(map).length;
    // Only trust it as a real header row if we recognized at least two columns,
    // including name or reg_no - otherwise a genuine data row (e.g. a name that
    // happens to contain the word "name") could be mistaken for a header.
    if (recognized >= 2 && (map.name !== undefined || map.reg_no !== undefined)) {
      return map;
    }
    return null;
  };

  const handleParseBulkText = () => {
    if (!bulkText.trim()) return;
    const rawLines = bulkText.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
    if (rawLines.length === 0) return;

    const delimiter = detectBulkDelimiter(rawLines[0]);
    let rows = rawLines.map(l => splitBulkRow(l, delimiter));

    let columnMap = detectBulkHeader(rows[0]);
    if (columnMap) {
      rows = rows.slice(1); // drop the header row itself
    } else {
      columnMap = {};
      DEFAULT_BULK_COLUMN_ORDER.forEach((field, idx) => { columnMap[field] = idx; });
    }

    const parsed = [];
    const skipped = [];

    rows.forEach((cells, rowIdx) => {
      if (cells.every(c => !c)) return; // fully blank line, ignore quietly

      const get = (field) => {
        const idx = columnMap[field];
        if (idx === undefined || idx >= cells.length) return '';
        return (cells[idx] || '').trim();
      };

      const name = get('name').slice(0, 100);
      const regRaw = get('reg_no');
      const reg = regRaw.replace(/\D/g, '');
      const mobile = get('mobile');
      const admission_no = get('admission_no');
      const email = get('email');
      const category = get('category');
      const rowLabel = `Row ${rowIdx + 1}${name ? ` (${name})` : regRaw ? ` (${regRaw})` : ''}`;

      if (reg.length !== 12) {
        skipped.push(`${rowLabel}: registration number must be exactly 12 digits${regRaw ? ` (got "${regRaw}")` : ' (blank)'}`);
        return;
      }
      if (!name) {
        skipped.push(`${rowLabel}: student name is blank`);
        return;
      }

      parsed.push({
        reg_no: reg,
        name,
        batch: determineBatch(reg),
        mobile: mobile || '',
        email: email || `${reg}@example.edu`,
        category: category || 'Convener (EAPCET)',
        admission_no: admission_no || `TEST-CSE-2026-${reg.slice(-4)}`
      });
    });

    setSkippedRows(skipped);

    if (parsed.length === 0) {
      setSuccessNote('');
      setErrorMessage(
        skipped.length
          ? `No valid rows could be imported. ${skipped.length} row(s) had problems — see below.`
          : 'Could not detect any student rows. Paste columns copied straight from Excel/Sheets (Name, Registration Number, Mobile Number, Admn.No, Email Address, Category of admission), with or without a header row.'
      );
      return;
    }

    setStudents(prev => {
      const map = new Map();
      prev.forEach(s => map.set(s.reg_no, s));
      parsed.forEach(s => map.set(s.reg_no, s));
      return Array.from(map.values()).sort((a, b) => a.reg_no.localeCompare(b.reg_no));
    });
    setErrorMessage('');
    setSuccessNote(
      `Imported ${parsed.length} student${parsed.length === 1 ? '' : 's'} from the pasted list.` +
      (skipped.length ? ` Skipped ${skipped.length} row(s) — see below.` : '')
    );
    setBulkText('');
  };

  // Add individual student
  const handleAddSingleStudent = (e) => {
    e.preventDefault();
    const cleanReg = singleStudent.reg_no.trim();
    if (cleanReg.length !== 12) {
      alert('Registration Number must be exactly 12 digits');
      return;
    }

    const assignedBatch = determineBatch(cleanReg);
    const newEntry = {
      ...singleStudent,
      reg_no: cleanReg,
      batch: assignedBatch,
      email: singleStudent.email.trim() || `${cleanReg}@example.edu`,
      admission_no: singleStudent.admission_no.trim() || `TEST-CSE-2026-${cleanReg.slice(-4)}`
    };

    setStudents(prev => [...prev.filter(s => s.reg_no !== cleanReg), newEntry].sort((a, b) => a.reg_no.localeCompare(b.reg_no)));
    setSingleStudent({
      reg_no: '',
      name: '',
      batch: 'Batch 1',
      mobile: '',
      email: '',
      category: 'Convener (EAPCET)',
      admission_no: ''
    });
  };

  // Add subject
  const handleAddSubject = (e) => {
    e.preventDefault();
    if (!newSub.code.trim() || !newSub.name.trim()) return;
    if (!newSub.faculty_name.trim()) {
      alert('Professor / Faculty Name is required for this subject');
      return;
    }
    setSubjects(prev => [...prev, { 
      ...newSub, 
      code: newSub.code.toUpperCase().trim(),
      faculty_name: newSub.faculty_name.trim()
    }]);
    setNewSub({ code: '', name: '', type: 'Theory', faculty_name: '' });
  };

  // Remove subject
  const handleRemoveSubject = (code) => {
    setSubjects(prev => prev.filter(s => s.code !== code));
    setTimetable(prev => prev.filter(t => t.subject_code !== code));
  };

  // Add timetable slot
  const handleAddSlot = (e) => {
    e.preventDefault();
    const sub = subjects.find(s => s.code === newSlot.subject_code);
    setTimetable(prev => [
      ...prev,
      {
        day_of_week: activeDay,
        start_time: newSlot.start_time,
        end_time: newSlot.end_time,
        subject_code: newSlot.subject_code,
        slot_type: newSlot.slot_type,
        batch: newSlot.slot_type === 'Lab' ? newSlot.batch : 'All'
      }
    ]);
  };

  // ------------------------------------------------------------------------------
  // Per-step validation. Used both to gate the "Next" button (so a CR can't wander
  // past a section they haven't actually filled in) and, on final submit, to send
  // them straight back to whichever specific step is still incomplete - instead of
  // a generic error that leaves them guessing, or worse, losing what they already did.
  // ------------------------------------------------------------------------------
  const getStepError = (stepNum) => {
    switch (stepNum) {
      case 1:
        if (!semester.name.trim()) return 'Semester Title is required.';
        if (!semester.start_month || !semester.end_month || !semester.active_month) {
          return 'From Month, To Month and Active Month are all required.';
        }
        return null;
      case 2:
        if (subjects.length === 0) return 'Add at least one subject before continuing.';
        return null;
      case 3:
        if (timetable.length === 0) return 'Add at least one timetable slot before continuing.';
        return null;
      case 4:
        if (batchRanges.some(b => !b.start_reg_no.trim() || !b.end_reg_no.trim())) {
          return 'Every batch needs both a start and end registration number.';
        }
        return null;
      case 5:
        if (students.length === 0) return 'Add at least one student to the roster before finishing setup.';
        return null;
      default:
        return null;
    }
  };

  const goToStep = (target) => {
    const err = getStepError(currentStep);
    if (err && target > currentStep) {
      setErrorMessage(err);
      return;
    }
    setErrorMessage('');
    setCurrentStep(target);
  };

  // Final submit to backend
  const handleSubmitAll = async () => {
    // Walk every step in order and stop at the first one that's still incomplete,
    // sending the CR straight there with everything else they entered left intact -
    // rather than a vague failure that makes it look like the whole wizard reset.
    for (let s = 1; s <= 5; s++) {
      const err = getStepError(s);
      if (err) {
        setCurrentStep(s);
        setErrorMessage(`Step ${s} isn't finished yet: ${err}`);
        return;
      }
    }

    setSubmitting(true);
    setErrorMessage('');
    try {
      // Send subject_code (not a guessed subject_id) for each slot - the backend upserts
      // subjects by code and resolves the real database id from that. A client-side
      // index-based id would silently point timetable slots at the wrong subject as soon
      // as the real ids diverge from array order (e.g. after editing/removing a subject,
      // or resuming setup where subjects already exist in the database with other ids).
      const formattedSlots = timetable.map(t => ({
        day_of_week: t.day_of_week,
        start_time: t.start_time,
        end_time: t.end_time,
        subject_code: t.subject_code,
        slot_type: t.slot_type,
        batch: t.batch
      }));

      const payload = {
        semester: semester,
        subjects: subjects,
        timetable: formattedSlots,
        batch_ranges: batchRanges,
        students: students
      };

      const res = await fetch('/api/setup/full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to save setup');
      }

      // Setup is safely on the server now - the local in-progress draft would only
      // cause confusion (or overwrite real data) if it stuck around after this.
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }

      if (data.skipped_students && data.skipped_students.length > 0) {
        setSkippedRows(data.skipped_students.map(r => `${r.row}: ${r.reason}`));
        setErrorMessage(
          `Setup saved, but ${data.skipped_students.length} student row(s) were skipped — see below. ` +
          `Fix them in the roster and click Commit again.`
        );
        setSubmitting(false);
        return;
      }

      onSetupComplete(data);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { num: 1, title: 'Semester & Dates', icon: Calendar },
    { num: 2, title: 'Subjects', icon: BookOpen },
    { num: 3, title: 'Weekly Timetable', icon: Clock },
    { num: 4, title: 'Batch Ranges', icon: Sliders },
    { num: 5, title: 'Student Roster', icon: Users }
  ];

  if (loadingExisting) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-16 flex flex-col items-center justify-center space-y-3">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-bold text-slate-500">Checking for anything you've already saved…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      
      {/* Wizard Header & Stepper */}
      <div className="px-6 py-5 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center space-x-2">
              <span className="bg-amber-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                CR Setup Wizard
              </span>
              <span className="text-xs text-slate-500 font-medium">AUCE(A) CSE Academic Initialization</span>
            </div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
              Class Representative Data Portal
            </h2>
            <p className="text-xs text-slate-600">
              Configure your exact semester calendar, subjects, weekly schedule, lab batches, and class roster.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={clearDraftAndReset}
              title="Clear everything typed here and start over from the defaults"
              className="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-bold rounded-xl hover:bg-white transition flex items-center space-x-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Start Fresh</span>
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-bold rounded-xl hover:bg-white transition"
              >
                Exit Setup
              </button>
            )}
          </div>
        </div>

        {resumeNote && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-start justify-between gap-3 text-xs text-blue-800 font-medium">
            <div className="flex items-start space-x-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>{resumeNote}</span>
            </div>
            <button
              onClick={() => setResumeNote('')}
              className="text-blue-400 hover:text-blue-700 font-black shrink-0"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Stepper Navigation */}
        <div className="grid grid-cols-5 gap-2 pt-2">
          {steps.map((s) => {
            const Icon = s.icon;
            const isCompleted = s.num < currentStep;
            const isActive = s.num === currentStep;
            return (
              <button
                key={s.num}
                onClick={() => goToStep(s.num)}
                className={`text-left p-2.5 rounded-xl border transition flex items-center space-x-2.5 ${
                  isActive
                    ? 'bg-white border-amber-500 ring-2 ring-amber-500/20 shadow-xs'
                    : isCompleted
                    ? 'bg-white/80 border-emerald-300 text-emerald-800'
                    : 'bg-white/40 border-slate-200 text-slate-400'
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                  isActive
                    ? 'bg-amber-600 text-white'
                    : isCompleted
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-400'
                }`}>
                  {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                </div>
                <div className="hidden md:block overflow-hidden">
                  <div className="text-[10px] uppercase font-bold text-slate-400 leading-tight">Step {s.num}</div>
                  <div className={`text-xs font-black truncate ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>
                    {s.title}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {errorMessage && (
        <div className="mx-6 mt-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-medium space-y-2">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {skippedRows.length > 0 && (
            <ul className="ml-7 list-disc space-y-0.5 text-red-700">
              {skippedRows.slice(0, 20).map((s, i) => <li key={i}>{s}</li>)}
              {skippedRows.length > 20 && <li>…and {skippedRows.length - 20} more.</li>}
            </ul>
          )}
        </div>
      )}

      {successNote && !errorMessage && (
        <div className="mx-6 mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-medium space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{successNote}</span>
            </div>
            <button onClick={() => setSuccessNote('')} className="text-emerald-500 hover:text-emerald-800 font-black shrink-0">×</button>
          </div>
          {skippedRows.length > 0 && (
            <ul className="ml-7 list-disc space-y-0.5 text-amber-700">
              {skippedRows.slice(0, 20).map((s, i) => <li key={i}>{s}</li>)}
              {skippedRows.length > 20 && <li>…and {skippedRows.length - 20} more.</li>}
            </ul>
          )}
        </div>
      )}

      {/* Step Content Area */}
      <div className="p-6 sm:p-8">
        
        {/* ================= STEP 1: SEMESTER & DATES ================= */}
        {currentStep === 1 && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-lg font-black text-slate-900">Step 1: Select Semester & Calendar Range</h3>
              <p className="text-xs text-slate-500 mt-1">
                Define the academic semester and the calendar duration (from this month to that month).
              </p>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Academic Year *
                  </label>
                  <input
                    type="text"
                    required
                    value={semester.academic_year}
                    onChange={(e) => setSemester({ ...semester, academic_year: e.target.value })}
                    placeholder="e.g. 2026-2027"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Semester Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={semester.name}
                    onChange={(e) => setSemester({ ...semester, name: e.target.value })}
                    placeholder="e.g. B.Tech CSE - 3rd Year 1st Sem (3-1)"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    From Month (Start) *
                  </label>
                  <input
                    type="month"
                    required
                    value={semester.start_month}
                    onChange={(e) => setSemester({ ...semester, start_month: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    To Month (End) *
                  </label>
                  <input
                    type="month"
                    required
                    value={semester.end_month}
                    onChange={(e) => setSemester({ ...semester, end_month: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Active Month (Persistent) *
                  </label>
                  <input
                    type="month"
                    required
                    value={semester.active_month}
                    onChange={(e) => setSemester({ ...semester, active_month: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center space-x-2"
              >
                <span>Next: Define Subjects</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2: SUBJECTS ================= */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-black text-slate-900">Step 2: Add Subjects for Semester</h3>
              <p className="text-xs text-slate-500 mt-1">
                Enter all Theory and Lab courses taught in this semester.
              </p>
            </div>

            {/* Add Subject Inline Form */}
            <form onSubmit={handleAddSubject} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-600 mb-1">Code *</label>
                <input
                  type="text"
                  required
                  placeholder="CS3101"
                  value={newSub.code}
                  onChange={(e) => setNewSub({ ...newSub, code: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono uppercase"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block font-bold text-slate-600 mb-1">Subject Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Database Management Systems"
                  value={newSub.name}
                  onChange={(e) => setNewSub({ ...newSub, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-600 mb-1">Type</label>
                <select
                  value={newSub.type}
                  onChange={(e) => setNewSub({ ...newSub, type: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium"
                >
                  <option value="Theory">Theory Class</option>
                  <option value="Lab">Lab Practical</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block font-bold text-slate-600 mb-1">Professor / Faculty Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. K. Srinivasa Rao"
                  value={newSub.faculty_name}
                  onChange={(e) => setNewSub({ ...newSub, faculty_name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium"
                />
              </div>

              <div className="sm:col-span-1 flex items-end">
                <button
                  type="submit"
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs flex items-center justify-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </form>

            {/* Subjects Table */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-black text-[10px]">
                    <th className="py-2.5 px-4">Code</th>
                    <th className="py-2.5 px-4">Subject Name</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4">Faculty Incharge</th>
                    <th className="py-2.5 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subjects.map((s) => (
                    <tr key={s.code} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono font-bold text-blue-700">{s.code}</td>
                      <td className="py-2.5 px-4 font-bold text-slate-900">{s.name}</td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                          s.type === 'Lab' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {s.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-500">{s.faculty_name || 'Department Faculty'}</td>
                      <td className="py-2.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveSubject(s.code)}
                          className="text-slate-400 hover:text-red-600 p-1"
                          title="Remove subject"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => goToStep(1)}
                className="px-5 py-2.5 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => goToStep(3)}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center space-x-2"
              >
                <span>Next: Weekly Timetable ({timetable.length} slots)</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 3: WEEKLY TIMETABLE ================= */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-black text-slate-900">Step 3: Configure Weekly Timetable</h3>
              <p className="text-xs text-slate-500 mt-1">
                For each day (Monday–Saturday), add slots with timings and specify Theory or Batch 1/2/3 for Labs.
              </p>
            </div>

            {/* Day Switcher */}
            <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 rounded-2xl border border-slate-200">
              {days.map((d) => {
                const count = timetable.filter(t => t.day_of_week === d).length;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setActiveDay(d)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 ${
                      activeDay === d
                        ? 'bg-white text-slate-900 shadow-xs font-black'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>{d}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Add Slot on Active Day */}
            <form onSubmit={handleAddSlot} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-6 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-600 mb-1">Subject</label>
                <select
                  value={newSlot.subject_code}
                  onChange={(e) => {
                    const sub = subjects.find(s => s.code === e.target.value);
                    setNewSlot({
                      ...newSlot,
                      subject_code: e.target.value,
                      slot_type: sub ? sub.type : 'Theory',
                      batch: sub && sub.type === 'Lab' ? 'Batch 1' : 'All'
                    });
                  }}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium"
                >
                  {subjects.map(s => (
                    <option key={s.code} value={s.code}>{s.code} - {s.name} ({s.type})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Start Time</label>
                <input
                  type="text"
                  required
                  placeholder="09:00 AM"
                  value={newSlot.start_time}
                  onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">End Time</label>
                <input
                  type="text"
                  required
                  placeholder="09:50 AM"
                  value={newSlot.end_time}
                  onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Type & Batch</label>
                <select
                  value={newSlot.slot_type === 'Lab' ? newSlot.batch : 'All'}
                  onChange={(e) => {
                    if (e.target.value === 'All') {
                      setNewSlot({ ...newSlot, slot_type: 'Theory', batch: 'All' });
                    } else {
                      setNewSlot({ ...newSlot, slot_type: 'Lab', batch: e.target.value });
                    }
                  }}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium"
                >
                  <option value="All">Theory (All Class)</option>
                  <option value="Batch 1">Lab: Batch 1</option>
                  <option value="Batch 2">Lab: Batch 2</option>
                  <option value="Batch 3">Lab: Batch 3</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-xs"
                >
                  Add Slot
                </button>
              </div>
            </form>

            {/* Slots for this day */}
            <div className="space-y-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">
                Slots Scheduled for {activeDay}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {timetable.filter(t => t.day_of_week === activeDay).map((t, idx) => {
                  const sub = subjects.find(s => s.code === t.subject_code);
                  return (
                    <div key={idx} className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="font-mono text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                            {t.subject_code}
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                            t.slot_type === 'Lab' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {t.slot_type} • {t.batch}
                          </span>
                        </div>
                        <div className="font-bold text-xs text-slate-900">{sub?.name || t.subject_code}</div>
                        <div className="text-[10px] text-slate-400 font-mono mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {t.start_time} - {t.end_time}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setTimetable(prev => prev.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-red-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="px-5 py-2.5 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => goToStep(4)}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center space-x-2"
              >
                <span>Next: Configure Batch Ranges</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 4: BATCH RANGES ================= */}
        {currentStep === 4 && (
          <div className="space-y-6 max-w-2xl">
            <div>
              <h3 className="text-lg font-black text-slate-900">Step 4: Configure Lab Batch Ranges</h3>
              <p className="text-xs text-slate-500 mt-1">
                Actually we are around 140 students and categorized as three batches. Specify from which registration number to which is Batch 1, Batch 2, and Batch 3.
              </p>
            </div>

            <div className="space-y-4 text-xs">
              {batchRanges.map((br, idx) => (
                <div key={br.batch_name} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-black text-slate-900 uppercase">{br.batch_name}</span>
                    <span className="text-[10px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-full">
                      Lab Group {idx + 1}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">From Reg. No (Start)</label>
                      <input
                        type="text"
                        required
                        maxLength={12}
                        value={br.start_reg_no}
                        onChange={(e) => {
                          const updated = [...batchRanges];
                          updated[idx].start_reg_no = e.target.value.trim();
                          setBatchRanges(updated);
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">To Reg. No (End)</label>
                      <input
                        type="text"
                        required
                        maxLength={12}
                        value={br.end_reg_no}
                        onChange={(e) => {
                          const updated = [...batchRanges];
                          updated[idx].end_reg_no = e.target.value.trim();
                          setBatchRanges(updated);
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => goToStep(3)}
                className="px-5 py-2.5 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => goToStep(5)}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center space-x-2"
              >
                <span>Next: Add Students</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 5: STUDENT DETAILS ================= */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">Step 5: Student Details</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Add the students in your class. You can paste a list from Excel/Notepad or add them individually.
                </p>
              </div>

              <button
                type="button"
                onClick={handleGenerateSample140}
                className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-bold rounded-xl border border-indigo-200 transition flex items-center space-x-1.5 self-start sm:self-auto"
              >
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>Prefill 140 AU CSE Students List</span>
              </button>
            </div>

            {/* Input Mode Selector */}
            <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
              <button
                type="button"
                onClick={() => setStudentInputMode('bulk')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                  studentInputMode === 'bulk'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Quick Bulk Paste / Import
              </button>
              <button
                type="button"
                onClick={() => setStudentInputMode('single')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                  studentInputMode === 'single'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Add Individual Student
              </button>
            </div>

            {/* Bulk Text Area */}
            {studentInputMode === 'bulk' && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  Paste Students List — select the whole block of columns in Excel/Sheets
                  (<span className="font-mono text-blue-700">Name of the Candidate, Registration Number, Mobile Number, Admn.No, Email Address, Category of admission</span>)
                  and paste it directly below.
                </label>
                <p className="text-[11px] text-slate-500">
                  Works with or without the header row, in that order or any order (headers are auto-detected), and it's fine to leave any
                  column blank for some rows — only Name and a 12-digit Registration Number are required. A plain <span className="font-mono">RegNo, Name</span> list
                  still works too.
                </p>
                <textarea
                  rows={6}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={`Name of the Candidate\tRegistration Number\tMobile Number\tAdmn.No\tEmail Address\tCategory of admission\nExample Student\t999999000001\t9000000001\t\tstudent@example.edu\tConvener (EAPCET)\nExample Student 2\t999999000002\t\t\t\t`}
                  className="w-full p-3 bg-white border border-slate-300 rounded-xl text-xs font-mono"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleParseBulkText}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs"
                  >
                    Parse & Auto-Assign to Batches
                  </button>
                </div>
              </div>
            )}

            {/* Single Student Form */}
            {studentInputMode === 'single' && (
              <form onSubmit={handleAddSingleStudent} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-6 gap-3 text-xs">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-600 mb-1">Reg. No (12 digits) *</label>
                  <input
                    type="text"
                    required
                    maxLength={12}
                    minLength={12}
                    placeholder="999999000001"
                    value={singleStudent.reg_no}
                    onChange={(e) => setSingleStudent({ ...singleStudent, reg_no: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-600 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    placeholder="Example Student"
                    value={singleStudent.name}
                    onChange={(e) => setSingleStudent({ ...singleStudent, name: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-600 mb-1">Mobile Number</label>
                  <input
                    type="text"
                    placeholder="+91 90000..."
                    value={singleStudent.mobile}
                    onChange={(e) => setSingleStudent({ ...singleStudent, mobile: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-600 mb-1">Student Email</label>
                  <input
                    type="email"
                    placeholder="student@example.edu"
                    value={singleStudent.email}
                    onChange={(e) => setSingleStudent({ ...singleStudent, email: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-600 mb-1">Category of Admission</label>
                  <select
                    value={singleStudent.category}
                    onChange={(e) => setSingleStudent({ ...singleStudent, category: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-medium"
                  >
                    <option value="Convener (EAPCET)">Convener (EAPCET)</option>
                    <option value="Management (Category B)">Management (Category B)</option>
                    <option value="Lateral Entry (ECET)">Lateral Entry (ECET)</option>
                    <option value="Sports / Special Quota">Sports / Special Quota</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-600 mb-1">Admission Number</label>
                  <input
                    type="text"
                    placeholder="e.g. TEST-CSE-2026-0028"
                    value={singleStudent.admission_no}
                    onChange={(e) => setSingleStudent({ ...singleStudent, admission_no: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl font-mono"
                  />
                </div>

                <div className="sm:col-span-6 flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-xs flex items-center space-x-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Student to Roster</span>
                  </button>
                </div>
              </form>
            )}

            {/* Students Table Preview */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Enrolled Students ({students.length})</span>
                <div className="flex items-center space-x-3 text-[11px]">
                  <span>Batch 1: {students.filter(s => s.batch === 'Batch 1').length}</span>
                  <span>Batch 2: {students.filter(s => s.batch === 'Batch 2').length}</span>
                  <span>Batch 3: {students.filter(s => s.batch === 'Batch 3').length}</span>
                </div>
              </div>

              {students.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 font-medium">
                  No students added yet. Use the bulk paste or single entry form above, or click "Prefill 140 AU CSE Students List".
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-400 font-mono text-[10px]">
                        <th className="py-2 px-4">Reg No</th>
                        <th className="py-2 px-4">Name</th>
                        <th className="py-2 px-4">Batch</th>
                        <th className="py-2 px-4">Mobile & Email</th>
                        <th className="py-2 px-4">Category & Adm. No</th>
                        <th className="py-2 px-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students.map((s) => (
                        <tr key={s.reg_no} className="hover:bg-slate-50">
                          <td className="py-2 px-4 font-mono font-bold text-slate-800">{s.reg_no}</td>
                          <td className="py-2 px-4 font-bold text-slate-900">{s.name}</td>
                          <td className="py-2 px-4 font-semibold text-indigo-700">{s.batch}</td>
                          <td className="py-2 px-4 text-slate-500">
                            <div className="font-mono text-[11px]">{s.mobile || '—'}</div>
                            <div className="text-[10px] text-slate-400">{s.email || '—'}</div>
                          </td>
                          <td className="py-2 px-4 text-slate-600">
                            <div>{s.category || '—'}</div>
                            <div className="text-[10px] font-mono text-slate-400">{s.admission_no || '—'}</div>
                          </td>
                          <td className="py-2 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => setStudents(prev => prev.filter(st => st.reg_no !== s.reg_no))}
                              className="text-slate-400 hover:text-red-600 p-1"
                              title="Remove"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {students.length > 50 && (
                    <div className="p-2 text-center text-[11px] text-slate-400 bg-slate-50">
                      Showing all {students.length} students enrolled in roster.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => goToStep(4)}
                className="px-5 py-2.5 border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50"
              >
                Back
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmitAll}
                className="px-8 py-3 bg-amber-600 hover:bg-amber-700 text-white font-black text-sm rounded-xl shadow-lg transition flex items-center space-x-2 disabled:opacity-50"
              >
                {submitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Commit Setup & Start Marking Attendance</span>
                  </>
                )}
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
