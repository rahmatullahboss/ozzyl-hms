-- Migration: Add water tracking to lifestyle logs + Medicine reminders table
-- Part of Phase 3 "Active Health" backend support

-- ─── Water Tracking ─────────────────────────────────────────────────────
ALTER TABLE global_patient_lifestyle_logs ADD COLUMN water_glasses INTEGER DEFAULT 0;

-- ─── Medicine Reminders ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_patient_medicine_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uhid TEXT NOT NULL,
  medicine_name TEXT NOT NULL,
  dosage TEXT,
  time_slot TEXT NOT NULL,           -- e.g. "08:00", "14:00", "22:00"
  time_label TEXT,                   -- e.g. "সকাল ৮:০০"
  instruction TEXT DEFAULT 'after_meal' CHECK(instruction IN ('before_meal', 'after_meal', 'with_meal', 'anytime')),
  instruction_label TEXT,            -- e.g. "খালি পেটে খাবেন"
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uhid) REFERENCES global_patient_identity(uhid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gpmr_uhid ON global_patient_medicine_reminders(uhid);
CREATE INDEX IF NOT EXISTS idx_gpmr_active ON global_patient_medicine_reminders(uhid, is_active);

-- ─── Medicine Adherence Log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_patient_medicine_adherence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uhid TEXT NOT NULL,
  reminder_id INTEGER NOT NULL,
  taken_date TEXT NOT NULL,          -- YYYY-MM-DD
  taken_at DATETIME,                 -- actual time taken
  skipped INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uhid) REFERENCES global_patient_identity(uhid) ON DELETE CASCADE,
  FOREIGN KEY (reminder_id) REFERENCES global_patient_medicine_reminders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gpma_uhid_date ON global_patient_medicine_adherence(uhid, taken_date);
CREATE INDEX IF NOT EXISTS idx_gpma_reminder ON global_patient_medicine_adherence(reminder_id, taken_date);
