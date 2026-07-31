-- =============================================================================
-- HMS SaaS — Demo Hospital Extended Seed
-- Hospital: "City Care General Hospital" | tenant_id: 100
-- Run AFTER seed_demo.sql:
--   npx wrangler d1 execute DB --remote --file=migrations/seed_demo_extended.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SEQUENCE COUNTERS (so new records get correct numbers after seeding)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR REPLACE INTO sequence_counters (counter_type, prefix, current_value, tenant_id) VALUES
('patient',     'P-',    20,  100),
('visit',       'V-',    23,  100),
('invoice',     'INV-',  20,  100),
('lab_order',   'LO-',   8,   100),
('purchase',    'PUR-',  2,   100),
('appointment', 'APT-',  15,  100),
('prescription','RX-',   10,  100),
('admission',   'ADM-',  3,   100),
('consultation','CONS-', 5,   100);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DOCTOR SCHEDULES (weekly OPD schedule for all 10 doctors)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO doctor_schedules (id, tenant_id, doctor_id, day_of_week, start_time, end_time, session_type, chamber, max_patients, is_active) VALUES
-- Dr. Aminul Islam (General Medicine) — Sun/Mon/Wed/Thu 9-1
(20001, 100, 101, 'sun', '09:00', '13:00', 'morning',   'Chamber 1, Ground Floor', 25, 1),
(20002, 100, 101, 'mon', '09:00', '13:00', 'morning',   'Chamber 1, Ground Floor', 25, 1),
(20003, 100, 101, 'wed', '09:00', '13:00', 'morning',   'Chamber 1, Ground Floor', 25, 1),
(20004, 100, 101, 'thu', '09:00', '13:00', 'morning',   'Chamber 1, Ground Floor', 25, 1),
-- Dr. Fatema Khatun (Gynae) — Sun/Tue/Thu 10-2
(20005, 100, 102, 'sun', '10:00', '14:00', 'morning',   'Chamber 2, Ground Floor', 20, 1),
(20006, 100, 102, 'tue', '10:00', '14:00', 'morning',   'Chamber 2, Ground Floor', 20, 1),
(20007, 100, 102, 'thu', '10:00', '14:00', 'morning',   'Chamber 2, Ground Floor', 20, 1),
-- Dr. Rafiqul Haque (Cardiology) — Mon/Wed/Fri 9-1
(20008, 100, 103, 'mon', '09:00', '13:00', 'morning',   'Cardiology Dept, 2nd Floor', 15, 1),
(20009, 100, 103, 'wed', '09:00', '13:00', 'morning',   'Cardiology Dept, 2nd Floor', 15, 1),
(20010, 100, 103, 'fri', '09:00', '13:00', 'morning',   'Cardiology Dept, 2nd Floor', 15, 1),
-- Dr. Sharmin Akter (Paediatrics) — Sun/Mon/Tue/Thu 9-1
(20011, 100, 104, 'sun', '09:00', '13:00', 'morning',   'Chamber 3, Ground Floor', 30, 1),
(20012, 100, 104, 'mon', '09:00', '13:00', 'morning',   'Chamber 3, Ground Floor', 30, 1),
(20013, 100, 104, 'tue', '09:00', '13:00', 'morning',   'Chamber 3, Ground Floor', 30, 1),
(20014, 100, 104, 'thu', '09:00', '13:00', 'morning',   'Chamber 3, Ground Floor', 30, 1),
-- Dr. Mizanur Rahman (Orthopaedics) — Mon/Wed/Thu 9-1
(20015, 100, 105, 'mon', '09:00', '13:00', 'morning',   'Ortho Dept, 1st Floor', 20, 1),
(20016, 100, 105, 'wed', '09:00', '13:00', 'morning',   'Ortho Dept, 1st Floor', 20, 1),
(20017, 100, 105, 'thu', '09:00', '13:00', 'morning',   'Ortho Dept, 1st Floor', 20, 1),
-- Dr. Nasreen Jahan (Dermatology) — Sat/Sun/Tue 4-8pm
(20018, 100, 106, 'sat', '16:00', '20:00', 'evening',   'Chamber 4, Ground Floor', 20, 1),
(20019, 100, 106, 'sun', '16:00', '20:00', 'evening',   'Chamber 4, Ground Floor', 20, 1),
(20020, 100, 106, 'tue', '16:00', '20:00', 'evening',   'Chamber 4, Ground Floor', 20, 1),
-- Dr. Golam Rabbani (ENT) — Sun/Tue/Thu 9-1
(20021, 100, 107, 'sun', '09:00', '13:00', 'morning',   'ENT Dept, 1st Floor', 20, 1),
(20022, 100, 107, 'tue', '09:00', '13:00', 'morning',   'ENT Dept, 1st Floor', 20, 1),
(20023, 100, 107, 'thu', '09:00', '13:00', 'morning',   'ENT Dept, 1st Floor', 20, 1),
-- Dr. Sayeda Khanam (Ophthalmology) — Mon/Wed/Sat 9-1
(20024, 100, 108, 'mon', '09:00', '13:00', 'morning',   'Eye Dept, 1st Floor', 20, 1),
(20025, 100, 108, 'wed', '09:00', '13:00', 'morning',   'Eye Dept, 1st Floor', 20, 1),
(20026, 100, 108, 'sat', '09:00', '13:00', 'morning',   'Eye Dept, 1st Floor', 20, 1),
-- Dr. Anwar Hossain (Nephrology) — Mon/Wed 9-1
(20027, 100, 109, 'mon', '09:00', '13:00', 'morning',   'Nephrology Dept, 2nd Floor', 15, 1),
(20028, 100, 109, 'wed', '09:00', '13:00', 'morning',   'Nephrology Dept, 2nd Floor', 15, 1),
-- Dr. Tahmina Sultana (Psychiatry) — Tue/Thu 3-7pm
(20029, 100, 110, 'tue', '15:00', '19:00', 'afternoon', 'Psychiatry Dept, 3rd Floor', 12, 1),
(20030, 100, 110, 'thu', '15:00', '19:00', 'afternoon', 'Psychiatry Dept, 3rd Floor', 12, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. NOTIFICATIONS (realistic notifications for all roles)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO notifications (id, tenant_id, user_id, type, title, message, is_read, link) VALUES
-- For admin (101)
(21001, 100, 101, 'system',      'Welcome to HMS SaaS',                 'Your hospital portal is now active. Complete your profile setup.', 1, '/admin/settings'),
(21002, 100, 101, 'billing',     'Outstanding dues: ৳6,95,000',         '5 patients have pending bills totaling ৳6,95,000. Review billing dashboard.', 0, '/billing'),
(21003, 100, 101, 'system',      'New staff joined',                    'Milon Mahmud has been added as Accountant. Verify their access level.', 1, '/admin/staff'),
-- For lab (102)
(21004, 100, 102, 'lab',         'Critical lab result — P-003',         'Troponin I: 2.5 ng/mL (CRITICAL HIGH) for Karim Mia. Notify doctor immediately.', 0, '/lab/orders'),
(21005, 100, 102, 'lab',         'Critical lab result — P-017',         'Platelet count: 62,000/μL (CRITICAL LOW) for Rubel Mia. Dengue monitoring required.', 0, '/lab/orders'),
(21006, 100, 102, 'lab',         '8 pending lab orders today',          'There are 8 lab orders awaiting processing. Please prioritize ICU samples.', 0, '/lab/queue'),
(21007, 100, 102, 'lab',         'Low reagent stock alert',             'CBC reagent stock below threshold. Please reorder from supplier.', 0, '/lab'),
-- For reception (103)
(21008, 100, 103, 'appointment', '15 appointments tomorrow',            'There are 15 scheduled OPD appointments for tomorrow (Mar 14). Review schedule.', 0, '/appointments'),
(21009, 100, 103, 'appointment', 'Appointment reminder — P-001',        'Mohammad Ali has appointment at 9:00 AM with Dr. Aminul Islam tomorrow.', 0, '/appointments'),
(21010, 100, 103, 'billing',     'Unpaid bill — Sabina Yesmin',         'Patient Sabina Yesmin (P-008) has an unpaid bill of ৳600. Follow up for payment.', 0, '/billing'),
-- For pharmacy (104)
(21011, 100, 104, 'pharmacy',    'Low stock: Insulin Glargine',         'Only 20 vials remaining. Reorder level is 5. Place order with Novo Nordisk distributor.', 0, '/pharmacy/inventory'),
(21012, 100, 104, 'pharmacy',    'Expiry alert: 3 medicines',           '3 medicine batches expire within 90 days. Review pharmacy inventory.', 0, '/pharmacy/inventory'),
(21013, 100, 104, 'pharmacy',    'New prescription from Dr. Aminul',    'RX-0001 for Mohammad Ali (P-001). 3 medicines to be dispensed.', 0, '/pharmacy'),
-- For MD/doctor (105)
(21014, 100, 105, 'admission',   'New ICU admission — ADM-0001',        'Karim Mia admitted to ICU with Acute MI. Troponin elevated. Review immediately.', 0, '/ipd/admissions'),
(21015, 100, 105, 'lab',         'Critical values — 2 patients',        '2 patients have critical lab values requiring immediate clinical review.', 0, '/lab/results'),
-- For director (106)
(21016, 100, 106, 'system',      'Monthly revenue summary',             'January 2026 collection: 34,10,000 BDT. Expenses: 23,12,000 BDT. Net: 10,98,000 BDT.', 0, '/director/dashboard'),
(21017, 100, 106, 'system',      'Bed occupancy update',                '4 of 20 beds are currently occupied (20%). 3 are in ICU/Ward B/Ward C.', 1, '/director/dashboard'),
-- For accountant (107)
(21018, 100, 107, 'billing',     'Pending supplier payment',            'Beximco Pharma has outstanding due of ৳80,000 for PUR-0002. Payment due this month.', 0, '/accounting'),
(21019, 100, 107, 'billing',     'February salary processing due',      'February salaries for 16 staff members need to be processed by Feb 28.', 0, '/accounting'),
(21020, 100, 107, 'system',      'Insurance claim update',              '1 insurance claim under review, 1 approved. Check accounting dashboard.', 0, '/accounting');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. IPD CHARGES (daily charges for 3 admitted patients)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ipd_charges (id, tenant_id, admission_id, patient_id, charge_date, charge_type, description, amount, posted_by) VALUES
-- ADM-0001: Karim Mia in ICU (Feb 1-9) — ICU rate: ৳3,000/day room + ৳2,000/day nursing
(22001, 100, 13001, 1003, '2026-02-01', 'room',    'ICU Bed charge',          300000, 106),
(22002, 100, 13001, 1003, '2026-02-01', 'nursing', 'ICU Nursing care',        200000, 106),
(22003, 100, 13001, 1003, '2026-02-02', 'room',    'ICU Bed charge',          300000, 106),
(22004, 100, 13001, 1003, '2026-02-02', 'nursing', 'ICU Nursing care',        200000, 106),
(22005, 100, 13001, 1003, '2026-02-03', 'room',    'ICU Bed charge',          300000, 106),
(22006, 100, 13001, 1003, '2026-02-03', 'nursing', 'ICU Nursing care',        200000, 106),
(22007, 100, 13001, 1003, '2026-02-04', 'room',    'ICU Bed charge',          300000, 106),
(22008, 100, 13001, 1003, '2026-02-04', 'nursing', 'ICU Nursing care',        200000, 106),
(22009, 100, 13001, 1003, '2026-02-05', 'other',   'Cardiac monitoring',      150000, 106),
-- ADM-0002: Aminul Karim in Ward A (Feb 5-10) — Ward rate: ৳1,500/day
(22010, 100, 13002, 1009, '2026-02-05', 'room',    'Ward A Bed charge',       150000, 106),
(22011, 100, 13002, 1009, '2026-02-05', 'nursing', 'Nursing care + IV fluids',100000, 106),
(22012, 100, 13002, 1009, '2026-02-06', 'room',    'Ward A Bed charge',       150000, 106),
(22013, 100, 13002, 1009, '2026-02-06', 'nursing', 'Nursing care + IV fluids',100000, 106),
(22014, 100, 13002, 1009, '2026-02-07', 'room',    'Ward A Bed charge',       150000, 106),
(22015, 100, 13002, 1009, '2026-02-07', 'nursing', 'Nursing care',            100000, 106),
(22016, 100, 13002, 1009, '2026-02-08', 'other',   'Dialysis consultation',   200000, 106),
-- ADM-0003: Taslima Begum in Ward B (Feb 8-12) — Semi-private: ৳2,000/day
(22017, 100, 13003, 1016, '2026-02-08', 'room',    'Ward B Semi-private Bed', 200000, 106),
(22018, 100, 13003, 1016, '2026-02-08', 'nursing', 'Nursing care + IV meds',  150000, 106),
(22019, 100, 13003, 1016, '2026-02-09', 'room',    'Ward B Semi-private Bed', 200000, 106),
(22020, 100, 13003, 1016, '2026-02-09', 'nursing', 'Nursing care',            150000, 106),
(22021, 100, 13003, 1016, '2026-02-10', 'room',    'Ward B Semi-private Bed', 200000, 106),
(22022, 100, 13003, 1016, '2026-02-10', 'other',   'BP monitoring (24hr)',     50000, 106);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. INSURANCE POLICIES + CLAIMS
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO insurance_policies (id, tenant_id, patient_id, provider_name, policy_no, policy_type, coverage_limit, valid_from, valid_to, status) VALUES
(23001, 100, 1003, 'MetLife Insurance BD',       'MLI-BD-2024-77821', 'individual', 50000000, '2024-01-01', '2026-12-31', 'active'),
(23002, 100, 1009, 'Green Delta Insurance',      'GDI-2024-43210',    'individual', 30000000, '2024-06-01', '2026-05-31', 'active'),
(23003, 100, 1020, 'Pragati Life Insurance',     'PLI-2023-99012',    'individual', 20000000, '2023-01-01', '2025-12-31', 'active'),
(23004, 100, 1016, 'BRAC Saajan Insurance',      'BSI-2025-11204',    'individual', 25000000, '2025-01-01', '2027-12-31', 'active');

INSERT OR IGNORE INTO insurance_claims (id, tenant_id, claim_no, patient_id, policy_id, bill_id, diagnosis, icd10_code, bill_amount, claimed_amount, approved_amount, status, submitted_at, reviewed_at, settled_at) VALUES
(24001, 100, 'CLM-0001', 1003, 23001, 5003, 'Acute Myocardial Infarction (STEMI)', 'I21.0', 330000, 330000, 330000, 'settled',       '2026-01-16 10:00:00', '2026-01-20 10:00:00', '2026-01-25 10:00:00'),
(24002, 100, 'CLM-0002', 1009, 23002, 5009, 'Acute Kidney Injury (AKI)',           'N17.9', 255000, 255000, 200000, 'approved',      '2026-01-20 10:00:00', '2026-01-28 10:00:00', NULL),
(24003, 100, 'CLM-0003', 1020, 23003, 5020, 'Post-STEMI Follow-up',               'I25.1', 580000, 400000, NULL,   'under_review',  '2026-01-30 10:00:00', NULL,                NULL),
(24004, 100, 'CLM-0004', 1016, 23004, 5016, 'Hypertensive Emergency',             'I16.0', 390000, 390000, NULL,   'submitted',     '2026-01-26 10:00:00', NULL,                NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TELEMEDICINE CONSULTATIONS
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO consultations (id, doctor_id, patient_id, scheduled_at, duration_min, status, notes, chief_complaint, followup_date, tenant_id, created_by) VALUES
(25001, 101, 1005, '2026-02-10T10:00:00', 30, 'completed', 'Post-injury follow-up via telemedicine. Knee improving. Physiotherapy continued.',  'Right knee pain follow-up',    '2026-02-24', '100', '103'),
(25002, 110, 1010, '2026-02-12T15:00:00', 45, 'completed', 'Anxiety management session. Sleep hygiene discussed. Melatonin prescribed.',        'Anxiety and insomnia',         '2026-03-12', '100', '103'),
(25003, 103, 1020, '2026-02-15T09:30:00', 30, 'completed', 'Post-MI telehealth review. ECG findings reviewed. Warfarin dose adjusted.',         'Post-MI cardiac follow-up',    '2026-03-15', '100', '103'),
(25004, 101, 1013, '2026-02-20T11:00:00', 30, 'completed', 'Typhoid recovery confirmed. Full recovery. No further antibiotics needed.',          'Typhoid recovery check',       NULL,         '100', '103'),
(25005, 102, 1002, '2026-03-14T10:30:00', 45, 'scheduled', 'ANC telehealth consultation — 24-week checkup. USG reports to be shared online.',   'ANC 24-week telemedicine',     '2026-04-14', '100', '103');

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. MEDICINE STOCK MOVEMENTS (purchase in + some sales out)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO medicine_stock_movements (id, medicine_id, batch_id, movement_type, quantity, unit_cost, unit_price, reference_type, reference_id, movement_date, tenant_id, created_by) VALUES
-- Purchase IN — PUR-0001 (Jan 8)
(26001, 1001, 11001, 'purchase_in', 1000, 70,    100,   'purchase', 9001, '2026-01-08', 100, 107),
(26002, 1002, 11002, 'purchase_in', 200,  600,   800,   'purchase', 9001, '2026-01-08', 100, 107),
(26003, 1004, 11003, 'purchase_in', 400,  220,   300,   'purchase', 9001, '2026-01-08', 100, 107),
(26004, 1005, 11004, 'purchase_in', 600,  120,   200,   'purchase', 9001, '2026-01-08', 100, 107),
-- Purchase IN — PUR-0002 (Jan 22)
(26005, 1009, 11005, 'purchase_in', 100,  900,   1200,  'purchase', 9002, '2026-01-22', 100, 107),
(26006, 1014, 11006, 'purchase_in', 30,   18000, 25000, 'purchase', 9002, '2026-01-22', 100, 107),
-- Sale OUT (pharmacy dispenses)
(26007, 1001, 11001, 'sale_out', 200, 70,  100,  'sale', NULL, '2026-01-31', 100, 104),
(26008, 1002, 11002, 'sale_out',  10, 600, 800,  'sale', NULL, '2026-01-31', 100, 104),
(26009, 1004, 11003, 'sale_out',  80, 220, 300,  'sale', NULL, '2026-01-31', 100, 104),
(26010, 1005, 11004, 'sale_out', 120, 120, 200,  'sale', NULL, '2026-01-31', 100, 104),
(26011, 1014, 11006, 'sale_out',   2, 18000, 25000, 'sale', NULL, '2026-01-28', 100, 104),
-- Adjustment (damaged/expired)
(26012, 1001, 11001, 'adjustment', -50, 70, 100, 'manual', NULL, '2026-01-31', 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. LAB TEST CATALOG — enrich with units, normal ranges, critical thresholds
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE lab_test_catalog SET
  unit = 'cells/μL', normal_range = 'WBC: 4000-11000 | Hb M: 13-17 F: 12-16 | Plt: 150000-400000',
  method = 'Automated CBC Analyzer', critical_low = 2000, critical_high = 30000
WHERE id = 1001 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'mmol/L', normal_range = '4.0-6.0',
  method = 'Enzymatic Colorimetric', critical_low = 2.8, critical_high = 22.2
WHERE id = 1002 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'mmol/L', normal_range = '<7.8 (2hr post-meal)',
  method = 'Enzymatic Colorimetric', critical_low = 2.8, critical_high = 22.2
WHERE id = 1003 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'mg/L', normal_range = '< 5',
  method = 'Immunoturbidimetry', critical_low = NULL, critical_high = 200
WHERE id = 1004 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'U/L / g/dL', normal_range = 'ALT M: 7-56 F: 7-45 | ALB: 3.5-5.5',
  method = 'Colorimetric / Bromocresol Green', critical_low = NULL, critical_high = 500
WHERE id = 1005 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'mg/dL', normal_range = 'Creatinine: 0.6-1.2 | BUN: 7-20',
  method = 'Jaffe Colorimetric', critical_low = NULL, critical_high = 10
WHERE id = 1006 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'mg/dL', normal_range = 'Total Chol < 200 | LDL < 100 | HDL M>40 F>50 | TG < 150',
  method = 'Enzymatic Colorimetric', critical_low = NULL, critical_high = 500
WHERE id = 1007 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'mIU/L', normal_range = '0.4-4.0',
  method = 'Chemiluminescence CLIA', critical_low = 0.01, critical_high = 100
WHERE id = 1008 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = '%', normal_range = '4.0-5.6 (below 5.7 = normal)',
  method = 'HPLC', critical_low = 3.0, critical_high = 15.0
WHERE id = 1009 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'cells/hpf', normal_range = 'Protein: None | RBC < 3 | WBC < 5',
  method = 'Microscopy + Dipstick', critical_low = NULL, critical_high = NULL
WHERE id = 1010 AND tenant_id = 100;

UPDATE lab_test_catalog SET
  unit = 'ng/mL', normal_range = '< 0.04 (normal)',
  method = 'High Sensitivity CLIA', critical_low = NULL, critical_high = 2.0
WHERE id = 1024 AND tenant_id = 100;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. DOCTORS — update with BMDC numbers and qualifications
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE doctors SET bmdc_reg_no = 'A-52341', qualifications = 'MBBS, MD (Medicine)', visiting_hours = 'Sun-Thu 9am-1pm' WHERE id = 101 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-61892', qualifications = 'MBBS, FCPS (Gynae)', visiting_hours = 'Sun,Tue,Thu 10am-2pm' WHERE id = 102 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-48123', qualifications = 'MBBS, MD (Cardiology), FCPS', visiting_hours = 'Mon,Wed,Fri 9am-1pm' WHERE id = 103 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-70245', qualifications = 'MBBS, DCH, FCPS (Paediatrics)', visiting_hours = 'Sun-Mon,Tue,Thu 9am-1pm' WHERE id = 104 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-55671', qualifications = 'MBBS, MS (Ortho)', visiting_hours = 'Mon,Wed,Thu 9am-1pm' WHERE id = 105 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-63498', qualifications = 'MBBS, DDV (Dermatology)', visiting_hours = 'Sat,Sun,Tue 4pm-8pm' WHERE id = 106 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-59014', qualifications = 'MBBS, DLO, FCPS (ENT)', visiting_hours = 'Sun,Tue,Thu 9am-1pm' WHERE id = 107 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-71234', qualifications = 'MBBS, DO, FCPS (Ophthalmology)', visiting_hours = 'Mon,Wed,Sat 9am-1pm' WHERE id = 108 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-48901', qualifications = 'MBBS, MD (Nephrology)', visiting_hours = 'Mon,Wed 9am-1pm' WHERE id = 109 AND tenant_id = 100;
UPDATE doctors SET bmdc_reg_no = 'A-66723', qualifications = 'MBBS, MRCPsych (UK), FCPS (Psychiatry)', visiting_hours = 'Tue,Thu 3pm-7pm' WHERE id = 110 AND tenant_id = 100;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. ADDITIONAL INCOME entries (Feb-Mar to show trend on accounting dashboard)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO income (id, date, source, amount, description, tenant_id, created_by, created_at) VALUES
(6015, '2026-02-01', 'consultation', 280000, 'OPD consultations Feb W1',        100, 107, '2026-02-01 18:00:00'),
(6016, '2026-02-01', 'lab',          190000, 'Lab collections Feb W1',          100, 107, '2026-02-01 18:10:00'),
(6017, '2026-02-05', 'consultation', 320000, 'OPD consultations Feb W2',        100, 107, '2026-02-05 18:00:00'),
(6018, '2026-02-05', 'admission',    450000, 'IPD charges — ADM-0001 (6 days)', 100, 107, '2026-02-05 18:10:00'),
(6019, '2026-02-10', 'admission',    400000, 'IPD charges — ADM-0002 & 0003',   100, 107, '2026-02-10 18:00:00'),
(6020, '2026-02-10', 'pharmacy',     120000, 'Pharmacy sales Feb W2',           100, 107, '2026-02-10 18:10:00'),
(6021, '2026-02-15', 'consultation', 380000, 'OPD consultations Feb W3',        100, 107, '2026-02-15 18:00:00'),
(6022, '2026-02-15', 'insurance',    330000, 'Insurance settlement CLM-0001',   100, 107, '2026-02-15 18:20:00'),
(6023, '2026-02-22', 'consultation', 290000, 'OPD consultations Feb W4',        100, 107, '2026-02-22 18:00:00'),
(6024, '2026-02-28', 'lab',          230000, 'Lab collections Feb W4',          100, 107, '2026-02-28 18:00:00'),
(6025, '2026-03-05', 'consultation', 310000, 'OPD consultations Mar W1',        100, 107, '2026-03-05 18:00:00'),
(6026, '2026-03-05', 'pharmacy',     95000,  'Pharmacy sales Mar W1',           100, 107, '2026-03-05 18:10:00'),
(6027, '2026-03-10', 'lab',          175000, 'Lab collections Mar W1',          100, 107, '2026-03-10 18:00:00'),
(6028, '2026-03-10', 'telemedicine', 67500,  'Telemedicine consultations Mar',  100, 107, '2026-03-10 18:10:00');

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. ADDITIONAL EXPENSES (Feb-Mar)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO expenses (id, date, category, amount, description, status, tenant_id, created_by, created_at) VALUES
(7015, '2026-02-28', 'salary',    800000, 'Feb salary — Nurses (10)',              'approved', 100, 107, '2026-02-28 10:00:00'),
(7016, '2026-02-28', 'salary',    240000, 'Feb salary — Lab technicians (3)',      'approved', 100, 107, '2026-02-28 10:10:00'),
(7017, '2026-02-28', 'salary',     80000, 'Feb salary — Pharmacist',              'approved', 100, 107, '2026-02-28 10:20:00'),
(7018, '2026-02-28', 'salary',    120000, 'Feb salary — Reception staff (2)',      'approved', 100, 107, '2026-02-28 10:30:00'),
(7019, '2026-02-07', 'utilities', 120000, 'Electricity bill — Feb',               'approved', 100, 107, '2026-02-07 10:00:00'),
(7020, '2026-02-07', 'utilities',  15000, 'Water bill — Feb',                     'approved', 100, 107, '2026-02-07 10:10:00'),
(7021, '2026-02-01', 'rent',      500000, 'Hospital building rent — Feb',         'approved', 100, 107, '2026-02-01 09:00:00'),
(7022, '2026-02-15', 'medicine',  420000, 'Medicine purchase — Feb (Renata+ACI)', 'approved', 100, 107, '2026-02-15 10:00:00'),
(7023, '2026-03-01', 'rent',      500000, 'Hospital building rent — Mar',         'approved', 100, 107, '2026-03-01 09:00:00'),
(7024, '2026-03-07', 'utilities', 115000, 'Electricity bill — Mar',               'pending',  100, 107, '2026-03-07 10:00:00'),
(7025, '2026-03-07', 'equipment',  75000, 'Ultrasound machine calibration',       'pending',  100, 107, '2026-03-07 10:30:00');

-- ─────────────────────────────────────────────────────────────────────────────

SELECT 'Extended seed applied successfully!' AS status;
SELECT 'Added: doctor schedules, notifications, IPD charges, insurance, telemedicine, stock movements, lab enrichments, income/expense history' AS summary;
