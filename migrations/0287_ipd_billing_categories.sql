-- ============================================================================
-- 0287 IPD Billing Categories
-- Seeds 8 new billing service departments and 30+ sample service items
-- for IPD billing: OT, Nursing, Pharmacy, Consumables, Ambulance,
-- Blood Bank, Doctor Consultation, and General Services.
-- Uses WHERE NOT EXISTS for idempotency (no UNIQUE constraints on these tables).
-- ============================================================================

-- Departments (tenant_id = 0 = system defaults)
INSERT INTO billing_service_departments (department_name, department_code, tenant_id, is_active)
SELECT 'OT/Operation', 'OT', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM billing_service_departments WHERE department_code = 'OT' AND tenant_id = 0);

INSERT INTO billing_service_departments (department_name, department_code, tenant_id, is_active)
SELECT 'Nursing Charges', 'NURS', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM billing_service_departments WHERE department_code = 'NURS' AND tenant_id = 0);

INSERT INTO billing_service_departments (department_name, department_code, tenant_id, is_active)
SELECT 'Medicine/Pharmacy', 'PHRM', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM billing_service_departments WHERE department_code = 'PHRM' AND tenant_id = 0);

INSERT INTO billing_service_departments (department_name, department_code, tenant_id, is_active)
SELECT 'Consumables', 'CONS', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM billing_service_departments WHERE department_code = 'CONS' AND tenant_id = 0);

INSERT INTO billing_service_departments (department_name, department_code, tenant_id, is_active)
SELECT 'Ambulance', 'AMBU', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM billing_service_departments WHERE department_code = 'AMBU' AND tenant_id = 0);

INSERT INTO billing_service_departments (department_name, department_code, tenant_id, is_active)
SELECT 'Blood Bank', 'BLOODB', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM billing_service_departments WHERE department_code = 'BLOODB' AND tenant_id = 0);

INSERT INTO billing_service_departments (department_name, department_code, tenant_id, is_active)
SELECT 'Doctor Consultation', 'CONSULT', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM billing_service_departments WHERE department_code = 'CONSULT' AND tenant_id = 0);

INSERT INTO billing_service_departments (department_name, department_code, tenant_id, is_active)
SELECT 'General Service', 'SERV', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM billing_service_departments WHERE department_code = 'SERV' AND tenant_id = 0);

-- ─── Service Items ─────────────────────────────────────────────────────────────

-- OT / Operation items
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Major Surgery', 'OT001', d.id, 15000, 0, 1, 1
FROM billing_service_departments d WHERE d.department_code = 'OT' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'OT001' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Minor Surgery', 'OT002', d.id, 5000, 0, 2, 1
FROM billing_service_departments d WHERE d.department_code = 'OT' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'OT002' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'OT Charge per hour', 'OT003', d.id, 2000, 0, 3, 1
FROM billing_service_departments d WHERE d.department_code = 'OT' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'OT003' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Anaesthesia Charge', 'OT004', d.id, 3000, 0, 4, 1
FROM billing_service_departments d WHERE d.department_code = 'OT' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'OT004' AND tenant_id = 0);

-- Nursing items
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Nursing Charge per day', 'NURS001', d.id, 200, 0, 1, 1
FROM billing_service_departments d WHERE d.department_code = 'NURS' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'NURS001' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Special Nursing per day', 'NURS002', d.id, 500, 0, 2, 1
FROM billing_service_departments d WHERE d.department_code = 'NURS' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'NURS002' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'ICU Nursing per day', 'NURS003', d.id, 800, 0, 3, 1
FROM billing_service_departments d WHERE d.department_code = 'NURS' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'NURS003' AND tenant_id = 0);

-- Medicine / Pharmacy items
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'General Medicine', 'PHRM001', d.id, 0, 0, 1, 1
FROM billing_service_departments d WHERE d.department_code = 'PHRM' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'PHRM001' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'IV Fluid', 'PHRM002', d.id, 150, 0, 2, 1
FROM billing_service_departments d WHERE d.department_code = 'PHRM' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'PHRM002' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Injection', 'PHRM003', d.id, 50, 0, 3, 1
FROM billing_service_departments d WHERE d.department_code = 'PHRM' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'PHRM003' AND tenant_id = 0);

