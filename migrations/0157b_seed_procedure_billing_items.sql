-- Seed common procedure billing items for Danphe-style reception workflow
-- Inserts a 'Procedures' department and standard items for all active tenants

INSERT INTO billing_service_departments (department_name, department_code, is_active, tenant_id, created_by)
VALUES
  ('Procedures', 'PROC', 1, 1, 1),
  ('Procedures', 'PROC', 1, 100, 1),
  ('Procedures', 'PROC', 1, 101, 1);

-- Insert procedure items linked to the departments above.
-- We use subqueries to match tenant_id since department ids differ per tenant.

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Suture Removal', 'PROC-001', d.id, 100, 0, 0, 1, 1, 'Suture removal from wound', 1, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Dressing (Small)', 'PROC-002', d.id, 80, 0, 0, 1, 1, 'Small wound dressing', 2, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Dressing (Large)', 'PROC-003', d.id, 150, 0, 0, 1, 1, 'Large wound dressing', 3, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Injection (IM)', 'PROC-004', d.id, 50, 0, 0, 1, 1, 'Intramuscular injection', 4, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Injection (IV)', 'PROC-005', d.id, 100, 0, 0, 1, 1, 'Intravenous injection', 5, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Nebulization', 'PROC-006', d.id, 150, 0, 0, 1, 1, 'Nebulization therapy', 6, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Blood Pressure Check', 'PROC-007', d.id, 30, 0, 0, 1, 1, 'BP measurement', 7, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Blood Sugar (RBS)', 'PROC-008', d.id, 100, 0, 0, 1, 1, 'Random blood sugar test', 8, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'ECG', 'PROC-009', d.id, 200, 0, 0, 1, 1, 'Electrocardiogram', 9, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Oxygen Therapy', 'PROC-010', d.id, 200, 0, 0, 1, 1, 'Oxygen inhalation per hour', 10, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 1;

-- Tenant 100 (demo-hospital)
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Suture Removal', 'PROC-001', d.id, 100, 0, 0, 1, 1, 'Suture removal from wound', 1, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Dressing (Small)', 'PROC-002', d.id, 80, 0, 0, 1, 1, 'Small wound dressing', 2, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Dressing (Large)', 'PROC-003', d.id, 150, 0, 0, 1, 1, 'Large wound dressing', 3, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Injection (IM)', 'PROC-004', d.id, 50, 0, 0, 1, 1, 'Intramuscular injection', 4, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Injection (IV)', 'PROC-005', d.id, 100, 0, 0, 1, 1, 'Intravenous injection', 5, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Nebulization', 'PROC-006', d.id, 150, 0, 0, 1, 1, 'Nebulization therapy', 6, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Blood Pressure Check', 'PROC-007', d.id, 30, 0, 0, 1, 1, 'BP measurement', 7, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Blood Sugar (RBS)', 'PROC-008', d.id, 100, 0, 0, 1, 1, 'Random blood sugar test', 8, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'ECG', 'PROC-009', d.id, 200, 0, 0, 1, 1, 'Electrocardiogram', 9, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Oxygen Therapy', 'PROC-010', d.id, 200, 0, 0, 1, 1, 'Oxygen inhalation per hour', 10, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 100;

-- Tenant 101 (shah-nesar)
INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Suture Removal', 'PROC-001', d.id, 100, 0, 0, 1, 1, 'Suture removal from wound', 1, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Dressing (Small)', 'PROC-002', d.id, 80, 0, 0, 1, 1, 'Small wound dressing', 2, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Dressing (Large)', 'PROC-003', d.id, 150, 0, 0, 1, 1, 'Large wound dressing', 3, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Injection (IM)', 'PROC-004', d.id, 50, 0, 0, 1, 1, 'Intramuscular injection', 4, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Injection (IV)', 'PROC-005', d.id, 100, 0, 0, 1, 1, 'Intravenous injection', 5, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Nebulization', 'PROC-006', d.id, 150, 0, 0, 1, 1, 'Nebulization therapy', 6, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Blood Pressure Check', 'PROC-007', d.id, 30, 0, 0, 1, 1, 'BP measurement', 7, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Blood Sugar (RBS)', 'PROC-008', d.id, 100, 0, 0, 1, 1, 'Random blood sugar test', 8, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'ECG', 'PROC-009', d.id, 200, 0, 0, 1, 1, 'Electrocardiogram', 9, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;

INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
SELECT 'Oxygen Therapy', 'PROC-010', d.id, 200, 0, 0, 1, 1, 'Oxygen inhalation per hour', 10, 1, d.tenant_id, 1 FROM billing_service_departments d WHERE d.department_code = 'PROC' AND d.tenant_id = 101;
