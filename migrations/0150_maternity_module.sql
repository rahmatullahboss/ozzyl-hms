-- Migration: Maternity Module
-- Based on DanpheEMR MaternityModels + OpenEMR obstetrics best practices

-- ─── 1. Maternity Patients ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maternity_patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  husband_name TEXT,
  height_cm REAL,
  weight_kg REAL,
  last_menstrual_period TEXT,
  expected_delivery_date TEXT,
  gravida INTEGER DEFAULT 0,
  para INTEGER DEFAULT 0,
  abortions INTEGER DEFAULT 0,
  living_children INTEGER DEFAULT 0,
  place_of_delivery TEXT,
  presentation TEXT,
  complications TEXT,
  delivery_date TEXT,
  delivery_type TEXT, -- normal, cesarean, assisted_vacuum, assisted_forceps, other
  delivery_outcome_mother TEXT, -- alive_well, alive_complicated, deceased
  delivery_outcome_baby TEXT, -- alive_well, alive_complicated, stillbirth, neonatal_death
  obs_history TEXT,
  blood_group TEXT,
  rh_factor TEXT,
  hiv_status TEXT,
  syphilis_status TEXT,
  hepatitis_b_status TEXT,
  is_concluded INTEGER DEFAULT 0,
  concluded_on TEXT,
  concluded_by INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER,
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_maternity_patients_tenant ON maternity_patients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maternity_patients_patient ON maternity_patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_maternity_patients_edd ON maternity_patients(expected_delivery_date);
CREATE INDEX IF NOT EXISTS idx_maternity_patients_active ON maternity_patients(tenant_id, is_active);

-- ─── 2. ANC Visits ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maternity_anc_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  maternity_patient_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_number INTEGER NOT NULL,
  visit_date TEXT NOT NULL,
  visit_place TEXT,
  pregnancy_weeks INTEGER,
  weight_kg REAL,
  blood_pressure TEXT,
  pulse INTEGER,
  fundal_height_cm REAL,
  fetal_heart_rate INTEGER,
  fetal_movement INTEGER DEFAULT 0,
  hemoglobin REAL,
  urine_albumin TEXT,
  urine_sugar TEXT,
  condition_notes TEXT,
  risk_factors TEXT,
  medications_given TEXT,
  tt_injection_given INTEGER DEFAULT 0,
  tt_injection_dose TEXT,
  iron_folate_given INTEGER DEFAULT 0,
  next_visit_date TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER,
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_maternity_anc_tenant ON maternity_anc_visits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maternity_anc_patient ON maternity_anc_visits(maternity_patient_id);
CREATE INDEX IF NOT EXISTS idx_maternity_anc_date ON maternity_anc_visits(visit_date);

-- ─── 3. Delivery Records ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maternity_delivery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  maternity_patient_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  admission_id INTEGER,
  delivery_date TEXT NOT NULL,
  delivery_time TEXT,
  delivery_type TEXT NOT NULL,
  delivery_place TEXT,
  conducted_by TEXT,
  delivery_complications TEXT,
  anesthesia_used TEXT,
  episiotomy_given INTEGER DEFAULT 0,
  placenta_complete INTEGER DEFAULT 1,
  blood_loss_ml INTEGER,
  postpartum_condition TEXT,
  mother_outcome TEXT,
  mother_disposition TEXT, -- discharged, transferred, deceased
  discharge_date TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER,
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_maternity_delivery_tenant ON maternity_delivery(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maternity_delivery_patient ON maternity_delivery(maternity_patient_id);
CREATE INDEX IF NOT EXISTS idx_maternity_delivery_date ON maternity_delivery(delivery_date);

-- ─── 4. Newborn Records ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maternity_newborns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  maternity_patient_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  delivery_id INTEGER NOT NULL,
  baby_number INTEGER DEFAULT 1,
  birth_weight_g INTEGER,
  birth_length_cm REAL,
  head_circumference_cm REAL,
  chest_circumference_cm REAL,
  apgar_score_1min INTEGER,
  apgar_score_5min INTEGER,
  apgar_score_10min INTEGER,
  sex TEXT,
  baby_condition TEXT, -- alive_well, premature, low_birth_weight, asphyxia, congenital_abnormality, stillborn
  resuscitation_needed INTEGER DEFAULT 0,
  resuscitation_method TEXT,
  breastfed_within_hour INTEGER DEFAULT 0,
  vitamin_k_given INTEGER DEFAULT 0,
  bcg_given INTEGER DEFAULT 0,
  opv_given INTEGER DEFAULT 0,
  hep_b_given INTEGER DEFAULT 0,
  congenital_abnormalities TEXT,
  baby_outcome TEXT,
  baby_discharge_date TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER,
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_maternity_newborns_tenant ON maternity_newborns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maternity_newborns_delivery ON maternity_newborns(delivery_id);
CREATE INDEX IF NOT EXISTS idx_maternity_newborns_patient ON maternity_newborns(maternity_patient_id);

-- ─── 5. PNC Visits ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maternity_pnc_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  maternity_patient_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  delivery_id INTEGER,
  visit_day INTEGER NOT NULL, -- 1, 3, 7, 28, 42
  visit_date TEXT NOT NULL,
  mother_condition TEXT,
  mother_bp TEXT,
  mother_temperature REAL,
  mother_pallor TEXT,
  breast_condition TEXT,
  uterus_involution TEXT,
  lochia TEXT,
  perineum_condition TEXT,
  family_planning_counselled INTEGER DEFAULT 0,
  family_planning_method TEXT,
  baby_condition TEXT,
  baby_weight_g INTEGER,
  baby_feeding_method TEXT,
  baby_jaundice INTEGER DEFAULT 0,
  baby_infection_signs INTEGER DEFAULT 0,
  baby_immunization_status TEXT,
  complications TEXT,
  referred INTEGER DEFAULT 0,
  referred_to TEXT,
  next_visit_date TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER,
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_maternity_pnc_tenant ON maternity_pnc_visits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maternity_pnc_patient ON maternity_pnc_visits(maternity_patient_id);
CREATE INDEX IF NOT EXISTS idx_maternity_pnc_date ON maternity_pnc_visits(visit_date);
