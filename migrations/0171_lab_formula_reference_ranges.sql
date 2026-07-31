-- =============================================================================
-- HMS Migration 0171: Lab Formula Engine + Reference Ranges + Delta Check
-- Date: 2026-04-26
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. LAB TEST COMPONENTS (hierarchical component definitions)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_test_components (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_test_id       INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  component_code    TEXT,                        -- e.g. HGB, WBC
  component_name    TEXT    NOT NULL,            -- e.g. Hemoglobin
  group_name        TEXT,                        -- e.g. "RBC Group", "WBC Group"
  indentation_count INTEGER NOT NULL DEFAULT 0,  -- visual nesting level
  display_sequence  INTEGER NOT NULL DEFAULT 0,
  unit              TEXT,
  value_type        TEXT NOT NULL DEFAULT 'numeric' CHECK(value_type IN ('numeric','text','coded','calculated')),
  normal_range      TEXT,                        -- fallback if no structured ranges
  critical_low      REAL,
  critical_high     REAL,
  is_auto_calculate INTEGER NOT NULL DEFAULT 0,  -- 1=computed from formula
  calculation_formula TEXT,                      -- e.g. "{101} / {102} * 100"
  formula_description TEXT,                      -- human readable
  is_mandatory      INTEGER NOT NULL DEFAULT 1,  -- must have result
  show_in_report    INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_test_comp_test      ON lab_test_components(lab_test_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_test_comp_group     ON lab_test_components(group_name);
CREATE INDEX IF NOT EXISTS idx_lab_test_comp_sequence  ON lab_test_components(display_sequence);
CREATE INDEX IF NOT EXISTS idx_lab_test_comp_calculate ON lab_test_components(is_auto_calculate);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. STRUCTURED REFERENCE RANGES (gender + age band specific)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_reference_ranges (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_test_id       INTEGER NOT NULL REFERENCES lab_test_catalog(id),
  component_id      INTEGER REFERENCES lab_test_components(id), -- NULL = whole test
  gender            TEXT NOT NULL CHECK(gender IN ('male','female','both')),
  age_min_months    INTEGER NOT NULL DEFAULT 0,   -- 0 = newborn
  age_max_months    INTEGER,                       -- NULL = no upper limit
  range_low         REAL,                          -- numeric lower bound
  range_high        REAL,                          -- numeric upper bound
  range_text        TEXT,                          -- e.g. "4.5 - 5.5" or descriptive
  is_critical       INTEGER NOT NULL DEFAULT 0,    -- 1=use as critical threshold
  notes             TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_ref_range_test    ON lab_reference_ranges(lab_test_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_ref_range_gender  ON lab_reference_ranges(gender);
CREATE INDEX IF NOT EXISTS idx_lab_ref_range_age     ON lab_reference_ranges(age_min_months, age_max_months);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. SEED REFERENCE RANGES FOR COMMON TESTS
-- ═══════════════════════════════════════════════════════════════════════════════
-- Hemoglobin (HGB)
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'male', 216, NULL, 13.5, 17.5, '13.5 - 17.5', tenant_id FROM lab_test_catalog WHERE code = 'HGB';

INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'female', 216, NULL, 12.0, 15.5, '12.0 - 15.5', tenant_id FROM lab_test_catalog WHERE code = 'HGB';

INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, 216, 11.0, 14.0, '11.0 - 14.0', tenant_id FROM lab_test_catalog WHERE code = 'HGB';

-- Total WBC Count
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 4000, 11000, '4,000 - 11,000 /cmm', tenant_id FROM lab_test_catalog WHERE code = 'WBC';

-- Platelet Count
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 150000, 450000, '150,000 - 450,000 /cmm', tenant_id FROM lab_test_catalog WHERE code = 'PLT';

-- RBC Count
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'male', 216, NULL, 4.5, 5.5, '4.5 - 5.5 million/cmm', tenant_id FROM lab_test_catalog WHERE code = 'RBC';

INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'female', 216, NULL, 4.0, 5.0, '4.0 - 5.0 million/cmm', tenant_id FROM lab_test_catalog WHERE code = 'RBC';

-- PCV / Hematocrit
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'male', 216, NULL, 40.0, 50.0, '40 - 50%', tenant_id FROM lab_test_catalog WHERE code = 'PCV';

INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'female', 216, NULL, 36.0, 46.0, '36 - 46%', tenant_id FROM lab_test_catalog WHERE code = 'PCV';

-- MCV
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 80.0, 100.0, '80 - 100 fL', tenant_id FROM lab_test_catalog WHERE code = 'MCV';

-- MCH
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 27.0, 33.0, '27 - 33 pg', tenant_id FROM lab_test_catalog WHERE code = 'MCH';

-- MCHC
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 32.0, 36.0, '32 - 36 g/dL', tenant_id FROM lab_test_catalog WHERE code = 'MCHC';

-- SGPT/ALT
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 0, 41, '< 41 U/L', tenant_id FROM lab_test_catalog WHERE code = 'SGPT';

-- SGOT/AST
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 0, 40, '< 40 U/L', tenant_id FROM lab_test_catalog WHERE code = 'SGOT';

-- Total Bilirubin
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 0.2, 1.2, '0.2 - 1.2 mg/dL', tenant_id FROM lab_test_catalog WHERE code = 'BIL-T';

-- Creatinine (Male)
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'male', 216, NULL, 0.7, 1.3, '0.7 - 1.3 mg/dL', tenant_id FROM lab_test_catalog WHERE code = 'CREAT';

INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'female', 216, NULL, 0.6, 1.1, '0.6 - 1.1 mg/dL', tenant_id FROM lab_test_catalog WHERE code = 'CREAT';

-- Fasting Blood Sugar
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 70, 100, '70 - 100 mg/dL', tenant_id FROM lab_test_catalog WHERE code = 'FBS';

-- HbA1c
INSERT OR IGNORE INTO lab_reference_ranges (lab_test_id, gender, age_min_months, age_max_months, range_low, range_high, range_text, tenant_id)
SELECT id, 'both', 0, NULL, 0, 5.7, '< 5.7%', tenant_id FROM lab_test_catalog WHERE code = 'HBA1C';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. SEED COMPONENT DEFINITIONS FOR CBC (if CBC test exists)
-- ═══════════════════════════════════════════════════════════════════════════════
-- First ensure we have a CBC test
INSERT OR IGNORE INTO lab_test_catalog (code, name, category, price, is_active, tenant_id)
SELECT 'CBC', 'Complete Blood Count', 'blood', 50000, 1, tenant_id FROM lab_test_catalog LIMIT 1;

-- CBC Components
INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'HGB', 'Hemoglobin', 'RBC Group', 1, 'g/dL', 'numeric', 'M: 13.5-17.5 | F: 12.0-15.5', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'RBC', 'RBC Count', 'RBC Group', 2, 'million/cmm', 'numeric', 'M: 4.5-5.5 | F: 4.0-5.0', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'PCV', 'PCV / Hematocrit', 'RBC Group', 3, '%', 'numeric', 'M: 40-50 | F: 36-46', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'MCV', 'MCV', 'RBC Group', 4, 'fL', 'numeric', '80-100', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'MCH', 'MCH', 'RBC Group', 5, 'pg', 'numeric', '27-33', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

-- MCHC = (Hb / PCV) * 100 — AUTO CALCULATED
INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_auto_calculate, calculation_formula, formula_description, is_active, tenant_id)
SELECT 
  c.id, 'MCHC', 'MCHC', 'RBC Group', 6, 'g/dL', 'calculated', '32-36', 1, 
  '{HGB} / {PCV} * 100', 
  'Mean Corpuscular Hemoglobin Concentration = Hemoglobin / PCV * 100',
  1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'WBC', 'Total WBC Count', 'WBC Group', 7, '/cmm', 'numeric', '4,000-11,000', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, indentation_count, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'NEUTRO', 'Neutrophils', 'WBC Group', 1, 8, '%', 'numeric', '40-75', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, indentation_count, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'LYMPHO', 'Lymphocytes', 'WBC Group', 1, 9, '%', 'numeric', '20-45', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, indentation_count, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'MONO', 'Monocytes', 'WBC Group', 1, 10, '%', 'numeric', '2-10', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, indentation_count, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'EO', 'Eosinophils', 'WBC Group', 1, 11, '%', 'numeric', '1-6', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, indentation_count, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'BASO', 'Basophils', 'WBC Group', 1, 12, '%', 'numeric', '0-1', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT 
  c.id, 'PLT', 'Platelet Count', 'Platelet Group', 13, '/cmm', 'numeric', '150,000-450,000', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'CBC';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. SEED COMPONENTS FOR LIPID PROFILE
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO lab_test_catalog (code, name, category, price, is_active, tenant_id)
SELECT 'LIPID', 'Lipid Profile', 'biochemistry', 80000, 1, tenant_id FROM lab_test_catalog LIMIT 1;

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'CHOL-T', 'Total Cholesterol', 1, 'mg/dL', 'numeric', '< 200', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LIPID';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'TRIG', 'Triglycerides', 2, 'mg/dL', 'numeric', '< 150', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LIPID';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'HDL', 'HDL Cholesterol', 3, 'mg/dL', 'numeric', '> 40 (M), > 50 (F)', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LIPID';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'VLDL', 'VLDL Cholesterol', 4, 'mg/dL', 'numeric', '< 30', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LIPID';

-- LDL = Total Chol - HDL - (Triglycerides / 5) — AUTO CALCULATED
INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, display_sequence, unit, value_type, normal_range, is_auto_calculate, calculation_formula, formula_description, is_active, tenant_id)
SELECT c.id, 'LDL', 'LDL Cholesterol', 5, 'mg/dL', 'calculated', '< 100', 1,
  '{CHOL-T} - {HDL} - ({TRIG} / 5)',
  'LDL = Total Cholesterol - HDL - (Triglycerides / 5)',
  1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LIPID';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. SEED COMPONENTS FOR LFT
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO lab_test_catalog (code, name, category, price, is_active, tenant_id)
SELECT 'LFT', 'Liver Function Test', 'biochemistry', 70000, 1, tenant_id FROM lab_test_catalog LIMIT 1;

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'SGPT', 'SGPT / ALT', 'Enzymes', 1, 'U/L', 'numeric', '< 41', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LFT';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'SGOT', 'SGOT / AST', 'Enzymes', 2, 'U/L', 'numeric', '< 40', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LFT';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'ALP', 'ALP', 'Enzymes', 3, 'U/L', 'numeric', '44-147', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LFT';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'BIL-T', 'Total Bilirubin', 'Bilirubin', 4, 'mg/dL', 'numeric', '0.2-1.2', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LFT';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'BIL-D', 'Direct Bilirubin', 'Bilirubin', 5, 'mg/dL', 'numeric', '< 0.3', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LFT';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'PROT-T', 'Total Protein', 'Proteins', 6, 'g/dL', 'numeric', '6.0-8.3', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LFT';

INSERT OR IGNORE INTO lab_test_components (lab_test_id, component_code, component_name, group_name, display_sequence, unit, value_type, normal_range, is_active, tenant_id)
SELECT c.id, 'ALB', 'Albumin', 'Proteins', 7, 'g/dL', 'numeric', '3.5-5.0', 1, c.tenant_id
FROM lab_test_catalog c WHERE c.code = 'LFT';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. ADD COLUMNS TO LAB_RESULTS FOR COMPONENT LINKING
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE lab_results ADD COLUMN component_id INTEGER REFERENCES lab_test_components(id);
ALTER TABLE lab_results ADD COLUMN is_auto_computed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_results ADD COLUMN formula_used TEXT;

CREATE INDEX IF NOT EXISTS idx_lab_results_component ON lab_results(component_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_auto ON lab_results(is_auto_computed);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. ENSURE DELTA CHECK COLUMNS ARE POPULATED (trigger-like update for existing)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Note: The app layer will populate previous_value and delta_flag going forward.
-- For existing data, we can run a one-time update via script if needed.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. SAMPLE REJECTION REASONS TABLE
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_rejection_reasons (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  reason_code       TEXT    NOT NULL,
  reason_text       TEXT    NOT NULL,
  reason_text_bn    TEXT,
  category          TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('hemolysis','clotted','insufficient','wrong_container','label_error','broken','others')),
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_reject_reason_tenant ON lab_rejection_reasons(tenant_id, is_active);

-- Seed common rejection reasons
INSERT OR IGNORE INTO lab_rejection_reasons (reason_code, reason_text, reason_text_bn, category, tenant_id)
VALUES
('HEMOLYSIS', 'Sample hemolyzed', 'নমুনা হিমোলাইজড', 'hemolysis', 0),
('CLOTTED', 'Sample clotted', 'নমুনা জমাট বাঁধা', 'clotted', 0),
('INSUFFICIENT', 'Insufficient quantity', 'পরিমাণ অপর্যাপ্ত', 'insufficient', 0),
('WRONG_CONTAINER', 'Wrong container/tube', 'ভুল টিউব/কন্টেইনার', 'wrong_container', 0),
('LABEL_ERROR', 'Label error/missing', 'লেবেল ভুল/অনুপস্থিত', 'label_error', 0),
('BROKEN', 'Container broken/leaked', 'টিউব ভেঙে/ফুটো', 'broken', 0);

-- Add rejection columns to lab_order_items
ALTER TABLE lab_order_items ADD COLUMN rejection_reason_id INTEGER REFERENCES lab_rejection_reasons(id);
ALTER TABLE lab_order_items ADD COLUMN rejected_by INTEGER;
ALTER TABLE lab_order_items ADD COLUMN rejected_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN rejection_notes TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. GOVERNMENT REPORT ITEMS (Bangladesh DHIS2/HMIS style)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_gov_report_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_number     INTEGER NOT NULL,
  item_code         TEXT    NOT NULL,
  item_name         TEXT    NOT NULL,
  item_name_bn      TEXT,
  group_name        TEXT,
  category          TEXT,                    -- 'hematology','biochemistry','microbiology','radiology'
  reporting_frequency TEXT DEFAULT 'monthly' CHECK(reporting_frequency IN ('daily','weekly','monthly','quarterly','yearly')),
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL DEFAULT 0,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_gov_item_code ON lab_gov_report_items(item_code, tenant_id);

CREATE TABLE IF NOT EXISTS lab_gov_report_mappings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  gov_item_id       INTEGER NOT NULL REFERENCES lab_gov_report_items(id),
  lab_test_id       INTEGER REFERENCES lab_test_catalog(id),
  component_id      INTEGER REFERENCES lab_test_components(id),
  is_component_based INTEGER NOT NULL DEFAULT 0,
  count_method      TEXT DEFAULT 'all' CHECK(count_method IN ('all','positive','negative','abnormal')),
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  UNIQUE(gov_item_id, lab_test_id, component_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_gov_map_item ON lab_gov_report_mappings(gov_item_id);
CREATE INDEX IF NOT EXISTS idx_lab_gov_map_test ON lab_gov_report_mappings(lab_test_id);

-- Seed common Bangladesh government report items
INSERT OR IGNORE INTO lab_gov_report_items (serial_number, item_code, item_name, item_name_bn, group_name, category, reporting_frequency, tenant_id)
VALUES
(1, 'LAB-001', 'Blood Tests (Total)', 'রক্ত পরীক্ষা (মোট)', 'Hematology', 'hematology', 'monthly', 0),
(2, 'LAB-002', 'CBC Performed', 'সিবিসি সম্পন্ন', 'Hematology', 'hematology', 'monthly', 0),
(3, 'LAB-003', 'Blood Sugar Tests', 'রক্তের সুগার পরীক্ষা', 'Biochemistry', 'biochemistry', 'monthly', 0),
(4, 'LAB-004', 'Liver Function Tests', 'লিভার ফাংশন টেস্ট', 'Biochemistry', 'biochemistry', 'monthly', 0),
(5, 'LAB-005', 'Renal Function Tests', 'কিডনি ফাংশন টেস্ট', 'Biochemistry', 'biochemistry', 'monthly', 0),
(6, 'LAB-006', 'Urine Tests (Total)', 'প্রস্রাব পরীক্ষা (মোট)', 'Urine', 'urine', 'monthly', 0),
(7, 'LAB-007', 'X-Rays (Total)', 'এক্সরে (মোট)', 'Radiology', 'radiology', 'monthly', 0),
(8, 'LAB-008', 'Ultrasounds (Total)', 'আলট্রাসাউন্ড (মোট)', 'Radiology', 'radiology', 'monthly', 0),
(9, 'LAB-009', 'CT Scans', 'সিটি স্ক্যান', 'Radiology', 'radiology', 'monthly', 0),
(10, 'LAB-010', 'Culture & Sensitivity', 'কালচার অ্যান্ড সেনসিটিভিটি', 'Microbiology', 'microbiology', 'monthly', 0);
