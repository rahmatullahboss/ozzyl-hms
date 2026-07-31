-- Migration 0188: Nursing + IPD Danphe parity backlog
-- Adds ADT bed configuration, reservations, transfer workflow, discharge templates,
-- birth/death lookup support, nursing OPD extensions, printable/certificate support,
-- and advanced IPD records.

-- Admissions: advanced ADT flags/workflows
ALTER TABLE admissions ADD COLUMN procedure_type TEXT;
ALTER TABLE admissions ADD COLUMN is_police_case INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admissions ADD COLUMN previous_bed_id INTEGER;
ALTER TABLE admissions ADD COLUMN transfer_status TEXT;
ALTER TABLE admissions ADD COLUMN transfer_requested_on TEXT;
ALTER TABLE admissions ADD COLUMN transfer_received_on TEXT;
ALTER TABLE admissions ADD COLUMN transfer_remark TEXT;
ALTER TABLE admissions ADD COLUMN discharge_due_cleared_on TEXT;
ALTER TABLE admissions ADD COLUMN discharge_due_cleared_by TEXT;
ALTER TABLE admissions ADD COLUMN billing_discharge_on TEXT;
ALTER TABLE admissions ADD COLUMN billing_discharge_by TEXT;

ALTER TABLE discharge_summaries ADD COLUMN template_id INTEGER;
ALTER TABLE discharge_summaries ADD COLUMN lab_tests TEXT;
ALTER TABLE discharge_summaries ADD COLUMN imaging_items TEXT;

-- Bed features / maps
CREATE TABLE IF NOT EXISTS bed_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT '0',
  name TEXT NOT NULL,
  description TEXT,
  rate_per_day REAL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS bed_feature_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bed_id INTEGER NOT NULL,
  feature_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, bed_id, feature_id)
);

INSERT OR IGNORE INTO bed_features (tenant_id, name, description, rate_per_day) VALUES
  ('0', 'General', 'General inpatient bed', 0),
  ('0', 'AC', 'Air-conditioned bed/room', 0),
  ('0', 'Non-AC', 'Non air-conditioned bed/room', 0),
  ('0', 'Attached Bath', 'Attached bathroom available', 0),
  ('0', 'Oxygen', 'Oxygen outlet available', 0),
  ('0', 'ICU', 'Intensive care bed', 0),
  ('0', 'HDU', 'High dependency bed', 0),
  ('0', 'NICU', 'Neonatal intensive care bed', 0);

CREATE INDEX IF NOT EXISTS idx_bed_features_tenant ON bed_features(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_bed_feature_map_bed ON bed_feature_map(tenant_id, bed_id);
CREATE INDEX IF NOT EXISTS idx_bed_feature_map_feature ON bed_feature_map(tenant_id, feature_id);

-- Bed reservations / advance booking
CREATE TABLE IF NOT EXISTS bed_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  bed_id INTEGER NOT NULL,
  reserved_from TEXT NOT NULL,
  reserved_to TEXT,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','admitted','cancelled','expired')),
  remarks TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bed_res_tenant_status ON bed_reservations(tenant_id, status, reserved_from);
CREATE INDEX IF NOT EXISTS idx_bed_res_bed ON bed_reservations(tenant_id, bed_id, status);
CREATE INDEX IF NOT EXISTS idx_bed_res_patient ON bed_reservations(tenant_id, patient_id);

-- Admission remarks / notes
CREATE TABLE IF NOT EXISTS admission_remarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  patient_id INTEGER,
  remark TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admission_remarks_adm ON admission_remarks(tenant_id, admission_id);

-- Discharge summary templates + consultants
CREATE TABLE IF NOT EXISTS discharge_summary_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_dst_tenant ON discharge_summary_templates(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS discharge_summary_consultants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  discharge_summary_id INTEGER NOT NULL,
  consultant_id INTEGER NOT NULL,
  role TEXT DEFAULT 'consultant',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, discharge_summary_id, consultant_id)
);
CREATE INDEX IF NOT EXISTS idx_dsc_summary ON discharge_summary_consultants(tenant_id, discharge_summary_id);

