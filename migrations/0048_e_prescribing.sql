-- Migration: 0048_e_prescribing.sql
-- Description: E-Prescribing Enhancement — Drug Interactions, Formulary, Patient Medications, Safety Checks
-- Adapted from danphe-next 0097_e_prescribing.sql + OpenEMR RxNorm patterns
-- Created: 2026-03-18

-- ===================================================================
-- 1. Formulary Categories (Drug groups)
-- ===================================================================
CREATE TABLE IF NOT EXISTS formulary_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,               -- e.g. "Antibiotics", "Analgesics", "Antidiabetics"
    description TEXT,
    parent_id INTEGER,                -- for sub-categories
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_formulary_cat_tenant ON formulary_categories(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_formulary_cat_unique ON formulary_categories(tenant_id, name);

-- ===================================================================
-- 2. Formulary Items (Drug Master Catalog)
-- ===================================================================
CREATE TABLE IF NOT EXISTS formulary_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,                -- Brand/trade name (e.g. "Napa Extra")
    generic_name TEXT NOT NULL,        -- Generic name (e.g. "Paracetamol + Caffeine")
    category_id INTEGER,              -- FK to formulary_categories
    strength TEXT,                     -- e.g. "500mg", "250mg/5ml"
    dosage_form TEXT,                  -- Tablet, Capsule, Syrup, Injection, etc.
    route TEXT,                        -- Oral, IV, IM, Topical, etc.
    manufacturer TEXT,                 -- Pharma company
    
    -- Dosing guidance
    common_dosages TEXT,               -- JSON array: ["500mg TDS", "1g BD"]
    default_frequency TEXT,            -- e.g. "1+0+1"
    default_duration TEXT,             -- e.g. "5 Days"
    max_daily_dose_mg REAL,            -- Maximum safe daily dose in mg
    default_instructions TEXT,         -- e.g. "After food"
    
    -- Classification
    is_antibiotic INTEGER DEFAULT 0,
    is_controlled INTEGER DEFAULT 0,
    requires_prior_auth INTEGER DEFAULT 0,
    
    -- Pricing
    unit_price REAL DEFAULT 0,
    
    -- Linkage to pharmacy stock (optional)
    medicine_id INTEGER,              -- FK to medicines table if stocked
    
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    
    FOREIGN KEY (category_id) REFERENCES formulary_categories(id),
    FOREIGN KEY (medicine_id) REFERENCES medicines(id)
);

CREATE INDEX IF NOT EXISTS idx_formulary_tenant ON formulary_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_formulary_name ON formulary_items(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_formulary_generic ON formulary_items(tenant_id, generic_name);
CREATE INDEX IF NOT EXISTS idx_formulary_category ON formulary_items(tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_formulary_medicine ON formulary_items(tenant_id, medicine_id);

-- ===================================================================
-- 3. Drug Interaction Pairs
-- ===================================================================
CREATE TABLE IF NOT EXISTS drug_interaction_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    drug_a_name TEXT NOT NULL,         -- Generic name of drug A (lowercased)
    drug_b_name TEXT NOT NULL,         -- Generic name of drug B (lowercased)
    severity TEXT NOT NULL DEFAULT 'moderate'
        CHECK (severity IN ('minor', 'moderate', 'major', 'contraindicated')),
    description TEXT NOT NULL,         -- Clinical description of the interaction
    recommendation TEXT,               -- What to do about it
    evidence_level TEXT
        CHECK (evidence_level IS NULL OR evidence_level IN ('established', 'theoretical', 'case_report')),
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interactions_tenant ON drug_interaction_pairs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_interactions_drug_a ON drug_interaction_pairs(tenant_id, drug_a_name);
CREATE INDEX IF NOT EXISTS idx_interactions_drug_b ON drug_interaction_pairs(tenant_id, drug_b_name);
CREATE INDEX IF NOT EXISTS idx_interactions_severity ON drug_interaction_pairs(tenant_id, severity);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_pair_unique ON drug_interaction_pairs(tenant_id, drug_a_name, drug_b_name);

-- ===================================================================
-- 4. Patient Active Medications (Current med list)
-- ===================================================================
CREATE TABLE IF NOT EXISTS patient_active_medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    formulary_item_id INTEGER,         -- FK to formulary_items (if from catalog)
    
    -- Medication details
    medication_name TEXT NOT NULL,      -- Name of medication
    generic_name TEXT,                  -- Generic name (for interaction matching)
    strength TEXT,
    dosage_form TEXT,
    
    -- Prescription details
    dosage TEXT,                        -- e.g. "1 tablet"
    frequency TEXT,                     -- e.g. "1+0+1"
    duration TEXT,                      -- e.g. "Ongoing", "30 days"
    instructions TEXT,                  -- e.g. "After food"
    start_date TEXT,
    end_date TEXT,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'discontinued', 'completed', 'on_hold', 'suspended')),
    status_reason TEXT,                 -- Why discontinued/suspended
    
    -- Source & Audit
    source TEXT DEFAULT 'prescribed'
        CHECK (source IN ('prescribed', 'patient_reported', 'imported', 'pharmacy')),
    prescribed_by INTEGER,             -- doctor who prescribed
    prescription_id INTEGER,           -- FK to prescriptions table
    
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (formulary_item_id) REFERENCES formulary_items(id),
    FOREIGN KEY (prescription_id) REFERENCES prescriptions(id)
);

