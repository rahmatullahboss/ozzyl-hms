-- =============================================================================
-- HMS SaaS — Fill missing pharmacy_stock for 12 items that had no GRN
-- These items exist in pharmacy_items but had no pharmacy_stock rows.
-- Simulates a completed GRN #3 (Incepta) + initial stock for remaining items.
-- tenant_id = 100 | created_by = 104
-- All monetary values in INTEGER paisa (1 BDT = 100 paisa)
-- =============================================================================

-- First complete PO #3 (Incepta) so it's consistent
UPDATE pharmacy_purchase_orders SET status = 'complete' WHERE id = 3 AND tenant_id = 100;

-- Update PO #3 received qty (they were pending)
UPDATE pharmacy_po_items SET received_qty = quantity, pending_qty = 0 WHERE po_id = 3 AND tenant_id = 100;

-- GRN for PO #3
INSERT OR IGNORE INTO pharmacy_goods_receipts (id, grn_print_id, po_id, invoice_no, supplier_id, grn_date, subtotal, total_amount, payment_status, tenant_id, created_by) VALUES
(3, 5003, 3, 'IN-INV-2602', 3, '2026-02-18', 3850000, 3850000, 'paid', 100, 104);

-- GRN Items for GRN #3
INSERT OR IGNORE INTO pharmacy_grn_items (id, grn_id, item_id, batch_no, expiry_date, received_qty, item_rate, mrp, cost_price, sale_price, margin, tenant_id, created_by) VALUES
(14, 3, 3,  'IN-B2601', '2027-12-31', 500,  380,  500,  380,  500,  31.58, 100, 104),  -- Amoxicillin
(15, 3, 4,  'IN-B2602', '2027-09-30', 400,  220,  300,  220,  300,  36.36, 100, 104),  -- Omeprazole
(16, 3, 11, 'IN-B2603', '2028-03-31', 500,  260,  350,  260,  350,  34.62, 100, 104);  -- Pantoprazole

-- Additional GRN for remaining 9 items (simulating a 4th PO from Renata)
INSERT OR IGNORE INTO pharmacy_purchase_orders (id, po_no, supplier_id, po_date, status, subtotal, total_amount, remarks, tenant_id, created_by) VALUES
(4, 1004, 4, '2026-02-20', 'complete', 5200000, 5200000, 'February restock — Renata Ltd.', 100, 104);

INSERT OR IGNORE INTO pharmacy_goods_receipts (id, grn_print_id, po_id, invoice_no, supplier_id, grn_date, subtotal, total_amount, payment_status, tenant_id, created_by) VALUES
(4, 5004, 4, 'RN-INV-2601', 4, '2026-02-22', 5200000, 5200000, 'paid', 100, 104);

INSERT OR IGNORE INTO pharmacy_grn_items (id, grn_id, item_id, batch_no, expiry_date, received_qty, item_rate, mrp, cost_price, sale_price, margin, tenant_id, created_by) VALUES
(17, 4, 5,  'RN-B2601', '2028-01-31', 600,  180, 250,  180, 250,  38.89, 100, 104),  -- Metformin
(18, 4, 8,  'RN-B2602', '2027-12-31', 400,  350, 500,  350, 500,  42.86, 100, 104),  -- Losartan
(19, 4, 10, 'RN-B2603', '2027-06-30', 20, 22000,30000,22000,30000, 36.36, 100, 104),  -- Insulin Glargine
(20, 4, 13, 'RN-B2604', '2028-06-30', 500,  120, 180,  120, 180,  50.00, 100, 104),  -- Ibuprofen
(21, 4, 16, 'RN-B2605', '2028-03-31', 400,  80,  120,   80, 120,  50.00, 100, 104),  -- Vitamin D3
(22, 4, 17, 'RN-B2606', '2028-01-31', 500,  200, 300,  200, 300,  50.00, 100, 104),  -- Calcium
(23, 4, 21, 'RN-B2607', '2027-12-31', 200,  250, 350,  250, 350,  40.00, 100, 104),  -- Tramadol
(24, 4, 24, 'RN-B2608', '2028-06-30', 300,  120, 180,  120, 180,  50.00, 100, 104),  -- Spironolactone
(25, 4, 25, 'RN-B2609', '2027-09-30', 150,  300, 400,  300, 400,  33.33, 100, 104);  -- Warfarin

-- PO items for PO #4
INSERT OR IGNORE INTO pharmacy_po_items (id, po_id, item_id, quantity, standard_rate, received_qty, pending_qty, subtotal, total_amount, tenant_id) VALUES
(17, 4, 5,  600,  180, 600, 0, 1080000, 1080000, 100),
(18, 4, 8,  400,  350, 400, 0, 1400000, 1400000, 100),
(19, 4, 10, 20, 22000, 20, 0, 440000,  440000,  100),
(20, 4, 13, 500,  120, 500, 0, 600000,  600000,  100),
(21, 4, 16, 400,   80, 400, 0, 320000,  320000,  100),
(22, 4, 17, 500,  200, 500, 0, 1000000, 1000000, 100),
(23, 4, 21, 200,  250, 200, 0, 500000,  500000,  100),
(24, 4, 24, 300,  120, 300, 0, 360000,  360000,  100),
(25, 4, 25, 150,  300, 150, 0, 450000,  450000,  100);