CREATE TABLE IF NOT EXISTS provisional_discharges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_clearance' CHECK(status IN ('pending_clearance','cleared','cancelled','finalized')),
  billing_status TEXT NOT NULL DEFAULT 'pending' CHECK(billing_status IN ('pending','cleared','blocked')),
  discharged_by TEXT,
  cleared_by TEXT,
  note TEXT,
  clearance_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cleared_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, admission_id)
);
CREATE INDEX IF NOT EXISTS idx_prov_discharge_status ON provisional_discharges(tenant_id, status, billing_status);

-- Birth/death lookup + admission linkage
CREATE TABLE IF NOT EXISTS death_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT '0',
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, name)
);
INSERT OR IGNORE INTO death_types (tenant_id, name, display_order) VALUES
  ('0', 'Natural', 1),
  ('0', 'Accidental', 2),
  ('0', 'Suicide', 3),
  ('0', 'Homicide', 4),
  ('0', 'Undetermined', 5),
  ('0', 'Pending Investigation', 6);

CREATE TABLE IF NOT EXISTS baby_birth_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT '0',
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, name)
);
INSERT OR IGNORE INTO baby_birth_conditions (tenant_id, name, display_order) VALUES
  ('0', 'Live Birth', 1),
  ('0', 'Still Birth', 2),
  ('0', 'Neonatal Death', 3);

ALTER TABLE baby_birth_details ADD COLUMN admission_id INTEGER;
ALTER TABLE baby_birth_details ADD COLUMN birth_condition_id INTEGER;
ALTER TABLE baby_birth_details ADD COLUMN apgar_score TEXT;
ALTER TABLE baby_birth_details ADD COLUMN remarks TEXT;

-- If death_details came from the medical-records schema, these columns are added by 0183.
-- 0188 only adds lookup-compatible columns not covered there.
ALTER TABLE death_details ADD COLUMN death_type_id INTEGER;
ALTER TABLE death_details ADD COLUMN is_medico_legal INTEGER NOT NULL DEFAULT 0;

-- Hemodialysis reports
CREATE TABLE IF NOT EXISTS hemodialysis_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER,
  patient_id INTEGER NOT NULL,
  report_date TEXT NOT NULL DEFAULT (date('now')),
  pre_weight REAL,
  post_weight REAL,
  pre_bp TEXT,
  post_bp TEXT,
  dialysis_duration_min INTEGER,
  access_type TEXT,
  dialyzer TEXT,
  blood_flow_rate TEXT,
  dialysate_flow_rate TEXT,
  ultrafiltration REAL,
  heparin_dose TEXT,
  complications TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hemo_patient ON hemodialysis_reports(tenant_id, patient_id, report_date);
CREATE INDEX IF NOT EXISTS idx_hemo_admission ON hemodialysis_reports(tenant_id, admission_id);

-- ADT billing/config
CREATE TABLE IF NOT EXISTS adt_auto_billing_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bed_feature_id INTEGER NOT NULL,
  billing_item_id INTEGER,
  item_name TEXT,
  price REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, bed_feature_id, billing_item_id)
);

CREATE TABLE IF NOT EXISTS adt_deposit_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_type TEXT NOT NULL,
  bed_feature_id INTEGER,
  min_deposit_amount REAL NOT NULL DEFAULT 0,
  is_mandatory INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, admission_type, bed_feature_id)
);

CREATE TABLE IF NOT EXISTS adt_bed_feature_scheme_price_category_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bed_feature_id INTEGER NOT NULL,
  scheme_id INTEGER,
  price_category_id INTEGER,
  price REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, bed_feature_id, scheme_id, price_category_id)
);

-- Nursing OPD extras
CREATE TABLE IF NOT EXISTS nursing_opd_referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  visit_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  from_doctor_id INTEGER,
  to_doctor_id INTEGER,
  to_department_id INTEGER,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_nursing_opd_ref_visit ON nursing_opd_referrals(tenant_id, visit_id);

CREATE TABLE IF NOT EXISTS nursing_final_diagnoses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  visit_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  final_diagnosis TEXT NOT NULL,
  icd10_code TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, visit_id)
);
CREATE INDEX IF NOT EXISTS idx_nursing_final_dx_patient ON nursing_final_diagnoses(tenant_id, patient_id);