CREATE INDEX IF NOT EXISTS idx_patient_meds_tenant ON patient_active_medications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_patient_meds_patient ON patient_active_medications(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_meds_status ON patient_active_medications(tenant_id, patient_id, status);
CREATE INDEX IF NOT EXISTS idx_patient_meds_generic ON patient_active_medications(tenant_id, generic_name);

-- ===================================================================
-- 5. Prescription Safety Checks (Audit trail)
-- ===================================================================
CREATE TABLE IF NOT EXISTS prescription_safety_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    prescription_id INTEGER,           -- FK to prescriptions (if created during Rx creation)
    patient_id INTEGER NOT NULL,
    
    -- What was checked
    medication_name TEXT NOT NULL,
    generic_name TEXT,
    
    -- Results
    check_type TEXT NOT NULL
        CHECK (check_type IN ('drug_interaction', 'allergy_contraindication', 'duplicate_therapy', 'max_dose', 'combined')),
    has_warnings INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    warnings_json TEXT,                -- JSON array of all warnings found
    
    -- Decision
    action_taken TEXT DEFAULT 'reviewed'
        CHECK (action_taken IN ('reviewed', 'overridden', 'prescription_modified', 'prescription_cancelled')),
    override_reason TEXT,              -- If doctor overrode a warning
    
    -- Audit
    checked_by INTEGER NOT NULL,
    checked_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (prescription_id) REFERENCES prescriptions(id)
);

