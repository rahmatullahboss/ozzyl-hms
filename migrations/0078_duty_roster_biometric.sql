-- Migration: 0078_duty_roster_biometric.sql
-- Duty Roster, Biometric Device Registration, Card Punch, Overtime
-- Extends existing HR module (0049_hr_module.sql)

-- ═══════════════════════════════════════════════════════════════════════
-- 1. EXTEND hr_shifts WITH ADDITIONAL FIELDS
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE hr_shifts ADD COLUMN break_duration INTEGER DEFAULT 0;        -- minutes
ALTER TABLE hr_shifts ADD COLUMN is_night_shift INTEGER DEFAULT 0;
ALTER TABLE hr_shifts ADD COLUMN color TEXT DEFAULT '#0891b2';            -- UI color for calendar
ALTER TABLE hr_shifts ADD COLUMN short_code TEXT;                         -- e.g. 'M', 'E', 'N'

-- ═══════════════════════════════════════════════════════════════════════
-- 2. DUTY ROSTER (assign staff → shift → date)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_duty_roster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    shift_id INTEGER NOT NULL,
    roster_date TEXT NOT NULL,           -- YYYY-MM-DD
    status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','swapped','cancelled')),
    swapped_with_staff_id INTEGER,       -- if swapped
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (shift_id) REFERENCES hr_shifts(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_roster_unique ON hr_duty_roster(tenant_id, staff_id, roster_date);
CREATE INDEX IF NOT EXISTS idx_hr_roster_date ON hr_duty_roster(tenant_id, roster_date);
CREATE INDEX IF NOT EXISTS idx_hr_roster_staff ON hr_duty_roster(tenant_id, staff_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. SHIFT ROTATION PATTERNS (auto-assign repeating patterns)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_rotation_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    pattern_name TEXT NOT NULL,          -- e.g. "3-shift weekly rotation"
    cycle_days INTEGER NOT NULL,         -- e.g. 7 for weekly
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_rotation_tenant ON hr_rotation_patterns(tenant_id);

-- Day-level pattern definition (day 1 = shift A, day 2 = shift B, etc.)
CREATE TABLE IF NOT EXISTS hr_rotation_pattern_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_id INTEGER NOT NULL,
    day_number INTEGER NOT NULL,         -- 1-based within cycle
    shift_id INTEGER NOT NULL,
    is_off INTEGER DEFAULT 0,            -- day off in rotation
    FOREIGN KEY (pattern_id) REFERENCES hr_rotation_patterns(id) ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES hr_shifts(id),
    UNIQUE(pattern_id, day_number)
);

-- Staff assigned to rotation patterns
CREATE TABLE IF NOT EXISTS hr_staff_rotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    pattern_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,                        -- NULL = ongoing
    cycle_offset INTEGER DEFAULT 0,      -- offset within pattern (for staggered starts)
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (pattern_id) REFERENCES hr_rotation_patterns(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_staff_rotation ON hr_staff_rotations(tenant_id, staff_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. BIOMETRIC DEVICES (for Dell R730 integration)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_biometric_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    device_name TEXT NOT NULL,           -- e.g. "Main Gate ZKTeco"
    device_type TEXT NOT NULL CHECK(device_type IN ('fingerprint','rfid','face','card','combo')),
    device_serial TEXT,                  -- manufacturer serial
    ip_address TEXT,                     -- device IP on local network
    location TEXT,                       -- "Main Entrance", "OT Block"
    api_key_hash TEXT,                   -- hashed API key for webhook auth
    is_active INTEGER DEFAULT 1,
    last_sync_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_biometric_tenant ON hr_biometric_devices(tenant_id);

-- Staff biometric enrollments (fingerprint/card mappings)
CREATE TABLE IF NOT EXISTS hr_biometric_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    device_id INTEGER,
    enrollment_type TEXT NOT NULL CHECK(enrollment_type IN ('fingerprint','rfid','face','card','pin')),
    enrollment_code TEXT NOT NULL,       -- biometric template ID / RFID card number
    is_active INTEGER DEFAULT 1,
    enrolled_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (device_id) REFERENCES hr_biometric_devices(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_enroll_staff ON hr_biometric_enrollments(tenant_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_hr_enroll_code ON hr_biometric_enrollments(enrollment_code);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. ATTENDANCE PUNCHES (raw punch log — multiple per day allowed)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_attendance_punches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    punch_time TEXT NOT NULL,            -- ISO datetime
    punch_type TEXT NOT NULL CHECK(punch_type IN ('in','out','break_start','break_end')),
    source TEXT DEFAULT 'manual' CHECK(source IN ('biometric','rfid','manual','web','mobile','device')),
    device_id INTEGER,
    device_serial TEXT,                  -- device serial for webhook punches
    raw_data TEXT,                       -- raw payload from device
    remarks TEXT,                        -- manual punch notes
    created_by INTEGER,                  -- user who created manual punch
    is_valid INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (device_id) REFERENCES hr_biometric_devices(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_punch_staff ON hr_attendance_punches(tenant_id, staff_id, punch_time);
CREATE INDEX IF NOT EXISTS idx_hr_punch_date ON hr_attendance_punches(tenant_id, punch_time);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. OVERTIME RULES & LOG
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_overtime_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    rule_name TEXT NOT NULL,             -- "Weekday OT", "Weekend OT", "Holiday OT"
    multiplier REAL NOT NULL DEFAULT 1.5,-- 1.5x, 2x, etc.
    min_hours_before_ot REAL DEFAULT 0,  -- must work X hours before OT kicks in
    max_ot_hours_per_day REAL DEFAULT 4, -- cap
    applies_on TEXT DEFAULT 'weekday' CHECK(applies_on IN ('weekday','weekend','holiday','all')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_ot_rules_tenant ON hr_overtime_rules(tenant_id);

CREATE TABLE IF NOT EXISTS hr_overtime_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    scheduled_hours REAL NOT NULL DEFAULT 0,
    actual_hours REAL NOT NULL DEFAULT 0,
    overtime_hours REAL NOT NULL DEFAULT 0,
    rule_id INTEGER,
    multiplier REAL DEFAULT 1.5,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    approved_by INTEGER,
    approved_at TEXT,
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (rule_id) REFERENCES hr_overtime_rules(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_ot_log_staff ON hr_overtime_log(tenant_id, staff_id, date);

-- ═══════════════════════════════════════════════════════════════════════
-- 7. HOLIDAYS (for overtime calc + roster planning)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    holiday_name TEXT NOT NULL,
    holiday_date TEXT NOT NULL,           -- YYYY-MM-DD
    holiday_type TEXT DEFAULT 'public' CHECK(holiday_type IN ('public','optional','restricted')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_holiday_unique ON hr_holidays(tenant_id, holiday_date);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. PERFORMANCE INDEXES
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_hr_roster_shift ON hr_duty_roster(shift_id);
CREATE INDEX IF NOT EXISTS idx_hr_punch_source ON hr_attendance_punches(source);
CREATE INDEX IF NOT EXISTS idx_hr_ot_log_status ON hr_overtime_log(status);
