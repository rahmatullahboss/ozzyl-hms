-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0053_radiology.sql
-- Radiology module — imaging types, items, report templates, requisitions,
-- reports, film types, and DICOM/PACS study tracking (R2-backed)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Imaging Types (X-Ray, CT, MRI, USG, etc.)
CREATE TABLE IF NOT EXISTS radiology_imaging_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT,         -- short code e.g. 'XR', 'CT', 'MRI'
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT
);

-- 2. Imaging Items (specific tests within a type)
CREATE TABLE IF NOT EXISTS radiology_imaging_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           TEXT NOT NULL,
  imaging_type_id     INTEGER NOT NULL REFERENCES radiology_imaging_types(id),
  name                TEXT NOT NULL,
  procedure_code      TEXT,
  template_id         INTEGER,   -- FK to report templates (nullable)
  price_paisa         INTEGER DEFAULT 0,
  is_valid_reporting  INTEGER NOT NULL DEFAULT 1,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_by          TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT
);

-- 3. Report Templates (HTML templates for radiology findings)
CREATE TABLE IF NOT EXISTS radiology_report_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  code          TEXT,
  template_html TEXT,
  footer_note   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT
);

-- 4. Film Types (media used for imaging)
CREATE TABLE IF NOT EXISTS radiology_film_types (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  film_type         TEXT NOT NULL,
  display_name      TEXT,
  imaging_type_id   INTEGER REFERENCES radiology_imaging_types(id),
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- 5. Requisitions (imaging orders)
CREATE TABLE IF NOT EXISTS radiology_requisitions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id             TEXT NOT NULL,
  patient_id            INTEGER NOT NULL,
  visit_id              INTEGER,
  admission_id          INTEGER,
  imaging_type_id       INTEGER REFERENCES radiology_imaging_types(id),
  imaging_type_name     TEXT,
  imaging_item_id       INTEGER REFERENCES radiology_imaging_items(id),
  imaging_item_name     TEXT,
  procedure_code        TEXT,
  prescriber_id         INTEGER,
  prescriber_name       TEXT,
  imaging_date          TEXT,    -- YYYY-MM-DD
  requisition_remarks   TEXT,
  urgency               TEXT NOT NULL DEFAULT 'normal' CHECK(urgency IN ('normal','urgent','stat')),
  ward_name             TEXT,
  has_insurance         INTEGER NOT NULL DEFAULT 0,
  order_status          TEXT NOT NULL DEFAULT 'pending' CHECK(order_status IN ('pending','scanned','reported','cancelled')),
  is_report_saved       INTEGER NOT NULL DEFAULT 0,
  is_scanned            INTEGER NOT NULL DEFAULT 0,
  scanned_by            TEXT,
  scanned_on            TEXT,
  scan_remarks          TEXT,
  film_type_id          INTEGER REFERENCES radiology_film_types(id),
  film_quantity         INTEGER,
  is_active             INTEGER NOT NULL DEFAULT 1,
  cancel_remarks        TEXT,            -- F-10: included in base schema for clean installs
  created_by            TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT
);

-- 6. Radiology Reports (findings linked to a requisition)
CREATE TABLE IF NOT EXISTS radiology_reports (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id             TEXT NOT NULL,
  requisition_id        INTEGER NOT NULL REFERENCES radiology_requisitions(id),
  patient_id            INTEGER NOT NULL,
  visit_id              INTEGER,
  imaging_type_id       INTEGER,
  imaging_type_name     TEXT,
  imaging_item_id       INTEGER,
  imaging_item_name     TEXT,
  prescriber_id         INTEGER,
  prescriber_name       TEXT,
  performer_id          INTEGER,   -- radiologist who reads/reports
  performer_name        TEXT,
  template_id           INTEGER REFERENCES radiology_report_templates(id),
  report_text           TEXT,
  indication            TEXT,
  radiology_number      TEXT,      -- unique report number
  image_name            TEXT,
  image_key             TEXT,      -- R2 key for uploaded image
  patient_study_id      INTEGER,   -- FK to PACS study
  signatories           TEXT,      -- JSON: [{name, role, signature}]
  order_status          TEXT NOT NULL DEFAULT 'pending' CHECK(order_status IN ('pending','final')),
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_by            TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT
);