-- Now insert pharmacy_stock for all 12 missing items (with some sold off)
INSERT OR IGNORE INTO pharmacy_stock (id, item_id, grn_item_id, batch_no, expiry_date, available_qty, mrp, cost_price, sale_price, margin, tenant_id, created_by) VALUES
(14, 3,  14, 'IN-B2601', '2027-12-31', 420,  500,  380,  500,  31.58, 100, 104),  -- Amoxicillin (sold 80)
(15, 4,  15, 'IN-B2602', '2027-09-30', 340,  300,  220,  300,  36.36, 100, 104),  -- Omeprazole (sold 60)
(16, 11, 16, 'IN-B2603', '2028-03-31', 460,  350,  260,  350,  34.62, 100, 104),  -- Pantoprazole (sold 40)
(17, 5,  17, 'RN-B2601', '2028-01-31', 520,  250,  180,  250,  38.89, 100, 104),  -- Metformin (sold 80)
(18, 8,  18, 'RN-B2602', '2027-12-31', 350,  500,  350,  500,  42.86, 100, 104),  -- Losartan (sold 50)
(19, 10, 19, 'RN-B2603', '2027-06-30', 15,  30000,22000,30000, 36.36, 100, 104),  -- Insulin (sold 5)
(20, 13, 20, 'RN-B2604', '2028-06-30', 430,  180,  120,  180,  50.00, 100, 104),  -- Ibuprofen (sold 70)
(21, 16, 21, 'RN-B2605', '2028-03-31', 330,  120,   80,  120,  50.00, 100, 104),  -- Vitamin D3 (sold 70)
(22, 17, 22, 'RN-B2606', '2028-01-31', 420,  300,  200,  300,  50.00, 100, 104),  -- Calcium (sold 80)
(23, 21, 23, 'RN-B2607', '2027-12-31', 170,  350,  250,  350,  40.00, 100, 104),  -- Tramadol (sold 30)
(24, 24, 24, 'RN-B2608', '2028-06-30', 260,  180,  120,  180,  50.00, 100, 104),  -- Spironolactone (sold 40)
(25, 25, 25, 'RN-B2609', '2027-09-30', 110,  400,  300,  400,  33.33, 100, 104);  -- Warfarin (sold 40)

-- Stock transactions for GRN receipts
INSERT OR IGNORE INTO pharmacy_stock_transactions (id, stock_id, item_id, transaction_type, reference_type, reference_id, batch_no, in_qty, out_qty, price, remarks, tenant_id, created_at, created_by) VALUES
(17, 14, 3,  'purchase', 'grn', 3, 'IN-B2601', 500, 0, 380,   'GRN #5003 from Incepta',  100, '2026-02-18 10:00:00', 104),
(18, 15, 4,  'purchase', 'grn', 3, 'IN-B2602', 400, 0, 220,   'GRN #5003 from Incepta',  100, '2026-02-18 10:00:00', 104),
(19, 16, 11, 'purchase', 'grn', 3, 'IN-B2603', 500, 0, 260,   'GRN #5003 from Incepta',  100, '2026-02-18 10:00:00', 104),
(20, 17, 5,  'purchase', 'grn', 4, 'RN-B2601', 600, 0, 180,   'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104),
(21, 18, 8,  'purchase', 'grn', 4, 'RN-B2602', 400, 0, 350,   'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104),
(22, 19, 10, 'purchase', 'grn', 4, 'RN-B2603', 20,  0, 22000, 'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104),
(23, 20, 13, 'purchase', 'grn', 4, 'RN-B2604', 500, 0, 120,   'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104),
(24, 21, 16, 'purchase', 'grn', 4, 'RN-B2605', 400, 0, 80,    'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104),
(25, 22, 17, 'purchase', 'grn', 4, 'RN-B2606', 500, 0, 200,   'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104),
(26, 23, 21, 'purchase', 'grn', 4, 'RN-B2607', 200, 0, 250,   'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104),
(27, 24, 24, 'purchase', 'grn', 4, 'RN-B2608', 300, 0, 120,   'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104),
(28, 25, 25, 'purchase', 'grn', 4, 'RN-B2609', 150, 0, 300,   'GRN #5004 from Renata',   100, '2026-02-22 10:00:00', 104);

SELECT '✅ Stock fill applied — 12 items now have pharmacy_stock rows' AS status;
SELECT 'PO#3 completed, PO#4 added, 12 stock rows + 12 GRN items + 12 txns' AS details;