CREATE INDEX IF NOT EXISTS idx_safety_checks_tenant ON prescription_safety_checks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_safety_checks_patient ON prescription_safety_checks(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_safety_checks_rx ON prescription_safety_checks(tenant_id, prescription_id);
CREATE INDEX IF NOT EXISTS idx_safety_checks_type ON prescription_safety_checks(tenant_id, check_type);

-- ===================================================================
-- 6. Seed Data — Common Drug Interaction Pairs (Bangladesh context)
-- ===================================================================
-- These are tenant-agnostic seed pairs that will be copied per tenant on first use
-- Using a special '__seed__' tenant_id that gets cloned

-- Analgesic interactions
INSERT OR IGNORE INTO drug_interaction_pairs (tenant_id, drug_a_name, drug_b_name, severity, description, recommendation, evidence_level) VALUES
('__seed__', 'paracetamol', 'warfarin', 'moderate', 'Paracetamol may enhance the anticoagulant effect of Warfarin at doses >2g/day', 'Monitor INR closely. Use lowest effective paracetamol dose.', 'established'),
('__seed__', 'ibuprofen', 'aspirin', 'major', 'NSAIDs may reduce the cardioprotective antiplatelet effect of Aspirin', 'Avoid concurrent use. If needed, take Aspirin 30min before Ibuprofen.', 'established'),
('__seed__', 'ibuprofen', 'warfarin', 'major', 'NSAIDs increase bleeding risk with anticoagulants', 'Avoid combination. Use Paracetamol instead.', 'established'),
('__seed__', 'diclofenac', 'warfarin', 'major', 'NSAIDs increase bleeding risk with anticoagulants', 'Avoid combination. Use Paracetamol instead.', 'established'),
('__seed__', 'naproxen', 'warfarin', 'major', 'NSAIDs increase bleeding risk with anticoagulants', 'Avoid combination. Use Paracetamol instead.', 'established'),
('__seed__', 'ketorolac', 'warfarin', 'contraindicated', 'Ketorolac is contraindicated with anticoagulants due to high bleeding risk', 'Do NOT combine. Use alternative analgesic.', 'established'),

-- Antibiotic interactions
('__seed__', 'metronidazole', 'warfarin', 'major', 'Metronidazole inhibits Warfarin metabolism, increasing bleeding risk', 'Reduce Warfarin dose by 25-50%. Monitor INR every 2-3 days.', 'established'),
('__seed__', 'ciprofloxacin', 'theophylline', 'major', 'Ciprofloxacin inhibits Theophylline metabolism, risk of toxicity', 'Reduce Theophylline dose by 30-50%. Monitor levels.', 'established'),
('__seed__', 'ciprofloxacin', 'warfarin', 'major', 'Fluoroquinolones enhance anticoagulant effect of Warfarin', 'Monitor INR closely. May need Warfarin dose reduction.', 'established'),
('__seed__', 'erythromycin', 'simvastatin', 'contraindicated', 'Erythromycin inhibits CYP3A4, dramatically increasing Simvastatin levels — risk of rhabdomyolysis', 'Contraindicated. Use Azithromycin or change statin.', 'established'),
('__seed__', 'clarithromycin', 'simvastatin', 'contraindicated', 'Clarithromycin inhibits CYP3A4, dramatically increasing Simvastatin levels — risk of rhabdomyolysis', 'Contraindicated. Use Azithromycin or change statin.', 'established'),
('__seed__', 'amoxicillin', 'methotrexate', 'major', 'Amoxicillin may reduce renal clearance of Methotrexate, increasing toxicity risk', 'Monitor methotrexate levels. Consider dose adjustment.', 'established'),
('__seed__', 'doxycycline', 'antacids', 'moderate', 'Antacids reduce absorption of Doxycycline', 'Separate dosing by at least 2 hours.', 'established'),
('__seed__', 'ciprofloxacin', 'antacids', 'major', 'Antacids containing Al/Mg significantly reduce Ciprofloxacin absorption', 'Take Ciprofloxacin 2 hours before or 6 hours after antacids.', 'established'),

-- Cardiovascular interactions
('__seed__', 'atenolol', 'verapamil', 'major', 'Combined use of beta-blockers and Verapamil can cause severe bradycardia and heart block', 'Avoid combination. Use Amlodipine instead of Verapamil if needed.', 'established'),
('__seed__', 'metoprolol', 'verapamil', 'major', 'Combined use of beta-blockers and Verapamil can cause severe bradycardia and heart block', 'Avoid combination. Monitor HR closely if unavoidable.', 'established'),
('__seed__', 'amlodipine', 'simvastatin', 'moderate', 'Amlodipine increases Simvastatin levels. Limit Simvastatin to 20mg/day', 'Cap Simvastatin at 20mg daily. Consider Atorvastatin.', 'established'),
('__seed__', 'enalapril', 'potassium', 'major', 'ACE inhibitors + potassium supplements = risk of hyperkalemia', 'Monitor serum potassium regularly. Avoid potassium supplements unless hypokalemic.', 'established'),
('__seed__', 'lisinopril', 'potassium', 'major', 'ACE inhibitors + potassium supplements = risk of hyperkalemia', 'Monitor serum potassium regularly.', 'established'),
('__seed__', 'enalapril', 'spironolactone', 'major', 'ACE inhibitors + potassium-sparing diuretics = hyperkalemia risk', 'Monitor serum potassium. Start with low spironolactone dose.', 'established'),
('__seed__', 'digoxin', 'amiodarone', 'major', 'Amiodarone increases Digoxin levels by 50-100%', 'Reduce Digoxin dose by 50% when starting Amiodarone. Monitor levels.', 'established'),
('__seed__', 'digoxin', 'verapamil', 'major', 'Verapamil increases Digoxin levels and additive AV block risk', 'Reduce Digoxin dose by 25-50%. Monitor levels and ECG.', 'established'),
('__seed__', 'clopidogrel', 'omeprazole', 'major', 'Omeprazole inhibits CYP2C19, reducing Clopidogrel activation', 'Use Pantoprazole or Rabeprazole instead. Avoid Omeprazole/Esomeprazole.', 'established'),

-- Diabetes interactions
('__seed__', 'metformin', 'alcohol', 'major', 'Alcohol increases risk of lactic acidosis with Metformin', 'Limit alcohol intake. Avoid heavy/binge drinking.', 'established'),
('__seed__', 'glimepiride', 'fluconazole', 'major', 'Fluconazole inhibits CYP2C9, increasing Glimepiride levels — hypoglycemia risk', 'Monitor blood glucose closely. May need dose reduction.', 'established'),
('__seed__', 'insulin', 'beta-blockers', 'moderate', 'Beta-blockers may mask hypoglycemia symptoms and prolong recovery', 'Use cardio-selective beta-blockers (Metoprolol). Monitor glucose carefully.', 'established'),

-- CNS / Psychiatric interactions
('__seed__', 'fluoxetine', 'tramadol', 'major', 'SSRIs + Tramadol = serotonin syndrome risk', 'Avoid combination. If necessary, start low and monitor for serotonin symptoms (tremor, agitation, hyperthermia).', 'established'),
('__seed__', 'sertraline', 'tramadol', 'major', 'SSRIs + Tramadol = serotonin syndrome risk', 'Avoid combination. Use alternative analgesic.', 'established'),
('__seed__', 'fluoxetine', 'maois', 'contraindicated', 'SSRIs + MAOIs = severe serotonin syndrome, potentially fatal', 'Absolutely contraindicated. Minimum 5-week washout for Fluoxetine before MAOI.', 'established'),
('__seed__', 'amitriptyline', 'tramadol', 'major', 'TCAs + Tramadol = serotonin syndrome + seizure risk', 'Avoid combination. Use alternative analgesic.', 'established'),
('__seed__', 'diazepam', 'opioids', 'major', 'Benzodiazepines + Opioids = severe respiratory depression risk', 'Avoid combination when possible. Use lowest effective doses. Monitor respiratory status.', 'established'),

-- GI interactions (omeprazole↔clopidogrel already covered in cardiovascular section line 215)
('__seed__', 'metoclopramide', 'levodopa', 'major', 'Metoclopramide antagonizes the dopaminergic effect of Levodopa', 'Contraindicated in Parkinson patients. Use Domperidone instead.', 'established'),

-- Miscellaneous common interactions
('__seed__', 'levothyroxine', 'calcium', 'moderate', 'Calcium supplements reduce Levothyroxine absorption', 'Separate doses by at least 4 hours. Take Levothyroxine on empty stomach.', 'established'),
('__seed__', 'levothyroxine', 'iron', 'moderate', 'Iron supplements reduce Levothyroxine absorption', 'Separate doses by at least 4 hours.', 'established'),
('__seed__', 'tetracycline', 'iron', 'moderate', 'Iron reduces Tetracycline absorption by chelation', 'Separate doses by at least 2-3 hours.', 'established'),
('__seed__', 'tetracycline', 'calcium', 'moderate', 'Calcium reduces Tetracycline absorption by chelation', 'Separate doses by at least 2-3 hours.', 'established'),
('__seed__', 'allopurinol', 'azathioprine', 'contraindicated', 'Allopurinol inhibits Azathioprine metabolism, causing severe myelosuppression', 'Reduce Azathioprine dose by 75% or use alternative.', 'established'),
('__seed__', 'sildenafil', 'nitrates', 'contraindicated', 'PDE5 inhibitors + Nitrates = severe life-threatening hypotension', 'Absolutely contraindicated. Allow 24h washout (48h for Tadalafil).', 'established');

-- ===================================================================
-- 7. Seed Formulary Categories  
-- ===================================================================
INSERT OR IGNORE INTO formulary_categories (tenant_id, name, description, sort_order) VALUES
('__seed__', 'Analgesics & Antipyretics', 'Pain relievers and fever reducers', 1),
('__seed__', 'Antibiotics', 'Anti-infective agents', 2),
('__seed__', 'Antidiabetics', 'Diabetes medications', 3),
('__seed__', 'Cardiovascular', 'Heart and blood pressure medications', 4),
('__seed__', 'Gastrointestinal', 'GI tract medications', 5),
('__seed__', 'Respiratory', 'Asthma, COPD, allergy medications', 6),
('__seed__', 'CNS / Psychiatric', 'Neurological and psychiatric medications', 7),
('__seed__', 'Dermatological', 'Skin medications', 8),
('__seed__', 'Vitamins & Supplements', 'Nutritional supplements', 9),
('__seed__', 'Antihistamines', 'Allergy medications', 10),
('__seed__', 'Hormones & Steroids', 'Hormonal therapies and corticosteroids', 11),
('__seed__', 'Antifungals', 'Antifungal medications', 12),
('__seed__', 'Anticoagulants', 'Blood thinners', 13),
('__seed__', 'Ophthalmological', 'Eye medications', 14),
('__seed__', 'ENT', 'Ear, nose, and throat medications', 15);
