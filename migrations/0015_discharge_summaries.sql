-- Migration: 0015_discharge_summaries
-- Discharge summaries + doctor BMDC/schedule tables

-- ── Discharge Summaries ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discharge_summaries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id            INTEGER NOT NULL,
  admission_id         INTEGER NOT NULL,
  patient_id           INTEGER NOT NULL,

  -- Clinical content
  admission_diagnosis  TEXT,
  final_diagnosis      TEXT,
  treatment_summary    TEXT,
  procedures_performed TEXT,          -- JSON array of strings
  medicines_on_discharge TEXT,        -- JSON array of {name, dose, frequency, duration}
  follow_up_date       TEXT,          -- YYYY-MM-DD
  follow_up_instructions TEXT,
  doctor_notes         TEXT,

  -- Status
  status               TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
  finalized_at         TEXT,
  finalized_by         INTEGER,       -- user_id

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(tenant_id, admission_id)     -- one summary per admission
);

CREATE INDEX IF NOT EXISTS idx_discharge_summaries_tenant    ON discharge_summaries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_discharge_summaries_admission ON discharge_summaries(admission_id);
CREATE INDEX IF NOT EXISTS idx_discharge_summaries_patient   ON discharge_summaries(patient_id);

-- ── Doctor Schedules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL,
  doctor_id    INTEGER NOT NULL,
  day_of_week  TEXT NOT NULL CHECK(day_of_week IN ('sun','mon','tue','wed','thu','fri','sat')),
  start_time   TEXT NOT NULL,  -- HH:MM (24h)
  end_time     TEXT NOT NULL,  -- HH:MM (24h)
  session_type TEXT NOT NULL DEFAULT 'morning' CHECK(session_type IN ('morning','afternoon','evening','night')),
  chamber      TEXT,           -- chamber/room name
  max_patients INTEGER NOT NULL DEFAULT 20,
  is_active    INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_doctor_schedules_tenant ON doctor_schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor ON doctor_schedules(doctor_id, tenant_id);

-- ── Add BMDC number to doctors table (safe - ignored if column exists) ─────────
-- SQLite does not support IF NOT EXISTS on ALTER TABLE
-- These will fail silently if already applied; run them one by one in wrangler
ALTER TABLE doctors ADD COLUMN bmdc_reg_no TEXT;
ALTER TABLE doctors ADD COLUMN qualifications TEXT;
ALTER TABLE doctors ADD COLUMN visiting_hours TEXT;   -- display text e.g. "Sat-Thu 9am-1pm"
