-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0147: Order Sets — Pre-built order bundles for admissions/protocols
-- Doctors click "Admit Pneumonia" → auto-creates meds, labs, diet, nursing orders
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS order_set_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  specialty TEXT,
  category TEXT DEFAULT 'admission',
  is_global INTEGER DEFAULT 1,
  created_by INTEGER,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ost_code ON order_set_templates(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_ost_tenant ON order_set_templates(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ost_specialty ON order_set_templates(specialty);

CREATE TABLE IF NOT EXISTS order_set_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_set_id INTEGER NOT NULL REFERENCES order_set_templates(id),
  sequence INTEGER NOT NULL DEFAULT 0,
  item_type TEXT NOT NULL,
  medication_name TEXT,
  generic_name TEXT,
  dose TEXT,
  route TEXT,
  frequency TEXT,
  duration TEXT,
  instructions TEXT,
  formulary_item_id INTEGER,
  lab_test_id INTEGER,
  lab_test_code TEXT,
  description TEXT,
  priority TEXT DEFAULT 'routine',
  is_optional INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_osi_set ON order_set_items(order_set_id);

CREATE TABLE IF NOT EXISTS doctor_favorite_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  items_json TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dfo_doctor ON doctor_favorite_orders(tenant_id, doctor_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Seed: Bangladesh Hospital Order Sets (tenant_id='__seed__' for auto-clone)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Pneumonia Admission
INSERT OR IGNORE INTO order_set_templates (code, name, description, specialty, category, is_global, tenant_id) VALUES
('PNEUMONIA_ADMIT', 'Pneumonia Admission', 'Standard admission protocol for community-acquired pneumonia', 'medicine', 'admission', 1, '__seed__');

INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, duration, instructions, priority, tenant_id)
SELECT id, 1, 'medication', 'Ceftriaxone 1g IV', 'ceftriaxone', '1g', 'IV', 'BD (12 hourly)', '5-7 days', 'Reconstitute in 10ml NS, give over 30 min', 'urgent', '__seed__' FROM order_set_templates WHERE code='PNEUMONIA_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, duration, instructions, priority, tenant_id)
SELECT id, 2, 'medication', 'Azithromycin 500mg', 'azithromycin', '500mg', 'Oral', 'OD', '3 days', 'Take on empty stomach', 'routine', '__seed__' FROM order_set_templates WHERE code='PNEUMONIA_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, duration, instructions, priority, tenant_id)
SELECT id, 3, 'medication', 'Paracetamol 500mg', 'paracetamol', '500mg', 'Oral', 'TDS (8 hourly)', 'PRN', 'For fever >38.5°C', 'routine', '__seed__' FROM order_set_templates WHERE code='PNEUMONIA_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 4, 'lab_test', 'CBC', 'Complete Blood Count', 'urgent', '__seed__' FROM order_set_templates WHERE code='PNEUMONIA_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 5, 'lab_test', 'CRP', 'C-Reactive Protein', 'urgent', '__seed__' FROM order_set_templates WHERE code='PNEUMONIA_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 6, 'instruction', 'Chest X-ray PA view', 'routine', '__seed__' FROM order_set_templates WHERE code='PNEUMONIA_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 7, 'nursing', 'Monitor SpO2 every 4 hours. O2 via nasal cannula if SpO2 <94%. Elevate head of bed 30°.', 'urgent', '__seed__' FROM order_set_templates WHERE code='PNEUMONIA_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 8, 'diet', 'Soft diet, adequate fluids (2-3L/day), warm liquids encouraged', 'routine', '__seed__' FROM order_set_templates WHERE code='PNEUMONIA_ADMIT' AND tenant_id='__seed__';

-- 2. Dengue Admission
INSERT OR IGNORE INTO order_set_templates (code, name, description, specialty, category, is_global, tenant_id) VALUES
('DENGUE_ADMIT', 'Dengue Fever Admission', 'Dengue fever management protocol with fluid monitoring', 'medicine', 'admission', 1, '__seed__');

INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, duration, instructions, priority, tenant_id)
SELECT id, 1, 'medication', 'Normal Saline 1000ml IV', 'sodium chloride 0.9%', '1000ml', 'IV', 'As per fluid chart', 'Until recovery', 'Rate as per hemodynamic status. Bolus 10ml/kg if shock.', 'urgent', '__seed__' FROM order_set_templates WHERE code='DENGUE_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, duration, instructions, priority, tenant_id)
SELECT id, 2, 'medication', 'Paracetamol 500mg', 'paracetamol', '500mg', 'Oral', 'QDS (6 hourly)', 'PRN', 'For fever. AVOID aspirin/NSAIDs.', 'routine', '__seed__' FROM order_set_templates WHERE code='DENGUE_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 3, 'lab_test', 'CBC', 'CBC with Platelet Count — repeat DAILY', 'urgent', '__seed__' FROM order_set_templates WHERE code='DENGUE_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 4, 'lab_test', 'DENGUE_NS1', 'Dengue NS1 Antigen + IgM/IgG', 'urgent', '__seed__' FROM order_set_templates WHERE code='DENGUE_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 5, 'nursing', 'Strict I/O charting every 4 hours. Monitor for warning signs: abdominal pain, persistent vomiting, mucosal bleeding, lethargy. Platelet transfusion if <10,000 with active bleeding.', 'urgent', '__seed__' FROM order_set_templates WHERE code='DENGUE_ADMIT' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 6, 'diet', 'Soft diet. ORS encouraged. Papaya leaf juice (traditional). Avoid red/dark foods.', 'routine', '__seed__' FROM order_set_templates WHERE code='DENGUE_ADMIT' AND tenant_id='__seed__';

-- 3. DKA (Diabetic Ketoacidosis)
INSERT OR IGNORE INTO order_set_templates (code, name, description, specialty, category, is_global, tenant_id) VALUES
('DKA_PROTOCOL', 'DKA Management Protocol', 'Diabetic ketoacidosis emergency protocol', 'medicine', 'protocol', 1, '__seed__');

INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, instructions, priority, tenant_id)
SELECT id, 1, 'medication', 'Normal Saline 1000ml', 'sodium chloride 0.9%', '1000ml', 'IV', 'Per protocol', '1st hour: 1L. Then 500ml/hr for 2-4hrs. Switch to 0.45% NS when Na>155.', 'stat', '__seed__' FROM order_set_templates WHERE code='DKA_PROTOCOL' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, instructions, priority, tenant_id)
SELECT id, 2, 'medication', 'Insulin Regular (Actrapid)', 'insulin regular', '0.1 U/kg/hr', 'IV infusion', 'Continuous', 'Bolus 0.1 U/kg, then 0.1 U/kg/hr. Reduce to 0.05 when glucose <250.', 'stat', '__seed__' FROM order_set_templates WHERE code='DKA_PROTOCOL' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, instructions, priority, tenant_id)
SELECT id, 3, 'medication', 'KCl 20mEq in NS', 'potassium chloride', '20mEq', 'IV', 'Per K+ level', 'If K<3.3: hold insulin, give 40mEq/hr. If 3.3-5.3: give 20-30mEq/L of fluid.', 'stat', '__seed__' FROM order_set_templates WHERE code='DKA_PROTOCOL' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 4, 'lab_test', 'RBS', 'Blood Glucose — every 1 hour', 'stat', '__seed__' FROM order_set_templates WHERE code='DKA_PROTOCOL' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 5, 'lab_test', 'ELECTROLYTES', 'Serum Electrolytes (Na, K, Cl, HCO3) — every 2-4 hours', 'stat', '__seed__' FROM order_set_templates WHERE code='DKA_PROTOCOL' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 6, 'nursing', 'Strict I/O. Hourly vitals. Hourly RBS. Neuro checks. ECG monitoring. Foley catheter.', 'stat', '__seed__' FROM order_set_templates WHERE code='DKA_PROTOCOL' AND tenant_id='__seed__';

