-- Migration: Medical Records Module
-- Description: Adds tables for Medical Records, Birth/Death Registration, ICD-10 Diagnosis, and Document Management
-- Adapted from danphe-next-cloudflare with tenant isolation for Ozzyl HMS SaaS

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. ICD-10 Reporting Groups (Master)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS icd10_reporting_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. ICD-10 Disease Groups (Master)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS icd10_disease_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    reporting_group_id INTEGER,
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (reporting_group_id) REFERENCES icd10_reporting_groups(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ICD-10 Codes (Master — searchable code catalog)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS icd10_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    disease_group_id INTEGER,
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (disease_group_id) REFERENCES icd10_disease_groups(id),
    UNIQUE(tenant_id, code)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Medical Records (Main Transaction — one per patient visit)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS medical_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER,
    admission_id INTEGER,
    doctor_id INTEGER,
    file_number TEXT,
    -- Discharge info
    discharge_type TEXT,          -- 'normal', 'lama', 'absconded', 'referred', 'expired'
    discharge_condition TEXT,     -- 'improved', 'unchanged', 'worsened', 'cured'
    -- Operation info
    is_operation_conducted INTEGER DEFAULT 0,
    operation_date TEXT,
    operation_diagnosis TEXT,
    -- Obstetric info
    gestational_week INTEGER,
    gestational_day INTEGER,
    number_of_babies INTEGER,
    blood_lost_ml INTEGER,
    gravita TEXT,
    -- Referral info
    referred_date TEXT,
    referred_time TEXT,
    referred_to TEXT,             -- Hospital/facility name
    referred_reason TEXT,
    -- File management
    is_file_cleared INTEGER DEFAULT 0,
    file_cleared_by TEXT,
    file_cleared_on TEXT,
    -- General
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Baby Birth Details (Birth Registration)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS baby_birth_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    medical_record_id INTEGER,
    patient_id INTEGER NOT NULL,  -- Mother's patient ID
    visit_id INTEGER,
    certificate_number TEXT,
    -- Baby info
    baby_name TEXT,
    sex TEXT,                     -- 'Male', 'Female', 'Other'
    weight_kg REAL,
    birth_date TEXT NOT NULL,
    birth_time TEXT,
    birth_type TEXT,              -- 'Single', 'Twin', 'Triplet', 'Quadruplet'
    birth_condition TEXT,         -- 'Alive', 'Stillborn'
    delivery_type TEXT,           -- 'Normal', 'Cesarean', 'Forceps', 'Vacuum'
    birth_order TEXT,             -- 'First', 'Second', 'Third'
    -- Parent info
    father_name TEXT,
    mother_name TEXT,
    -- Certificate management
    issued_by TEXT,
    certified_by TEXT,
    printed_by TEXT,
    print_count INTEGER DEFAULT 0,
    printed_on TEXT,
    -- General
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Death Details (Death Registration)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS death_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    medical_record_id INTEGER,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER,
    certificate_number TEXT,
    -- Death info
    death_date TEXT NOT NULL,
    death_time TEXT,
    cause_of_death TEXT,
    secondary_cause TEXT,
    manner_of_death TEXT,         -- 'Natural', 'Accident', 'Suicide', 'Homicide', 'Undetermined'
    place_of_death TEXT,          -- 'Ward', 'ICU', 'Emergency', 'OT', 'Other'
    age_at_death TEXT,            -- e.g. "45 Y", "3 M"
    -- Family info
    father_name TEXT,
    mother_name TEXT,
    spouse_name TEXT,
    -- Certificate management
    certified_by TEXT,
    printed_by TEXT,
    print_count INTEGER DEFAULT 0,
    printed_on TEXT,
    -- General
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. Final Diagnosis (ICD-10 coded, linked to MR/Visit)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS final_diagnosis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER,
    medical_record_id INTEGER,
    icd10_id INTEGER,
    is_primary INTEGER DEFAULT 0,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
    FOREIGN KEY (icd10_id) REFERENCES icd10_codes(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Document Records (Scanned documents, reports, external records)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS document_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    medical_record_id INTEGER,
    document_type TEXT NOT NULL,  -- 'lab_report', 'discharge_summary', 'referral_letter', 'imaging', 'consent', 'other'
    title TEXT NOT NULL,
    description TEXT,
    file_key TEXT,                -- R2 object key
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    uploaded_by TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (medical_record_id) REFERENCES medical_records(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_icd10_codes_tenant ON icd10_codes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_icd10_codes_code ON icd10_codes(code);
CREATE INDEX IF NOT EXISTS idx_icd10_codes_desc ON icd10_codes(description);
CREATE INDEX IF NOT EXISTS idx_mr_tenant_patient ON medical_records(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_mr_tenant_visit ON medical_records(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_mr_file_number ON medical_records(tenant_id, file_number);
CREATE INDEX IF NOT EXISTS idx_birth_tenant_patient ON baby_birth_details(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_birth_date ON baby_birth_details(tenant_id, birth_date);
CREATE INDEX IF NOT EXISTS idx_death_tenant_patient ON death_details(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_death_date ON death_details(tenant_id, death_date);
CREATE INDEX IF NOT EXISTS idx_diagnosis_tenant_visit ON final_diagnosis(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_diagnosis_icd10 ON final_diagnosis(icd10_id);
CREATE INDEX IF NOT EXISTS idx_document_tenant_patient ON document_records(tenant_id, patient_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: ICD-10 Reporting Groups
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO icd10_reporting_groups (id, tenant_id, name, description) VALUES
(1, '__seed__', 'Infectious & Parasitic Diseases', 'A00-B99'),
(2, '__seed__', 'Neoplasms', 'C00-D49'),
(3, '__seed__', 'Blood & Immune Diseases', 'D50-D89'),
(4, '__seed__', 'Endocrine & Metabolic', 'E00-E89'),
(5, '__seed__', 'Mental & Behavioural', 'F01-F99'),
(6, '__seed__', 'Nervous System', 'G00-G99'),
(7, '__seed__', 'Eye & Adnexa', 'H00-H59'),
(8, '__seed__', 'Ear & Mastoid', 'H60-H95'),
(9, '__seed__', 'Circulatory System', 'I00-I99'),
(10, '__seed__', 'Respiratory System', 'J00-J99'),
(11, '__seed__', 'Digestive System', 'K00-K95'),
(12, '__seed__', 'Skin & Subcutaneous', 'L00-L99'),
(13, '__seed__', 'Musculoskeletal', 'M00-M99'),
(14, '__seed__', 'Genitourinary System', 'N00-N99'),
(15, '__seed__', 'Pregnancy & Childbirth', 'O00-O9A'),
(16, '__seed__', 'Perinatal Conditions', 'P00-P96'),
(17, '__seed__', 'Congenital Malformations', 'Q00-Q99'),
(18, '__seed__', 'Injury & Poisoning', 'S00-T88'),
(19, '__seed__', 'External Causes', 'V00-Y99');

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: ICD-10 Disease Groups (Bangladesh-common)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO icd10_disease_groups (id, tenant_id, name, reporting_group_id) VALUES
(1, '__seed__', 'Cholera & Intestinal Infections', 1),
(2, '__seed__', 'Typhoid & Paratyphoid', 1),
(3, '__seed__', 'Tuberculosis', 1),
(4, '__seed__', 'Dengue & Viral Fevers', 1),
(5, '__seed__', 'Diabetes Mellitus', 4),
(6, '__seed__', 'Hypertensive Diseases', 9),
(7, '__seed__', 'Ischaemic Heart Disease', 9),
(8, '__seed__', 'Acute Respiratory Infections', 10),
(9, '__seed__', 'Pneumonia', 10),
(10, '__seed__', 'Chronic Lower Respiratory', 10),
(11, '__seed__', 'Gastric & Duodenal Diseases', 11),
(12, '__seed__', 'Liver Diseases', 11),
(13, '__seed__', 'Kidney Diseases', 14),
(14, '__seed__', 'Pregnancy Complications', 15),
(15, '__seed__', 'Injuries', 18);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA: ICD-10 Codes (Common in Bangladesh hospitals)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO icd10_codes (tenant_id, code, description, disease_group_id) VALUES
-- Infectious & Parasitic
('__seed__', 'A00', 'Cholera', 1),
('__seed__', 'A01', 'Typhoid and paratyphoid fevers', 2),
('__seed__', 'A02', 'Other salmonella infections', 2),
('__seed__', 'A06', 'Amoebiasis', 1),
('__seed__', 'A09', 'Infectious gastroenteritis and colitis', 1),
('__seed__', 'A15', 'Respiratory tuberculosis', 3),
('__seed__', 'A16', 'Respiratory tuberculosis, not confirmed', 3),
('__seed__', 'A90', 'Dengue fever', 4),
('__seed__', 'A91', 'Dengue haemorrhagic fever', 4),
('__seed__', 'B15', 'Acute hepatitis A', 1),
('__seed__', 'B16', 'Acute hepatitis B', 1),
('__seed__', 'B17', 'Other acute viral hepatitis', 1),
('__seed__', 'B18', 'Chronic viral hepatitis', 1),
-- Endocrine & Metabolic
('__seed__', 'E10', 'Type 1 diabetes mellitus', 5),
('__seed__', 'E11', 'Type 2 diabetes mellitus', 5),
('__seed__', 'E13', 'Other specified diabetes mellitus', 5),
('__seed__', 'E78', 'Disorders of lipoprotein metabolism', 5),
-- Circulatory
('__seed__', 'I10', 'Essential (primary) hypertension', 6),
('__seed__', 'I11', 'Hypertensive heart disease', 6),
('__seed__', 'I20', 'Angina pectoris', 7),
('__seed__', 'I21', 'Acute myocardial infarction', 7),
('__seed__', 'I25', 'Chronic ischaemic heart disease', 7),
('__seed__', 'I48', 'Atrial fibrillation and flutter', 7),
('__seed__', 'I50', 'Heart failure', 7),
('__seed__', 'I63', 'Cerebral infarction (Stroke)', 7),
('__seed__', 'I64', 'Stroke, not specified', 7),
-- Respiratory
('__seed__', 'J00', 'Acute nasopharyngitis (common cold)', 8),
('__seed__', 'J06', 'Acute upper respiratory infections', 8),
('__seed__', 'J15', 'Bacterial pneumonia', 9),
('__seed__', 'J18', 'Pneumonia, unspecified organism', 9),
('__seed__', 'J44', 'COPD', 10),
('__seed__', 'J45', 'Asthma', 10),
('__seed__', 'J46', 'Status asthmaticus', 10),
-- Digestive
('__seed__', 'K25', 'Gastric ulcer', 11),
('__seed__', 'K26', 'Duodenal ulcer', 11),
('__seed__', 'K29', 'Gastritis and duodenitis', 11),
('__seed__', 'K35', 'Acute appendicitis', 11),
('__seed__', 'K40', 'Inguinal hernia', 11),
('__seed__', 'K70', 'Alcoholic liver disease', 12),
('__seed__', 'K74', 'Fibrosis and cirrhosis of liver', 12),
('__seed__', 'K80', 'Cholelithiasis (Gallstones)', 12),
('__seed__', 'K81', 'Cholecystitis', 12),
-- Genitourinary
('__seed__', 'N17', 'Acute kidney failure', 13),
('__seed__', 'N18', 'Chronic kidney disease', 13),
('__seed__', 'N20', 'Calculus of kidney and ureter', 13),
('__seed__', 'N39', 'Urinary tract infection', 13),
-- Pregnancy
('__seed__', 'O14', 'Pre-eclampsia', 14),
('__seed__', 'O15', 'Eclampsia', 14),
('__seed__', 'O46', 'Antepartum haemorrhage', 14),
('__seed__', 'O80', 'Single spontaneous delivery', 14),
('__seed__', 'O82', 'Delivery by caesarean section', 14),
-- Injuries
('__seed__', 'S06', 'Intracranial injury', 15),
('__seed__', 'S72', 'Fracture of femur', 15),
('__seed__', 'T14', 'Injury of unspecified body region', 15),
('__seed__', 'T78', 'Adverse effects, not elsewhere classified', 15);
