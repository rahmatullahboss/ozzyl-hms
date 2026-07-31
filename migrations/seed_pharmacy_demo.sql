-- =============================================================================
-- HMS SaaS — Pharmacy Module Seed for Demo Hospital
-- Hospital: "City Care General Hospital" | tenant_id = 100
-- Pharmacist: user_id = 104 (Kamal Hossain)
--
-- Run locally:
--   npx wrangler d1 execute DB --local --file=migrations/seed_pharmacy_demo.sql
-- Run remote:
--   npx wrangler d1 execute DB --remote --file=migrations/seed_pharmacy_demo.sql
--
-- All monetary values in INTEGER paisa (1 BDT = 100 paisa)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CATEGORIES (drug dosage forms)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_categories (id, name, description, is_active, tenant_id, created_by) VALUES
(1, 'Tablet',       'Solid oral dosage - compressed tablet',             1, 100, 104),
(2, 'Capsule',      'Solid oral dosage - gelatin capsule',               1, 100, 104),
(3, 'Syrup',        'Liquid oral dosage',                                1, 100, 104),
(4, 'Injection',    'Parenteral dosage - IV/IM/SC',                      1, 100, 104),
(5, 'Ointment',     'Topical semi-solid dosage',                         1, 100, 104),
(6, 'Drop',         'Eye/Ear/Nasal drops',                               1, 100, 104),
(7, 'Inhaler',      'Metered dose inhaler / DPI',                        1, 100, 104),
(8, 'Suppository',  'Rectal/Vaginal solid dosage',                       1, 100, 104),
(9, 'Cream',        'Topical semi-solid emulsion',                       1, 100, 104),
(10,'Suspension',   'Liquid oral - insoluble particles',                 1, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GENERICS (common drug generics in Bangladesh)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_generics (id, name, category_id, description, is_active, tenant_id, created_by) VALUES
(1,  'Paracetamol',          1, 'Analgesic / Antipyretic',             1, 100, 104),
(2,  'Amoxicillin',          2, 'Penicillin-type antibiotic',          1, 100, 104),
(3,  'Cefixime',             2, '3rd gen cephalosporin',               1, 100, 104),
(4,  'Azithromycin',         1, 'Macrolide antibiotic',                1, 100, 104),
(5,  'Omeprazole',           2, 'Proton pump inhibitor',               1, 100, 104),
(6,  'Metformin',            1, 'Biguanide antidiabetic',              1, 100, 104),
(7,  'Amlodipine',           1, 'Calcium channel blocker',             1, 100, 104),
(8,  'Losartan',             1, 'ARB antihypertensive',                1, 100, 104),
(9,  'Atorvastatin',         1, 'HMG-CoA reductase inhibitor',         1, 100, 104),
(10, 'Diclofenac Sodium',    1, 'NSAID analgesic',                     1, 100, 104),
(11, 'Ciprofloxacin',        1, 'Fluoroquinolone antibiotic',          1, 100, 104),
(12, 'Metronidazole',        1, 'Nitroimidazole antibiotic',           1, 100, 104),
(13, 'Salbutamol',           7, 'Beta-2 agonist bronchodilator',       1, 100, 104),
(14, 'Insulin Glargine',     4, 'Long-acting insulin analogue',        1, 100, 104),
(15, 'Folic Acid',           1, 'Vitamin B9 supplement',               1, 100, 104),
(16, 'Calcium Carbonate',    1, 'Mineral supplement',                  1, 100, 104),
(17, 'Pantoprazole',         1, 'Proton pump inhibitor',               1, 100, 104),
(18, 'Ranitidine',           1, 'H2 receptor antagonist',              1, 100, 104),
(19, 'Warfarin Sodium',      1, 'Anticoagulant',                      1, 100, 104),
(20, 'Dexamethasone',        1, 'Corticosteroid',                     1, 100, 104),
(21, 'Furosemide',           1, 'Loop diuretic',                       1, 100, 104),
(22, 'Ibuprofen',            1, 'NSAID analgesic',                     1, 100, 104),
(23, 'Colecalciferol',       2, 'Vitamin D3',                          1, 100, 104),
(24, 'Tramadol HCl',         2, 'Opioid analgesic',                    1, 100, 104),
(25, 'Spironolactone',       1, 'K+ sparing diuretic',                 1, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. UOM (Units of Measurement)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_uom (id, name, description, is_active, tenant_id, created_by) VALUES
(1, 'Piece',   'Individual unit (tablet, capsule)',    1, 100, 104),
(2, 'Bottle',  'Liquid bottle (60ml/100ml/200ml)',     1, 100, 104),
(3, 'Vial',    'Injectable vial',                     1, 100, 104),
(4, 'Tube',    'Ointment/Cream tube',                 1, 100, 104),
(5, 'Canister','Inhaler canister',                     1, 100, 104),
(6, 'Strip',   'Strip of tablets/capsules',            1, 100, 104),
(7, 'Box',     'Box packaging',                        1, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PACKING TYPES
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_packing_types (id, name, quantity, is_active, tenant_id, created_by) VALUES
(1, 'Strip of 10',  10,  1, 100, 104),
(2, 'Strip of 14',  14,  1, 100, 104),
(3, 'Box of 30',    30,  1, 100, 104),
(4, 'Box of 100',   100, 1, 100, 104),
(5, 'Bottle',       1,   1, 100, 104),
(6, 'Vial',         1,   1, 100, 104),
(7, 'Canister',     1,   1, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RACKS (storage locations)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_racks (id, rack_no, description, parent_id, is_active, tenant_id, created_by) VALUES
(1, 'R-01', 'Main Shelf A — Analgesics & Antibiotics',  NULL, 1, 100, 104),
(2, 'R-02', 'Main Shelf B — Cardiac & Diabetic',        NULL, 1, 100, 104),
(3, 'R-03', 'Main Shelf C — GI & Respiratory',          NULL, 1, 100, 104),
(4, 'R-04', 'Cold Storage — Insulin & Injectables',     NULL, 1, 100, 104),
(5, 'R-05', 'Topical & External Use',                   NULL, 1, 100, 104),
(6, 'R-01-A', 'Sub-Shelf A1 — Paracetamol',             1,   1, 100, 104),
(7, 'R-01-B', 'Sub-Shelf A2 — Antibiotics',             1,   1, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SUPPLIERS (enhanced pharmacy suppliers)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_suppliers (id, name, contact_no, address, city, email, pan_no, credit_period, is_active, tenant_id, created_by) VALUES
(1, 'Square Pharmaceuticals Ltd.',  '01712000001', 'Pabna Sadar, Pabna',           'Pabna',  'order@squarepharma.com',  'SQ-12345',  30, 1, 100, 104),
(2, 'Beximco Pharmaceuticals Ltd.', '01712000002', 'Tongi Industrial Area, Gazipur','Gazipur','sales@beximco.com',       'BX-67890',  30, 1, 100, 104),
(3, 'Incepta Pharmaceuticals Ltd.', '01712000003', 'Dhamrai, Savar',               'Dhaka',  'dist@incepta.com',        'IN-11223',  15, 1, 100, 104),
(4, 'Renata Ltd.',                  '01712000004', 'Mirpur, Dhaka',                'Dhaka',  'supply@renata.com',       'RN-44556',  30, 1, 100, 104),
(5, 'ACI Pharmaceuticals',         '01712000005', 'Narayanganj',                  'Dhaka',  'pharma@aci-bd.com',       'AC-78901',  15, 1, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. PHARMACY ITEMS (25 common medicines matching seed_demo.sql medicines)
--    Prices in paisa. e.g. MRP ৳1.00 = 100 paisa
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_items (id, name, item_code, generic_id, category_id, uom_id, packing_type_id, reorder_level, min_stock_qty, sales_vat_pct, is_active, tenant_id, created_by) VALUES
(1,  'Napa 500mg',            'MED-001', 1,  1, 1, 1, 100, 50,  0, 1, 100, 104),
(2,  'Cefixime 200mg',        'MED-002', 3,  2, 1, 1, 50,  20,  0, 1, 100, 104),
(3,  'Amoxicillin 500mg',     'MED-003', 2,  2, 1, 1, 80,  30,  0, 1, 100, 104),
(4,  'Omeprazole 20mg',       'MED-004', 5,  2, 1, 2, 100, 40,  0, 1, 100, 104),
(5,  'Metformin 500mg',       'MED-005', 6,  1, 1, 1, 150, 60,  0, 1, 100, 104),
(6,  'Atorvastatin 10mg',     'MED-006', 9,  1, 1, 1, 50,  20,  0, 1, 100, 104),
(7,  'Amlodipine 5mg',        'MED-007', 7,  1, 1, 1, 80,  35,  0, 1, 100, 104),
(8,  'Losartan 50mg',         'MED-008', 8,  1, 1, 1, 60,  25,  0, 1, 100, 104),
(9,  'Azithromycin 500mg',    'MED-009', 4,  1, 1, 1, 30,  15,  0, 1, 100, 104),
(10, 'Insulin Glargine',      'MED-010', 14, 4, 3, 6,  8,   5,  0, 1, 100, 104),
(11, 'Pantoprazole 40mg',     'MED-011', 17, 1, 1, 1, 100, 40,  0, 1, 100, 104),
(12, 'Metronidazole 400mg',   'MED-012', 12, 1, 1, 1, 120, 50,  0, 1, 100, 104),
(13, 'Ibuprofen 400mg',       'MED-013', 22, 1, 1, 1, 100, 40,  0, 1, 100, 104),
(14, 'Salbutamol Inhaler',    'MED-014', 13, 7, 5, 7, 10,   5,  0, 1, 100, 104),
(15, 'Folic Acid 5mg',        'MED-015', 15, 1, 1, 1, 200, 80,  0, 1, 100, 104),
(16, 'Vitamin D3 1000IU',     'MED-016', 23, 2, 1, 1, 150, 60,  0, 1, 100, 104),
(17, 'Calcium 500mg',         'MED-017', 16, 1, 1, 1, 120, 50,  0, 1, 100, 104),
(18, 'Ranitidine 150mg',      'MED-018', 18, 1, 1, 1, 100, 40,  0, 1, 100, 104),
(19, 'Diclofenac 50mg',       'MED-019', 10, 1, 1, 1, 150, 60,  0, 1, 100, 104),
(20, 'Ciprofloxacin 500mg',   'MED-020', 11, 1, 1, 1, 50,  20,  0, 1, 100, 104),
(21, 'Tramadol 50mg',         'MED-021', 24, 2, 1, 1, 25,  10,  0, 1, 100, 104),
(22, 'Dexamethasone 4mg',     'MED-022', 20, 1, 1, 1, 80,  30,  0, 1, 100, 104),
(23, 'Furosemide 40mg',       'MED-023', 21, 1, 1, 1, 80,  35,  0, 1, 100, 104),
(24, 'Spironolactone 25mg',   'MED-024', 25, 1, 1, 1, 50,  20,  0, 1, 100, 104),
(25, 'Warfarin 5mg',          'MED-025', 19, 1, 1, 1, 25,  10,  0, 1, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ITEM-RACK MAPPING
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_item_rack_map (id, item_id, rack_id, tenant_id) VALUES
(1,  1,  6, 100),  -- Napa → R-01-A
(2,  2,  7, 100),  -- Cefixime → R-01-B
(3,  3,  7, 100),  -- Amoxicillin → R-01-B
(4,  4,  3, 100),  -- Omeprazole → R-03
(5,  5,  2, 100),  -- Metformin → R-02
(6,  6,  2, 100),  -- Atorvastatin → R-02
(7,  7,  2, 100),  -- Amlodipine → R-02
(8,  8,  2, 100),  -- Losartan → R-02
(9,  9,  7, 100),  -- Azithromycin → R-01-B
(10, 10, 4, 100),  -- Insulin → R-04 (cold storage)
(11, 14, 3, 100),  -- Salbutamol Inhaler → R-03
(12, 25, 2, 100);  -- Warfarin → R-02

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. COUNTERS
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_counters (id, name, counter_type, is_active, tenant_id, created_by) VALUES
(1, 'OPD Counter',       'sales',      1, 100, 104),
(2, 'IPD Dispensary',     'dispensary', 1, 100, 104),
(3, 'Emergency Counter', 'sales',      1, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PURCHASE ORDERS (3 POs from different suppliers)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_purchase_orders (id, po_no, supplier_id, po_date, status, subtotal, total_amount, remarks, tenant_id, created_by) VALUES
(1, 1001, 1, '2026-01-05', 'complete', 11500000, 11500000, 'Initial stock for pharmacy opening — Square Pharma',   100, 104),
(2, 1002, 2, '2026-01-06', 'complete', 6180000,  6180000,  'Initial stock — Beximco products',                    100, 104),
(3, 1003, 3, '2026-02-15', 'pending',  3850000,  3850000,  'February restock order — Incepta',                    100, 104);

-- PO Items for PO #1 (Square)
INSERT OR IGNORE INTO pharmacy_po_items (id, po_id, item_id, quantity, standard_rate, received_qty, pending_qty, subtotal, total_amount, tenant_id) VALUES
(1, 1, 1,  2000, 70,    2000, 0, 1400000,  1400000,  100),  -- Napa 500mg × 2000
(2, 1, 2,  500,  600,   500,  0, 3000000,  3000000,  100),  -- Cefixime × 500
(3, 1, 9,  300,  900,   300,  0, 2700000,  2700000,  100),  -- Azithromycin × 300
(4, 1, 6,  400,  450,   400,  0, 1800000,  1800000,  100),  -- Atorvastatin × 400
(5, 1, 20, 300,  520,   300,  0, 1560000,  1560000,  100),  -- Ciprofloxacin × 300
(6, 1, 15, 1000, 60,    1000, 0, 600000,   600000,   100),  -- Folic Acid × 1000
(7, 1, 19, 500,  88,    500,  0, 440000,   440000,   100);  -- Diclofenac × 500

-- PO Items for PO #2 (Beximco)
INSERT OR IGNORE INTO pharmacy_po_items (id, po_id, item_id, quantity, standard_rate, received_qty, pending_qty, subtotal, total_amount, tenant_id) VALUES
(8,  2, 7,  500,  300,   500,  0, 1500000,  1500000,  100),  -- Amlodipine × 500
(9,  2, 12, 800,  150,   800,  0, 1200000,  1200000,  100),  -- Metronidazole × 800
(10, 2, 23, 500,  110,   500,  0, 550000,   550000,   100),  -- Furosemide × 500
(11, 2, 18, 600,  110,   600,  0, 660000,   660000,   100),  -- Ranitidine × 600
(12, 2, 14, 30,   18000, 30,   0, 5400000,  5400000,  100),  -- Salbutamol Inh × 30
(13, 2, 22, 500,  150,   500,  0, 750000,   750000,   100);  -- Dexamethasone × 500

-- PO Items for PO #3 (Incepta — pending)
INSERT OR IGNORE INTO pharmacy_po_items (id, po_id, item_id, quantity, standard_rate, received_qty, pending_qty, subtotal, total_amount, tenant_id) VALUES
(14, 3, 3,  500,  380,  0, 500, 1900000,  1900000,  100),  -- Amoxicillin × 500
(15, 3, 4,  400,  220,  0, 400, 880000,   880000,   100),  -- Omeprazole × 400
(16, 3, 11, 500,  260,  0, 500, 1300000,  1300000,  100);  -- Pantoprazole × 500

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. GOODS RECEIPTS (GRN for completed POs)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_goods_receipts (id, grn_print_id, po_id, invoice_no, supplier_id, grn_date, subtotal, total_amount, payment_status, tenant_id, created_by) VALUES
(1, 5001, 1, 'SQ-INV-2601', 1, '2026-01-07', 11500000, 11500000, 'paid',    100, 104),
(2, 5002, 2, 'BX-INV-2601', 2, '2026-01-08', 6180000,  6180000,  'partial', 100, 104);

-- GRN Items for GRN #1 (Square)
INSERT OR IGNORE INTO pharmacy_grn_items (id, grn_id, item_id, batch_no, expiry_date, received_qty, item_rate, mrp, cost_price, sale_price, margin, tenant_id, created_by) VALUES
(1, 1, 1,  'SQ-B2601', '2027-06-30', 2000, 70,   100,   70,   100,   42.86, 100, 104),
(2, 1, 2,  'SQ-B2602', '2027-09-30', 500,  600,  800,   600,  800,   33.33, 100, 104),
(3, 1, 9,  'SQ-B2603', '2027-12-31', 300,  900,  1200,  900,  1200,  33.33, 100, 104),
(4, 1, 6,  'SQ-B2604', '2028-01-31', 400,  450,  600,   450,  600,   33.33, 100, 104),
(5, 1, 20, 'SQ-B2605', '2027-06-30', 300,  520,  700,   520,  700,   34.62, 100, 104),
(6, 1, 15, 'SQ-B2606', '2028-06-30', 1000, 60,   80,    60,   80,    33.33, 100, 104),
(7, 1, 19, 'SQ-B2607', '2027-12-31', 500,  88,   120,   88,   120,   36.36, 100, 104);

-- GRN Items for GRN #2 (Beximco)
INSERT OR IGNORE INTO pharmacy_grn_items (id, grn_id, item_id, batch_no, expiry_date, received_qty, item_rate, mrp, cost_price, sale_price, margin, tenant_id, created_by) VALUES
(8,  2, 7,  'BX-B2601', '2027-12-31', 500,  300,   400,   300,  400,   33.33, 100, 104),
(9,  2, 12, 'BX-B2602', '2027-09-30', 800,  150,   200,   150,  200,   33.33, 100, 104),
(10, 2, 23, 'BX-B2603', '2027-06-30', 500,  110,   150,   110,  150,   36.36, 100, 104),
(11, 2, 18, 'BX-B2604', '2027-06-30', 600,  110,   150,   110,  150,   36.36, 100, 104),
(12, 2, 14, 'BX-B2605', '2027-09-30', 30,   18000, 25000, 18000,25000, 38.89, 100, 104),
(13, 2, 22, 'BX-B2606', '2028-03-31', 500,  150,   200,   150,  200,   33.33, 100, 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. PHARMACY STOCK (from GRN items, with some sales deducted)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_stock (id, item_id, grn_item_id, batch_no, expiry_date, available_qty, mrp, cost_price, sale_price, margin, tenant_id, created_by) VALUES
(1,  1,  1,  'SQ-B2601', '2027-06-30', 1480, 100,   70,   100,   42.86, 100, 104),  -- Napa (sold 520)
(2,  2,  2,  'SQ-B2602', '2027-09-30', 380,  800,   600,  800,   33.33, 100, 104),  -- Cefixime (sold 120)
(3,  9,  3,  'SQ-B2603', '2027-12-31', 250,  1200,  900,  1200,  33.33, 100, 104),  -- Azithromycin (sold 50)
(4,  6,  4,  'SQ-B2604', '2028-01-31', 340,  600,   450,  600,   33.33, 100, 104),  -- Atorvastatin (sold 60)
(5,  20, 5,  'SQ-B2605', '2027-06-30', 260,  700,   520,  700,   34.62, 100, 104),  -- Ciprofloxacin (sold 40)
(6,  15, 6,  'SQ-B2606', '2028-06-30', 820,  80,    60,   80,    33.33, 100, 104),  -- Folic Acid (sold 180)
(7,  19, 7,  'SQ-B2607', '2027-12-31', 410,  120,   88,   120,   36.36, 100, 104),  -- Diclofenac (sold 90)
(8,  7,  8,  'BX-B2601', '2027-12-31', 420,  400,   300,  400,   33.33, 100, 104),  -- Amlodipine (sold 80)
(9,  12, 9,  'BX-B2602', '2027-09-30', 710,  200,   150,  200,   33.33, 100, 104),  -- Metronidazole (sold 90)
(10, 23, 10, 'BX-B2603', '2027-06-30', 450,  150,   110,  150,   36.36, 100, 104),  -- Furosemide (sold 50)
(11, 18, 11, 'BX-B2604', '2027-06-30', 530,  150,   110,  150,   36.36, 100, 104),  -- Ranitidine (sold 70)
(12, 14, 12, 'BX-B2605', '2027-09-30', 22,   25000, 18000,25000, 38.89, 100, 104),  -- Salbutamol Inh (sold 8)
(13, 22, 13, 'BX-B2606', '2028-03-31', 440,  200,   150,  200,   33.33, 100, 104);  -- Dexamethasone (sold 60)

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. PHARMACY INVOICES (10 recent sales invoices)
--     Realistic OPD sales to demo patients
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_invoices (id, invoice_no, patient_id, counter_id, is_outdoor_patient, visit_type, prescriber_id, total_qty, subtotal, discount_amount, total_amount, paid_amount, status, payment_mode, tenant_id, created_at, created_by) VALUES
(1, 2001, 1001, 1, 1, 'opd', 101, 21, 40200,   0,     40200,   40200,   'paid', 'cash',   100, '2026-01-15 10:30:00', 104),
(2, 2002, 1002, 1, 1, 'opd', 102, 30, 33600,   0,     33600,   33600,   'paid', 'cash',   100, '2026-01-15 11:00:00', 104),
(3, 2003, 1003, 1, 1, 'opd', 103, 10, 14400,   0,     14400,   14400,   'paid', 'cash',   100, '2026-01-17 09:30:00', 104),
(4, 2004, 1005, 1, 1, 'opd', 105, 14, 12360,   0,     12360,   12360,   'paid', 'cash',   100, '2026-01-18 10:00:00', 104),
(5, 2005, 1009, 1, 1, 'opd', 109, 14, 13800,   0,     13800,   13800,   'paid', 'cash',   100, '2026-01-20 10:30:00', 104),
(6, 2006, 1011, 1, 1, 'opd', 101, 60, 48000,   2000,  46000,   46000,   'paid', 'cash',   100, '2026-01-22 09:30:00', 104),
(7, 2007, 1013, 1, 1, 'opd', 101, 40, 24400,   0,     24400,   24400,   'paid', 'cash',   100, '2026-01-24 10:00:00', 104),
(8, 2008, 1016, 1, 1, 'opd', 103, 90, 66600,   3000,  63600,   63600,   'paid', 'card',   100, '2026-01-26 09:00:00', 104),
(9, 2009, 1017, 1, 1, 'opd', 101, 15, 15000,   0,     15000,   15000,   'paid', 'cash',   100, '2026-01-28 10:30:00', 104),
(10,2010, 1020, 1, 1, 'opd', 103, 90, 74400,   0,     74400,   50000,   'credit','cash',  100, '2026-02-01 09:00:00', 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. INVOICE LINE ITEMS
-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice 1: P-001 (Fever/Typhoid) — Napa, Cefixime, Omeprazole
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(1, 1, 1,  1, 'SQ-B2601', 15, 100,  100,  100,  15000, 15000, 100, 104),   -- Napa ×15
(2, 1, 2,  2, 'SQ-B2602', 3,  800,  800,  800,  24000, 24000, 100, 104),   -- Cefixime ×3 (strip)
(3, 1, 4,  NULL, NULL,     3,  400,  400,  400,  1200,  1200,  100, 104);   -- Omeprazole from old stock

-- Invoice 2: P-002 (ANC) — Folic Acid, Calcium
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(4, 2, 15, 6, 'SQ-B2606', 90, 80,  80,  80,  7200,  7200,  100, 104),    -- Folic Acid ×90
(5, 2, 17, NULL, NULL,     90, 300, 300, 300, 27000, 27000, 100, 104);    -- Calcium not in v2 stock

-- Invoice 3: P-003 (Chest pain) — Atorvastatin, Amlodipine
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(6, 3, 6,  4, 'SQ-B2604', 10, 600, 600, 600,  6000,  6000,  100, 104),   -- Atorvastatin ×10
(7, 3, 7,  8, 'BX-B2601', 10, 400, 400, 400,  4000,  4000,  100, 104);   -- Amlodipine ×10 (1 strip)

-- Invoice 4: P-005 (Knee pain) — Diclofenac, Omeprazole
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(8, 4, 19, 7, 'SQ-B2607', 10, 120, 120, 120, 1200,  1200,  100, 104),   -- Diclofenac ×10
(9, 4, 4,  NULL, NULL,      4, 300, 300, 300, 1200,  1200,  100, 104);   -- Omeprazole from old

-- Invoice 5: P-009 (AKI) — Furosemide, Amlodipine
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(10, 5, 23, 10, 'BX-B2603', 10, 150, 150, 150, 1500,  1500,  100, 104),  -- Furosemide ×10
(11, 5, 7,  8,  'BX-B2601', 4,  400, 400, 400, 1600,  1600,  100, 104);  -- Amlodipine ×4

-- Invoice 6: P-011 (Diabetes) — Metformin, Atorvastatin
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(12, 6, 5,  NULL, NULL,     60, 200, 200, 200, 12000, 12000, 100, 104),  -- Metformin ×60
(13, 6, 6,  4,  'SQ-B2604', 30, 600, 600, 600, 18000, 18000, 100, 104); -- Atorvastatin ×30

-- Invoice 7: P-013 (Typhoid) — Cefixime, Napa, Omeprazole
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(14, 7, 2,  2, 'SQ-B2602', 10, 800, 800, 800,  8000,  8000,  100, 104),  -- Cefixime ×10
(15, 7, 1,  1, 'SQ-B2601', 15, 100, 100, 100,  1500,  1500,  100, 104),  -- Napa ×15
(16, 7, 4,  NULL, NULL,     15, 300, 300, 300,  4500,  4500,  100, 104);  -- Omeprazole ×15

-- Invoice 8: P-016 (HTN) — Amlodipine, Losartan, Atorvastatin
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(17, 8, 7,  8, 'BX-B2601', 30, 400, 400, 400, 12000, 12000, 100, 104),  -- Amlodipine ×30
(18, 8, 8,  NULL, NULL,     30, 500, 500, 500, 15000, 15000, 100, 104),  -- Losartan ×30
(19, 8, 6,  4, 'SQ-B2604', 30, 600, 600, 600, 18000, 18000, 100, 104);  -- Atorvastatin ×30

-- Invoice 9: P-017 (Dengue) — Napa only
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(20, 9, 1,  1, 'SQ-B2601', 15, 100, 100, 100, 1500, 1500, 100, 104);   -- Napa ×15

-- Invoice 10: P-020 (Post-MI) — Warfarin, Atorvastatin, Amlodipine
INSERT OR IGNORE INTO pharmacy_invoice_items (id, invoice_id, item_id, stock_id, batch_no, quantity, mrp, price, sale_price, subtotal, total_amount, tenant_id, created_by) VALUES
(21, 10, 25, NULL, NULL,     90, 400, 400, 400, 36000, 36000, 100, 104),  -- Warfarin ×90
(22, 10, 6,  4, 'SQ-B2604', 90, 600, 600, 600, 54000, 54000, 100, 104),  -- Atorvastatin ×90 (3 mo)
(23, 10, 7,  8, 'BX-B2601', 90, 400, 400, 400, 36000, 36000, 100, 104);  -- Amlodipine ×90

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. PATIENT DEPOSITS (3 deposits)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_deposits (id, patient_id, deposit_type, amount, payment_mode, remarks, receipt_no, tenant_id, created_at, created_by) VALUES
(1, 1020, 'deposit', 100000, 'cash',   'Advance deposit for long-term cardiac medication', 3001, 100, '2026-01-29 09:00:00', 104),
(2, 1009, 'deposit', 50000,  'cash',   'Deposit for kidney medication',                     3002, 100, '2026-01-20 09:00:00', 104),
(3, 1020, 'return_deposit', 25000, 'cash', 'Partial refund — medication adjusted',           3003, 100, '2026-02-10 10:00:00', 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. STOCK TRANSACTIONS (audit trail for GRN receipts + major sales)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO pharmacy_stock_transactions (id, stock_id, item_id, transaction_type, reference_type, reference_id, batch_no, in_qty, out_qty, price, remarks, tenant_id, created_at, created_by) VALUES
-- GRN #1 stock-in
(1,  1,  1,  'purchase', 'grn', 1, 'SQ-B2601', 2000, 0,  70,    'GRN #5001 from Square',   100, '2026-01-07 10:00:00', 104),
(2,  2,  2,  'purchase', 'grn', 1, 'SQ-B2602', 500,  0,  600,   'GRN #5001 from Square',   100, '2026-01-07 10:00:00', 104),
(3,  3,  9,  'purchase', 'grn', 1, 'SQ-B2603', 300,  0,  900,   'GRN #5001 from Square',   100, '2026-01-07 10:00:00', 104),
(4,  4,  6,  'purchase', 'grn', 1, 'SQ-B2604', 400,  0,  450,   'GRN #5001 from Square',   100, '2026-01-07 10:00:00', 104),
(5,  5,  20, 'purchase', 'grn', 1, 'SQ-B2605', 300,  0,  520,   'GRN #5001 from Square',   100, '2026-01-07 10:00:00', 104),
(6,  6,  15, 'purchase', 'grn', 1, 'SQ-B2606', 1000, 0,  60,    'GRN #5001 from Square',   100, '2026-01-07 10:00:00', 104),
(7,  7,  19, 'purchase', 'grn', 1, 'SQ-B2607', 500,  0,  88,    'GRN #5001 from Square',   100, '2026-01-07 10:00:00', 104),
-- GRN #2 stock-in
(8,  8,  7,  'purchase', 'grn', 2, 'BX-B2601', 500,  0,  300,   'GRN #5002 from Beximco',  100, '2026-01-08 10:00:00', 104),
(9,  9,  12, 'purchase', 'grn', 2, 'BX-B2602', 800,  0,  150,   'GRN #5002 from Beximco',  100, '2026-01-08 10:00:00', 104),
(10, 10, 23, 'purchase', 'grn', 2, 'BX-B2603', 500,  0,  110,   'GRN #5002 from Beximco',  100, '2026-01-08 10:00:00', 104),
(11, 11, 18, 'purchase', 'grn', 2, 'BX-B2604', 600,  0,  110,   'GRN #5002 from Beximco',  100, '2026-01-08 10:00:00', 104),
(12, 12, 14, 'purchase', 'grn', 2, 'BX-B2605', 30,   0,  18000, 'GRN #5002 from Beximco',  100, '2026-01-08 10:00:00', 104),
(13, 13, 22, 'purchase', 'grn', 2, 'BX-B2606', 500,  0,  150,   'GRN #5002 from Beximco',  100, '2026-01-08 10:00:00', 104),
-- Sample sale transactions
(14, 1,  1,  'sale', 'invoice', 1, 'SQ-B2601', 0, 15, 100,  'Invoice #2001 — Napa',       100, '2026-01-15 10:30:00', 104),
(15, 2,  2,  'sale', 'invoice', 1, 'SQ-B2602', 0, 3,  800,  'Invoice #2001 — Cefixime',   100, '2026-01-15 10:30:00', 104),
(16, 6,  15, 'sale', 'invoice', 2, 'SQ-B2606', 0, 90, 80,   'Invoice #2002 — Folic Acid', 100, '2026-01-15 11:00:00', 104);

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE!
-- ─────────────────────────────────────────────────────────────────────────────
SELECT '✅ Pharmacy seed applied successfully!' AS status;
SELECT 'Categories: 10 | Generics: 25 | Suppliers: 5 | Items: 25' AS master_data;
SELECT 'POs: 3 | GRNs: 2 | Stock Entries: 13 | Invoices: 10' AS transactions;
SELECT 'Deposits: 3 | Stock Transactions: 16 | Counters: 3' AS financial;
