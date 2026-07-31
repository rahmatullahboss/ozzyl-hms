-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0148: Consent Management + Document Management + Quality KPIs
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CONSENT MANAGEMENT
-- ─────────────────────────────────────────────────────────────────────────────

-- Consent form templates (reusable consent types)
CREATE TABLE IF NOT EXISTS consent_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  title TEXT NOT NULL,                -- 'General Admission Consent', 'Surgical Consent', 'Blood Transfusion', 'Anesthesia'
  category TEXT NOT NULL,             -- 'admission', 'surgical', 'procedure', 'blood', 'anesthesia', 'research', 'discharge', 'other'
  body_html TEXT,                     -- consent form content (HTML template)
  requires_witness INTEGER DEFAULT 0,
  requires_guardian INTEGER DEFAULT 0, -- for minors
  language TEXT DEFAULT 'bn',         -- 'bn'=Bangla, 'en'=English
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_code ON consent_templates(tenant_id, code);

-- Patient consents (signed instances)
CREATE TABLE IF NOT EXISTS patient_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER,
  admission_id INTEGER,
  template_id INTEGER REFERENCES consent_templates(id),
  consent_type TEXT NOT NULL,         -- matches template category
  title TEXT NOT NULL,
  procedure_name TEXT,                -- specific procedure being consented for
  procedure_date DATETIME,
  doctor_id INTEGER,
  doctor_name TEXT,
  -- Consent details
  risks_explained INTEGER DEFAULT 0,
  alternatives_explained INTEGER DEFAULT 0,
  questions_answered INTEGER DEFAULT 0,
  -- Signatures
  patient_signature TEXT,             -- base64 image or 'signed' flag
  patient_signed_at DATETIME,
  witness_name TEXT,
  witness_signature TEXT,
  witness_signed_at DATETIME,
  guardian_name TEXT,
  guardian_relationship TEXT,
  guardian_signature TEXT,
  guardian_signed_at DATETIME,
  -- Status
  status TEXT DEFAULT 'pending',      -- 'pending', 'signed', 'revoked', 'expired'
  revoked_at DATETIME,
  revoked_reason TEXT,
  notes TEXT,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pc_patient ON patient_consents(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_pc_visit ON patient_consents(visit_id);
CREATE INDEX IF NOT EXISTS idx_pc_status ON patient_consents(tenant_id, status);

-- Seed consent templates
INSERT OR IGNORE INTO consent_templates (code, title, category, body_html, requires_witness, language, tenant_id) VALUES
('GENERAL_ADMIT', 'General Admission Consent', 'admission', '<p>I voluntarily consent to admission and treatment at this hospital. I understand that the medical team will provide care as deemed necessary.</p>', 0, 'bn', '__seed__'),
('SURGICAL', 'Surgical/Operative Consent', 'surgical', '<p>I consent to the surgical procedure described above. The nature, risks, benefits, and alternatives have been explained to me. I understand there may be unforeseen conditions requiring additional procedures.</p>', 1, 'bn', '__seed__'),
('BLOOD_TRANSFUSION', 'Blood Transfusion Consent', 'blood', '<p>I consent to receive blood/blood products. I understand the risks including transfusion reactions, infections, and allergic responses.</p>', 1, 'bn', '__seed__'),
('ANESTHESIA', 'Anesthesia Consent', 'anesthesia', '<p>I consent to anesthesia administration. Risks including allergic reaction, nausea, nerve damage, and rare complications have been explained.</p>', 0, 'bn', '__seed__'),
('DISCHARGE_AMA', 'Discharge Against Medical Advice', 'discharge', '<p>I am leaving the hospital against medical advice. I understand the risks of leaving before completing treatment and release the hospital from liability.</p>', 1, 'bn', '__seed__'),
('PROCEDURE_GENERAL', 'General Procedure Consent', 'procedure', '<p>I consent to the procedure described. The purpose, risks, and alternatives have been explained to me.</p>', 0, 'bn', '__seed__');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DOCUMENT MANAGEMENT
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patient_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER,
  document_type TEXT NOT NULL,        -- 'lab_report', 'imaging', 'referral', 'prescription', 'consent', 'discharge_summary', 'insurance', 'id_document', 'other'
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  file_size INTEGER,                  -- bytes
  mime_type TEXT,                     -- 'application/pdf', 'image/jpeg', etc.
  storage_key TEXT NOT NULL,          -- R2 object key or local path
  storage_provider TEXT DEFAULT 'r2', -- 'r2', 'local', 'base64'
  thumbnail_key TEXT,                 -- for images
  -- Metadata
  document_date DATE,                 -- date on the document itself
  source TEXT,                        -- 'upload', 'scan', 'system_generated', 'imported'
  uploaded_by INTEGER,
  department TEXT,
  tags TEXT,                          -- JSON array of tags
  -- Access control
  is_confidential INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pd_patient ON patient_documents(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_pd_type ON patient_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_pd_date ON patient_documents(document_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. QUALITY KPI — No new tables needed (queries aggregate from existing data)
--    But add a KPI snapshots table for historical tracking
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quality_kpi_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date DATE NOT NULL,
  metric_name TEXT NOT NULL,          -- 'alos', 'bed_occupancy', 'readmission_rate', 'mortality_rate', etc.
  metric_value REAL NOT NULL,
  metric_unit TEXT,                   -- 'days', 'percent', 'count', 'bdt'
  department TEXT,                    -- NULL = hospital-wide
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kpi_tenant ON quality_kpi_snapshots(tenant_id, snapshot_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_unique ON quality_kpi_snapshots(tenant_id, snapshot_date, metric_name, department);
