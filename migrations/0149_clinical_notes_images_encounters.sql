-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0149: Clinical Notes + Clinical Images + Encounters
-- EHR gap fill — new tables for doctor-facing clinical workflows
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CLINICAL NOTES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinical_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  visit_id INTEGER REFERENCES visits(id),
  note_type TEXT NOT NULL DEFAULT 'progress',
  title TEXT,
  content TEXT NOT NULL,
  chief_complaint TEXT,
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  follow_up TEXT,
  follow_up_unit TEXT,
  template_id INTEGER,
  performer_id INTEGER,
  is_signed INTEGER DEFAULT 0,
  signed_by INTEGER,
  signed_at DATETIME,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_cln_notes_patient ON clinical_notes(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_cln_notes_visit ON clinical_notes(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_cln_notes_type ON clinical_notes(tenant_id, note_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CLINICAL IMAGES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clinical_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  visit_id INTEGER REFERENCES visits(id),
  image_type TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  description TEXT,
  file_key TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  body_part TEXT,
  is_active INTEGER DEFAULT 1,
  uploaded_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_cln_images_patient ON clinical_images(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_cln_images_visit ON clinical_images(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_cln_images_type ON clinical_images(tenant_id, image_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ENCOUNTERS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS encounters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  visit_id INTEGER REFERENCES visits(id),
  encounter_type TEXT NOT NULL DEFAULT 'outpatient',
  status TEXT NOT NULL DEFAULT 'in_progress',
  start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME,
  provider_id INTEGER,
  department_id INTEGER,
  reason_for_visit TEXT,
  chief_complaint TEXT,
  disposition_code TEXT,
  disposition_note TEXT,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_visit ON encounters(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_encounters_status ON encounters(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_encounters_provider ON encounters(tenant_id, provider_id);