-- 7. PACS DICOM Studies (Study → Series hierarchy, files in R2)
CREATE TABLE IF NOT EXISTS radiology_dicom_studies (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           TEXT NOT NULL,
  patient_id          INTEGER,
  patient_name        TEXT,
  study_instance_uid  TEXT NOT NULL,
  sop_class_uid       TEXT,
  study_date          TEXT,
  modality            TEXT,    -- CR, CT, MR, US, MG, etc.
  study_description   TEXT,
  requisition_id      INTEGER REFERENCES radiology_requisitions(id),
  is_mapped           INTEGER NOT NULL DEFAULT 0,
  series_count        INTEGER NOT NULL DEFAULT 0,
  image_count         INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_rad_types_tenant       ON radiology_imaging_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rad_items_tenant       ON radiology_imaging_items(tenant_id, imaging_type_id);
CREATE INDEX IF NOT EXISTS idx_rad_templates_tenant   ON radiology_report_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rad_req_tenant         ON radiology_requisitions(tenant_id, order_status);
CREATE INDEX IF NOT EXISTS idx_rad_req_patient        ON radiology_requisitions(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_rad_req_date           ON radiology_requisitions(tenant_id, imaging_date);
CREATE INDEX IF NOT EXISTS idx_rad_reports_tenant     ON radiology_reports(tenant_id, order_status);
CREATE INDEX IF NOT EXISTS idx_rad_reports_req        ON radiology_reports(requisition_id);
CREATE INDEX IF NOT EXISTS idx_rad_dicom_uid          ON radiology_dicom_studies(study_instance_uid);
CREATE INDEX IF NOT EXISTS idx_rad_dicom_patient      ON radiology_dicom_studies(tenant_id, patient_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Seed Data: Common Imaging Types (tenant = '__seed__')
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO radiology_imaging_types (tenant_id, name, code, description) VALUES
  ('__seed__', 'X-Ray',         'XR',  'Conventional radiography'),
  ('__seed__', 'CT Scan',       'CT',  'Computed tomography'),
  ('__seed__', 'MRI',           'MR',  'Magnetic resonance imaging'),
  ('__seed__', 'Ultrasound',    'US',  'Sonography / ultrasound'),
  ('__seed__', 'Mammography',   'MG',  'Breast imaging'),
  ('__seed__', 'Fluoroscopy',   'RF',  'Real-time X-ray'),
  ('__seed__', 'Nuclear Medicine', 'NM', 'Isotope-based imaging');

-- Seed imaging items for X-Ray
INSERT OR IGNORE INTO radiology_imaging_items (tenant_id, imaging_type_id, name, procedure_code) VALUES
  ('__seed__', 1, 'Chest X-Ray PA View',         'XR-CHEST-PA'),
  ('__seed__', 1, 'Chest X-Ray AP View',         'XR-CHEST-AP'),
  ('__seed__', 1, 'Chest X-Ray Lateral View',    'XR-CHEST-LAT'),
  ('__seed__', 1, 'Abdomen X-Ray',               'XR-ABD'),
  ('__seed__', 1, 'Spine X-Ray (C-S)',            'XR-SPINE-C'),
  ('__seed__', 1, 'Spine X-Ray (L-S)',            'XR-SPINE-L'),
  ('__seed__', 1, 'Pelvis X-Ray',                'XR-PELVIS'),
  ('__seed__', 1, 'Hand X-Ray',                  'XR-HAND'),
  ('__seed__', 1, 'Foot X-Ray',                  'XR-FOOT'),
  ('__seed__', 1, 'Knee X-Ray',                  'XR-KNEE');

-- Seed imaging items for Ultrasound
INSERT OR IGNORE INTO radiology_imaging_items (tenant_id, imaging_type_id, name, procedure_code) VALUES
  ('__seed__', 4, 'USG Whole Abdomen',            'US-ABD-W'),
  ('__seed__', 4, 'USG Upper Abdomen',            'US-ABD-U'),
  ('__seed__', 4, 'USG Lower Abdomen',            'US-ABD-L'),
  ('__seed__', 4, 'USG KUB',                      'US-KUB'),
  ('__seed__', 4, 'USG Obstetric (OBS)',           'US-OBS'),
  ('__seed__', 4, 'USG Thyroid',                  'US-THYROID'),
  ('__seed__', 4, 'Echocardiography',             'US-ECHO');

-- Seed imaging items for CT
INSERT OR IGNORE INTO radiology_imaging_items (tenant_id, imaging_type_id, name, procedure_code) VALUES
  ('__seed__', 2, 'HRCT Chest',                  'CT-CHEST-HR'),
  ('__seed__', 2, 'CT Chest with Contrast',      'CT-CHEST-C'),
  ('__seed__', 2, 'CT Brain Plain',              'CT-BRAIN-P'),
  ('__seed__', 2, 'CT Brain with Contrast',      'CT-BRAIN-C'),
  ('__seed__', 2, 'CT Abdomen Pelvis',           'CT-ABD-PEL'),
  ('__seed__', 2, 'CT Angiography',              'CT-ANGIO');

-- Seed imaging items for MRI
INSERT OR IGNORE INTO radiology_imaging_items (tenant_id, imaging_type_id, name, procedure_code) VALUES
  ('__seed__', 3, 'MRI Brain Plain',             'MR-BRAIN-P'),
  ('__seed__', 3, 'MRI Brain with Contrast',     'MR-BRAIN-C'),
  ('__seed__', 3, 'MRI Spine Cervical',          'MR-SPINE-C'),
  ('__seed__', 3, 'MRI Spine Lumbar',            'MR-SPINE-L'),
  ('__seed__', 3, 'MRI Knee',                    'MR-KNEE'),
  ('__seed__', 3, 'MRI Shoulder',                'MR-SHOULDER');
