-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0145: Clinical Reminders & Preventive Care Engine
-- Reference: OpenEMR clinical_rules, clinical_plans, rule_action, rule_filter
-- ═══════════════════════════════════════════════════════════════════════════════

-- Clinical Reminder Rules (what to check)
CREATE TABLE IF NOT EXISTS clinical_reminder_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,    -- 'screening', 'vaccination', 'lab_monitoring', 'follow_up', 'preventive_care', 'chronic_disease'
  priority TEXT DEFAULT 'routine',  -- 'routine', 'important', 'urgent'

  -- Target criteria (who this rule applies to)
  min_age INTEGER,
  max_age INTEGER,
  sex TEXT,                  -- 'M', 'F', NULL=both
  condition_codes TEXT,      -- JSON array of ICD codes or keywords that must be in problem list
  medication_names TEXT,     -- JSON array of medication names that trigger this rule

  -- Timing
  interval_days INTEGER NOT NULL,     -- how often (e.g., 365 for annual, 90 for quarterly)
  grace_period_days INTEGER DEFAULT 30,

  -- Action
  action_type TEXT NOT NULL, -- 'lab_order', 'screening', 'vaccination', 'referral', 'assessment', 'counseling'
  action_code TEXT,          -- test code, vaccine code, or form ID
  action_description TEXT,

  -- Evidence
  guideline_source TEXT,     -- 'WHO', 'DGHS', 'ADA', 'USPSTF', 'local'
  guideline_url TEXT,
  evidence_level TEXT,       -- 'A', 'B', 'C', 'D', 'expert_consensus'

  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crr_tenant ON clinical_reminder_rules(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_crr_category ON clinical_reminder_rules(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crr_code ON clinical_reminder_rules(tenant_id, rule_code);

-- Patient Reminder Status (tracks what's been done per patient)
CREATE TABLE IF NOT EXISTS patient_reminder_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL REFERENCES clinical_reminder_rules(id),
  status TEXT DEFAULT 'due',  -- 'due', 'overdue', 'completed', 'skipped', 'not_applicable'
  last_completed_at DATETIME,
  next_due_at DATETIME,
  completed_by INTEGER,
  skip_reason TEXT,
  notes TEXT,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prs_patient ON patient_reminder_status(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_prs_rule ON patient_reminder_status(rule_id);
CREATE INDEX IF NOT EXISTS idx_prs_status ON patient_reminder_status(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_prs_due ON patient_reminder_status(next_due_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prs_unique ON patient_reminder_status(tenant_id, patient_id, rule_id);

-- Seed data: common clinical reminder rules (tenant_id='__seed__' for auto-clone)
INSERT OR IGNORE INTO clinical_reminder_rules (rule_code, title, description, category, priority, min_age, max_age, sex, condition_codes, medication_names, interval_days, grace_period_days, action_type, action_code, action_description, guideline_source, evidence_level, is_active, tenant_id) VALUES
-- Diabetes monitoring
('DM_HBA1C', 'HbA1c Monitoring', 'Check HbA1c every 3 months for diabetic patients', 'chronic_disease', 'important', NULL, NULL, NULL, '["diabetes","e11","e10","dm","type 2 diabetes"]', '["metformin","glimepiride","insulin","gliclazide"]', 90, 14, 'lab_order', 'HBA1C', 'Order HbA1c test', 'ADA', 'A', 1, '__seed__'),
('DM_LIPID', 'Lipid Profile (Diabetic)', 'Annual lipid panel for diabetic patients', 'chronic_disease', 'routine', NULL, NULL, NULL, '["diabetes","e11","e10"]', NULL, 365, 30, 'lab_order', 'LIPID', 'Order lipid panel', 'ADA', 'A', 1, '__seed__'),
('DM_RENAL', 'Renal Function (Diabetic)', 'Annual serum creatinine + urine microalbumin for diabetic patients', 'chronic_disease', 'important', NULL, NULL, NULL, '["diabetes","e11","e10"]', NULL, 365, 30, 'lab_order', 'RFT', 'Order serum creatinine + urine microalbumin', 'ADA', 'B', 1, '__seed__'),
('DM_EYE', 'Diabetic Eye Screening', 'Annual dilated fundoscopy for diabetic patients', 'screening', 'important', NULL, NULL, NULL, '["diabetes","e11","e10"]', NULL, 365, 60, 'referral', 'EYE_EXAM', 'Refer for dilated fundoscopy', 'ADA', 'A', 1, '__seed__'),
('DM_FOOT', 'Diabetic Foot Exam', 'Annual foot examination for diabetic patients', 'screening', 'routine', NULL, NULL, NULL, '["diabetes","e11","e10"]', NULL, 365, 60, 'assessment', 'FOOT_EXAM', 'Perform monofilament foot exam', 'ADA', 'B', 1, '__seed__'),

-- Hypertension
('HTN_BP', 'Blood Pressure Monitoring', 'BP check every visit for hypertensive patients', 'chronic_disease', 'important', NULL, NULL, NULL, '["hypertension","i10","htn","high blood pressure"]', '["amlodipine","losartan","enalapril","atenolol"]', 30, 7, 'assessment', 'BP', 'Measure blood pressure', 'WHO', 'A', 1, '__seed__'),
('HTN_RENAL', 'Renal Function (Hypertensive)', 'Annual renal function for patients on ACE-I/ARB', 'lab_monitoring', 'routine', NULL, NULL, NULL, '["hypertension","i10"]', '["enalapril","lisinopril","ramipril","losartan","valsartan","telmisartan"]', 365, 30, 'lab_order', 'RFT', 'Order serum creatinine + electrolytes', 'NICE', 'B', 1, '__seed__'),

-- Cancer screening
('SCR_CERVICAL', 'Cervical Cancer Screening', 'Pap smear every 3 years for women 21-65', 'screening', 'important', 21, 65, 'F', NULL, NULL, 1095, 90, 'screening', 'PAP', 'Order Pap smear/cervical cytology', 'USPSTF', 'A', 1, '__seed__'),
('SCR_BREAST', 'Breast Cancer Screening', 'Mammogram every 2 years for women 50-74', 'screening', 'important', 50, 74, 'F', NULL, NULL, 730, 90, 'screening', 'MAMMO', 'Order screening mammogram', 'USPSTF', 'B', 1, '__seed__'),
('SCR_COLON', 'Colorectal Cancer Screening', 'Colonoscopy every 10 years or FOBT annually for adults 45-75', 'screening', 'important', 45, 75, NULL, NULL, NULL, 365, 60, 'screening', 'FOBT', 'Order fecal occult blood test or refer for colonoscopy', 'USPSTF', 'A', 1, '__seed__'),

-- Vaccinations
('VAX_FLU', 'Annual Influenza Vaccine', 'Influenza vaccination annually for adults 50+ and chronic disease patients', 'vaccination', 'routine', 50, NULL, NULL, NULL, NULL, 365, 60, 'vaccination', 'FLU', 'Administer influenza vaccine', 'WHO', 'A', 1, '__seed__'),
('VAX_PNEUMO', 'Pneumococcal Vaccine', 'Pneumococcal vaccine for adults 65+ (once)', 'vaccination', 'routine', 65, NULL, NULL, NULL, NULL, 36500, 365, 'vaccination', 'PPSV23', 'Administer pneumococcal vaccine', 'WHO', 'A', 1, '__seed__'),
('VAX_TD', 'Tetanus/Diphtheria Booster', 'Td booster every 10 years for adults', 'vaccination', 'routine', 18, NULL, NULL, NULL, NULL, 3650, 365, 'vaccination', 'TD', 'Administer Td booster', 'WHO', 'A', 1, '__seed__'),

-- Lab monitoring for medications
('MON_WARFARIN', 'INR Monitoring (Warfarin)', 'Monthly INR for patients on warfarin', 'lab_monitoring', 'urgent', NULL, NULL, NULL, NULL, '["warfarin"]', 30, 7, 'lab_order', 'INR', 'Order PT/INR', 'AHA', 'A', 1, '__seed__'),
('MON_THYROID', 'Thyroid Function (Levothyroxine)', 'TSH every 6 months for patients on levothyroxine', 'lab_monitoring', 'routine', NULL, NULL, NULL, '["hypothyroidism","e03"]', '["levothyroxine","thyroxine"]', 180, 30, 'lab_order', 'TSH', 'Order TSH', 'ATA', 'A', 1, '__seed__'),
('MON_LITHIUM', 'Lithium Level Monitoring', 'Lithium level every 3 months + renal/thyroid annually', 'lab_monitoring', 'important', NULL, NULL, NULL, NULL, '["lithium"]', 90, 14, 'lab_order', 'LITHIUM', 'Order serum lithium level', 'NICE', 'A', 1, '__seed__'),
('MON_STATIN_LFT', 'LFT Monitoring (Statin)', 'LFT baseline then annually for statin users', 'lab_monitoring', 'routine', NULL, NULL, NULL, NULL, '["atorvastatin","rosuvastatin","simvastatin","pravastatin"]', 365, 60, 'lab_order', 'LFT', 'Order liver function tests', 'ACC/AHA', 'B', 1, '__seed__'),

-- Preventive care
('PREV_BMI', 'BMI Screening', 'Annual BMI calculation for all adults', 'preventive_care', 'routine', 18, NULL, NULL, NULL, NULL, 365, 60, 'assessment', 'BMI', 'Calculate BMI from height/weight', 'USPSTF', 'B', 1, '__seed__'),
('PREV_TOBACCO', 'Tobacco Cessation Counseling', 'Tobacco screening and cessation counseling at every visit', 'preventive_care', 'important', 18, NULL, NULL, '["tobacco use","f17","smoker","smoking"]', NULL, 365, 30, 'counseling', 'TOBACCO', 'Assess tobacco use and counsel on cessation', 'USPSTF', 'A', 1, '__seed__');