-- 4. Elective Surgery Pre-Op
INSERT OR IGNORE INTO order_set_templates (code, name, description, specialty, category, is_global, tenant_id) VALUES
('PREOP_ELECTIVE', 'Elective Surgery Pre-Op Orders', 'Standard pre-operative work-up for elective surgery', 'surgery', 'procedure', 1, '__seed__');

INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 1, 'lab_test', 'CBC', 'Complete Blood Count', 'routine', '__seed__' FROM order_set_templates WHERE code='PREOP_ELECTIVE' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 2, 'lab_test', 'RFT', 'Renal Function Test (Creatinine, Urea, Electrolytes)', 'routine', '__seed__' FROM order_set_templates WHERE code='PREOP_ELECTIVE' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 3, 'lab_test', 'BG_RH', 'Blood Group & Rh Typing', 'routine', '__seed__' FROM order_set_templates WHERE code='PREOP_ELECTIVE' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 4, 'lab_test', 'PT_INR', 'PT/INR + APTT', 'routine', '__seed__' FROM order_set_templates WHERE code='PREOP_ELECTIVE' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 5, 'instruction', 'ECG — 12 lead', 'routine', '__seed__' FROM order_set_templates WHERE code='PREOP_ELECTIVE' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 6, 'instruction', 'Chest X-ray PA view', 'routine', '__seed__' FROM order_set_templates WHERE code='PREOP_ELECTIVE' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, is_optional, tenant_id)
SELECT id, 7, 'instruction', 'Anesthesia fitness assessment', 'routine', 0, '__seed__' FROM order_set_templates WHERE code='PREOP_ELECTIVE' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 8, 'nursing', 'NPO from midnight before surgery. Informed consent signed. Surgical site marked. Remove jewelry/dentures.', 'routine', '__seed__' FROM order_set_templates WHERE code='PREOP_ELECTIVE' AND tenant_id='__seed__';