-- Consumables items
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Surgical Glove', 'CONS001', d.id, 20, 0, 1, 1
FROM billing_service_departments d WHERE d.department_code = 'CONS' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONS001' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Syringe', 'CONS002', d.id, 15, 0, 2, 1
FROM billing_service_departments d WHERE d.department_code = 'CONS' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONS002' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Bandage', 'CONS003', d.id, 30, 0, 3, 1
FROM billing_service_departments d WHERE d.department_code = 'CONS' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONS003' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Cannula', 'CONS004', d.id, 60, 0, 4, 1
FROM billing_service_departments d WHERE d.department_code = 'CONS' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONS004' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Urinary Catheter', 'CONS005', d.id, 100, 0, 5, 1
FROM billing_service_departments d WHERE d.department_code = 'CONS' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONS005' AND tenant_id = 0);

-- Ambulance items
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Ambulance within city', 'AMBU001', d.id, 1000, 0, 1, 1
FROM billing_service_departments d WHERE d.department_code = 'AMBU' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'AMBU001' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Ambulance outside city', 'AMBU002', d.id, 2500, 0, 2, 1
FROM billing_service_departments d WHERE d.department_code = 'AMBU' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'AMBU002' AND tenant_id = 0);

-- Blood Bank items
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Whole Blood 1 unit', 'BLOODB001', d.id, 1200, 0, 1, 1
FROM billing_service_departments d WHERE d.department_code = 'BLOODB' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'BLOODB001' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Packed RBC 1 unit', 'BLOODB002', d.id, 1500, 0, 2, 1
FROM billing_service_departments d WHERE d.department_code = 'BLOODB' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'BLOODB002' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'FFP 1 unit', 'BLOODB003', d.id, 800, 0, 3, 1
FROM billing_service_departments d WHERE d.department_code = 'BLOODB' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'BLOODB003' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Platelet 1 unit', 'BLOODB004', d.id, 2000, 0, 4, 1
FROM billing_service_departments d WHERE d.department_code = 'BLOODB' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'BLOODB004' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Cross Match', 'BLOODB005', d.id, 300, 0, 5, 1
FROM billing_service_departments d WHERE d.department_code = 'BLOODB' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'BLOODB005' AND tenant_id = 0);

-- Doctor Consultation items
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Consultant Visit', 'CONSULT001', d.id, 500, 0, 1, 1
FROM billing_service_departments d WHERE d.department_code = 'CONSULT' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONSULT001' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Specialist Visit', 'CONSULT002', d.id, 1000, 0, 2, 1
FROM billing_service_departments d WHERE d.department_code = 'CONSULT' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONSULT002' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Professor Visit', 'CONSULT003', d.id, 1500, 0, 3, 1
FROM billing_service_departments d WHERE d.department_code = 'CONSULT' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONSULT003' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Daily Round Visit', 'CONSULT004', d.id, 300, 0, 4, 1
FROM billing_service_departments d WHERE d.department_code = 'CONSULT' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'CONSULT004' AND tenant_id = 0);

-- General Service items
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'ECG', 'SERV001', d.id, 200, 0, 1, 1
FROM billing_service_departments d WHERE d.department_code = 'SERV' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'SERV001' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Nebulization', 'SERV002', d.id, 150, 0, 2, 1
FROM billing_service_departments d WHERE d.department_code = 'SERV' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'SERV002' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Dressing', 'SERV003', d.id, 100, 0, 3, 1
FROM billing_service_departments d WHERE d.department_code = 'SERV' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'SERV003' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Injection administer', 'SERV004', d.id, 30, 0, 4, 1
FROM billing_service_departments d WHERE d.department_code = 'SERV' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'SERV004' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Ryle Tube Insertion', 'SERV005', d.id, 200, 0, 5, 1
FROM billing_service_departments d WHERE d.department_code = 'SERV' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'SERV005' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Urinary Catheterization', 'SERV006', d.id, 250, 0, 6, 1
FROM billing_service_departments d WHERE d.department_code = 'SERV' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'SERV006' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Oxygen per hour', 'SERV007', d.id, 100, 0, 7, 1
FROM billing_service_departments d WHERE d.department_code = 'SERV' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'SERV007' AND tenant_id = 0);

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tenant_id, display_order, is_active)
SELECT 'Physiotherapy Session', 'SERV008', d.id, 500, 0, 8, 1
FROM billing_service_departments d WHERE d.department_code = 'SERV' AND d.tenant_id = 0
AND NOT EXISTS (SELECT 1 FROM billing_service_items WHERE item_code = 'SERV008' AND tenant_id = 0);