-- 5. Normal Delivery
INSERT OR IGNORE INTO order_set_templates (code, name, description, specialty, category, is_global, tenant_id) VALUES
('NVD_PROTOCOL', 'Normal Vaginal Delivery', 'Standard protocol for normal delivery management', 'obs_gyn', 'protocol', 1, '__seed__');

INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, instructions, priority, tenant_id)
SELECT id, 1, 'medication', 'Oxytocin 10 IU', 'oxytocin', '10 IU', 'IM', 'Once', 'Active management of 3rd stage. Give after delivery of anterior shoulder.', 'stat', '__seed__' FROM order_set_templates WHERE code='NVD_PROTOCOL' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name, dose, route, frequency, instructions, priority, is_optional, tenant_id)
SELECT id, 2, 'medication', 'Misoprostol 600mcg', 'misoprostol', '600mcg', 'Sublingual', 'Once', 'If oxytocin unavailable or PPH. Keep ready.', 'urgent', 1, '__seed__' FROM order_set_templates WHERE code='NVD_PROTOCOL' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, lab_test_code, description, priority, tenant_id)
SELECT id, 3, 'lab_test', 'CBC', 'CBC — post-delivery', 'routine', '__seed__' FROM order_set_templates WHERE code='NVD_PROTOCOL' AND tenant_id='__seed__';
INSERT OR IGNORE INTO order_set_items (order_set_id, sequence, item_type, description, priority, tenant_id)
SELECT id, 4, 'nursing', 'Monitor vitals every 15 min for 2 hours post-delivery. Assess uterine tone. Monitor lochia. Early breastfeeding initiation.', 'urgent', '__seed__' FROM order_set_templates WHERE code='NVD_PROTOCOL' AND tenant_id='__seed__';
