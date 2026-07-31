-- Migration: Pharmacy Module V2 (Full Enhancement)
-- Ozzyl HMS — Adapted from danphe-next migrations 0008, 0013, 0047
-- All monetary columns use INTEGER (paisa = BDT * 100) per project convention
-- Cloudflare D1 (SQLite) Compatible

-- ============================================================
-- MASTER DATA TABLES
-- ============================================================

-- Drug Categories (Tablet, Capsule, Syrup, etc.)
CREATE TABLE IF NOT EXISTS pharmacy_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

-- Generic Drug Names
CREATE TABLE IF NOT EXISTS pharmacy_generics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category_id INTEGER,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (category_id) REFERENCES pharmacy_categories(id)
);

-- Enhanced Suppliers
CREATE TABLE IF NOT EXISTS pharmacy_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_no TEXT,
    address TEXT,
    city TEXT,
    email TEXT,
    pan_no TEXT,
    credit_period INTEGER DEFAULT 0,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

-- Units of Measurement
CREATE TABLE IF NOT EXISTS pharmacy_uom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

-- Packing Types (Strip=10, Box=100, etc.)
CREATE TABLE IF NOT EXISTS pharmacy_packing_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

-- Physical Storage Locations / Racks
CREATE TABLE IF NOT EXISTS pharmacy_racks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rack_no TEXT NOT NULL,
    description TEXT,
    parent_id INTEGER,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (parent_id) REFERENCES pharmacy_racks(id)
);

-- Full Pharmacy Item Master (replaces basic medicines table for new features)
CREATE TABLE IF NOT EXISTS pharmacy_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    item_code TEXT,
    generic_id INTEGER,
    category_id INTEGER,
    uom_id INTEGER,
    packing_type_id INTEGER,
    reorder_level INTEGER DEFAULT 0,
    min_stock_qty INTEGER DEFAULT 0,
    purchase_vat_pct REAL DEFAULT 0,
    sales_vat_pct REAL DEFAULT 0,
    is_vat_applicable INTEGER DEFAULT 0,
    is_narcotic INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (generic_id) REFERENCES pharmacy_generics(id),
    FOREIGN KEY (category_id) REFERENCES pharmacy_categories(id),
    FOREIGN KEY (uom_id) REFERENCES pharmacy_uom(id),
    FOREIGN KEY (packing_type_id) REFERENCES pharmacy_packing_types(id)
);

-- Item to Rack Mapping
CREATE TABLE IF NOT EXISTS pharmacy_item_rack_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    rack_id INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id),
    FOREIGN KEY (rack_id) REFERENCES pharmacy_racks(id)
);

-- ============================================================
-- PURCHASE MANAGEMENT TABLES
-- ============================================================

-- Purchase Order Header
CREATE TABLE IF NOT EXISTS pharmacy_purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_no INTEGER,
    supplier_id INTEGER NOT NULL,
    po_date TEXT,
    status TEXT DEFAULT 'pending',     -- pending, partial, complete, cancelled
    reference_no TEXT,
    subtotal INTEGER DEFAULT 0,        -- paisa
    discount_amount INTEGER DEFAULT 0, -- paisa
    discount_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,      -- paisa
    total_amount INTEGER DEFAULT 0,    -- paisa
    adjustment INTEGER DEFAULT 0,      -- paisa
    delivery_address TEXT,
    delivery_days INTEGER DEFAULT 0,
    delivery_date TEXT,
    remarks TEXT,
    terms_conditions TEXT,
    cancel_remarks TEXT,
    cancelled_by INTEGER,
    cancelled_at TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (supplier_id) REFERENCES pharmacy_suppliers(id)
);

-- Purchase Order Items
CREATE TABLE IF NOT EXISTS pharmacy_po_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    standard_rate INTEGER DEFAULT 0,    -- paisa
    received_qty REAL DEFAULT 0,
    pending_qty REAL DEFAULT 0,
    subtotal INTEGER DEFAULT 0,         -- paisa
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (po_id) REFERENCES pharmacy_purchase_orders(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id)
);

-- Goods Receipt Note Header
CREATE TABLE IF NOT EXISTS pharmacy_goods_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_print_id INTEGER,
    po_id INTEGER,
    invoice_no TEXT,
    supplier_id INTEGER NOT NULL,
    grn_date TEXT NOT NULL,
    supplier_bill_date TEXT,
    subtotal INTEGER DEFAULT 0,          -- paisa
    discount_amount INTEGER DEFAULT 0,   -- paisa
    discount_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,        -- paisa
    vat_pct REAL DEFAULT 0,
    total_amount INTEGER DEFAULT 0,      -- paisa
    adjustment INTEGER DEFAULT 0,        -- paisa
    remarks TEXT,
    payment_status TEXT DEFAULT 'pending', -- pending, partial, paid
    credit_period INTEGER DEFAULT 0,
    is_item_discount_applicable INTEGER DEFAULT 0,
    is_cancelled INTEGER DEFAULT 0,
    cancel_remarks TEXT,
    cancelled_by INTEGER,
    cancelled_at TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (supplier_id) REFERENCES pharmacy_suppliers(id),
    FOREIGN KEY (po_id) REFERENCES pharmacy_purchase_orders(id)
);

-- Goods Receipt Note Items (creates stock entries)
CREATE TABLE IF NOT EXISTS pharmacy_grn_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    batch_no TEXT NOT NULL,
    expiry_date TEXT,
    received_qty REAL NOT NULL,
    free_qty REAL DEFAULT 0,
    rejected_qty REAL DEFAULT 0,
    item_rate INTEGER DEFAULT 0,         -- paisa (cost price per unit)
    mrp INTEGER DEFAULT 0,               -- paisa (maximum retail price)
    discount_pct REAL DEFAULT 0,
    discount_amount INTEGER DEFAULT 0,   -- paisa
    vat_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,        -- paisa
    subtotal INTEGER DEFAULT 0,          -- paisa
    total_amount INTEGER DEFAULT 0,      -- paisa
    cost_price INTEGER DEFAULT 0,        -- paisa (effective cost after discount/VAT)
    sale_price INTEGER DEFAULT 0,        -- paisa (proposed selling price)
    margin REAL DEFAULT 0,               -- percentage
    manufacture_date TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (grn_id) REFERENCES pharmacy_goods_receipts(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id)
);

-- ============================================================
-- STOCK MANAGEMENT TABLES
-- ============================================================

-- Main pharmacy stock (one row per batch per item)
CREATE TABLE IF NOT EXISTS pharmacy_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    grn_item_id INTEGER,
    batch_no TEXT NOT NULL,
    expiry_date TEXT,
    available_qty REAL DEFAULT 0,
    mrp INTEGER DEFAULT 0,          -- paisa
    cost_price INTEGER DEFAULT 0,   -- paisa
    sale_price INTEGER DEFAULT 0,   -- paisa
    margin REAL DEFAULT 0,
    discount_pct REAL DEFAULT 0,
    vat_pct REAL DEFAULT 0,
    packing_qty INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id),
    FOREIGN KEY (grn_item_id) REFERENCES pharmacy_grn_items(id)
);

-- Stock Movement Audit Trail
CREATE TABLE IF NOT EXISTS pharmacy_stock_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL, -- purchase, sale, return_in, return_out, adjustment_in, adjustment_out, transfer_in, transfer_out, write_off
    reference_type TEXT,            -- grn, invoice, return, adjustment, dispatch
    reference_id INTEGER,
    batch_no TEXT,
    expiry_date TEXT,
    in_qty REAL DEFAULT 0,
    out_qty REAL DEFAULT 0,
    price INTEGER DEFAULT 0,        -- paisa (cost or sale price)
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (stock_id) REFERENCES pharmacy_stock(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id)
);

-- ============================================================
-- DISPENSARY / COUNTER MANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS pharmacy_counters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    counter_type TEXT DEFAULT 'sales',  -- sales, dispensary, store
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

-- ============================================================
-- SALES / INVOICE TABLES
-- ============================================================

-- Invoice Header (full sales record)
CREATE TABLE IF NOT EXISTS pharmacy_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no INTEGER,
    patient_id INTEGER,
    patient_visit_id INTEGER,
    counter_id INTEGER,
    is_outdoor_patient INTEGER DEFAULT 1,
    visit_type TEXT,                    -- opd, ipd, emergency
    prescriber_id INTEGER,
    total_qty REAL DEFAULT 0,
    subtotal INTEGER DEFAULT 0,         -- paisa
    discount_amount INTEGER DEFAULT 0,  -- paisa
    discount_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    paid_amount INTEGER DEFAULT 0,      -- paisa
    credit_amount INTEGER DEFAULT 0,    -- paisa
    tender INTEGER DEFAULT 0,           -- paisa
    change_amount INTEGER DEFAULT 0,    -- paisa
    status TEXT DEFAULT 'unpaid',       -- unpaid, paid, credit, return
    payment_mode TEXT DEFAULT 'cash',   -- cash, card, credit, mobile, deposit
    adjustment INTEGER DEFAULT 0,       -- paisa
    deposit_deduct_amount INTEGER DEFAULT 0, -- paisa
    remarks TEXT,
    print_count INTEGER DEFAULT 0,
    is_return INTEGER DEFAULT 0,
    settlement_id INTEGER,
    paid_date TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

-- Invoice Line Items
CREATE TABLE IF NOT EXISTS pharmacy_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    stock_id INTEGER,
    batch_no TEXT,
    expiry_date TEXT,
    quantity REAL NOT NULL,
    mrp INTEGER DEFAULT 0,              -- paisa
    price INTEGER DEFAULT 0,            -- paisa (actual selling price)
    sale_price INTEGER DEFAULT 0,       -- paisa
    discount_pct REAL DEFAULT 0,
    vat_pct REAL DEFAULT 0,
    subtotal INTEGER DEFAULT 0,         -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    item_status TEXT DEFAULT 'paid',    -- paid, credit, returned
    remarks TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (invoice_id) REFERENCES pharmacy_invoices(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id),
    FOREIGN KEY (stock_id) REFERENCES pharmacy_stock(id)
);

-- ============================================================
-- RETURN TABLES
-- ============================================================

-- Return to Supplier
CREATE TABLE IF NOT EXISTS pharmacy_supplier_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_no INTEGER,
    supplier_id INTEGER NOT NULL,
    grn_id INTEGER,
    return_date TEXT NOT NULL,
    subtotal INTEGER DEFAULT 0,         -- paisa
    discount_amount INTEGER DEFAULT 0,  -- paisa
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (supplier_id) REFERENCES pharmacy_suppliers(id),
    FOREIGN KEY (grn_id) REFERENCES pharmacy_goods_receipts(id)
);

-- Return to Supplier Items
CREATE TABLE IF NOT EXISTS pharmacy_supplier_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    stock_id INTEGER,
    batch_no TEXT,
    quantity REAL NOT NULL,
    item_rate INTEGER DEFAULT 0,        -- paisa
    subtotal INTEGER DEFAULT 0,         -- paisa
    discount_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    remarks TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (return_id) REFERENCES pharmacy_supplier_returns(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id),
    FOREIGN KEY (stock_id) REFERENCES pharmacy_stock(id)
);

-- Invoice Return / Credit Note
CREATE TABLE IF NOT EXISTS pharmacy_invoice_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    credit_note_no INTEGER,
    return_date TEXT NOT NULL,
    subtotal INTEGER DEFAULT 0,         -- paisa
    discount_amount INTEGER DEFAULT 0,  -- paisa
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (invoice_id) REFERENCES pharmacy_invoices(id)
);

-- Invoice Return Items
CREATE TABLE IF NOT EXISTS pharmacy_invoice_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL,
    invoice_item_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    stock_id INTEGER,
    batch_no TEXT,
    quantity REAL NOT NULL,
    price INTEGER DEFAULT 0,            -- paisa
    subtotal INTEGER DEFAULT 0,         -- paisa
    discount_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    remarks TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (return_id) REFERENCES pharmacy_invoice_returns(id),
    FOREIGN KEY (invoice_item_id) REFERENCES pharmacy_invoice_items(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id),
    FOREIGN KEY (stock_id) REFERENCES pharmacy_stock(id)
);

-- ============================================================
-- FINANCIAL TABLES
-- ============================================================

-- Patient Pharmacy Deposits
CREATE TABLE IF NOT EXISTS pharmacy_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    deposit_type TEXT DEFAULT 'deposit', -- deposit, return_deposit
    amount INTEGER NOT NULL,            -- paisa
    payment_mode TEXT DEFAULT 'cash',
    remarks TEXT,
    receipt_no INTEGER,
    print_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

-- Credit Settlements
CREATE TABLE IF NOT EXISTS pharmacy_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    settlement_date TEXT NOT NULL,
    total_amount INTEGER DEFAULT 0,     -- paisa (total credit due)
    paid_amount INTEGER DEFAULT 0,      -- paisa
    refund_amount INTEGER DEFAULT 0,    -- paisa
    deposit_deducted INTEGER DEFAULT 0, -- paisa
    payment_mode TEXT DEFAULT 'cash',
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

-- ============================================================
-- PROVISIONAL INVOICE TABLES (IP Patients — not yet finalized)
-- ============================================================

CREATE TABLE IF NOT EXISTS pharmacy_provisional_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    patient_visit_id INTEGER,
    counter_id INTEGER,
    prescriber_id INTEGER,
    visit_type TEXT,                    -- inpatient, outpatient
    total_qty REAL DEFAULT 0,
    subtotal INTEGER DEFAULT 0,         -- paisa
    discount_amount INTEGER DEFAULT 0,  -- paisa
    discount_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    remarks TEXT,
    status TEXT DEFAULT 'provisional',  -- provisional, finalized, cancelled
    is_active INTEGER DEFAULT 1,
    is_cancelled INTEGER DEFAULT 0,
    cancelled_by INTEGER,
    cancelled_at TEXT,
    cancel_remarks TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

CREATE TABLE IF NOT EXISTS pharmacy_provisional_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provisional_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    stock_id INTEGER,
    batch_no TEXT,
    expiry_date TEXT,
    quantity REAL NOT NULL,
    free_qty REAL DEFAULT 0,
    mrp INTEGER DEFAULT 0,              -- paisa
    price INTEGER DEFAULT 0,            -- paisa
    sale_price INTEGER DEFAULT 0,       -- paisa
    subtotal INTEGER DEFAULT 0,         -- paisa
    discount_pct REAL DEFAULT 0,
    discount_amount INTEGER DEFAULT 0,  -- paisa
    vat_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    item_status TEXT DEFAULT 'provisional', -- provisional, finalized, cancelled, returned
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (provisional_id) REFERENCES pharmacy_provisional_invoices(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id),
    FOREIGN KEY (stock_id) REFERENCES pharmacy_stock(id)
);

-- Provisional Return Items
CREATE TABLE IF NOT EXISTS pharmacy_provisional_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provisional_item_id INTEGER NOT NULL,
    provisional_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    patient_visit_id INTEGER,
    item_id INTEGER NOT NULL,
    batch_no TEXT,
    expiry_date TEXT,
    sale_price INTEGER DEFAULT 0,       -- paisa
    quantity REAL NOT NULL,
    subtotal INTEGER DEFAULT 0,         -- paisa
    discount_pct REAL DEFAULT 0,
    discount_amount INTEGER DEFAULT 0,  -- paisa
    vat_pct REAL DEFAULT 0,
    vat_amount INTEGER DEFAULT 0,       -- paisa
    total_amount INTEGER DEFAULT 0,     -- paisa
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (provisional_item_id) REFERENCES pharmacy_provisional_items(id),
    FOREIGN KEY (provisional_id) REFERENCES pharmacy_provisional_invoices(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id)
);

-- ============================================================
-- PRESCRIPTION TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS pharmacy_prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    patient_visit_id INTEGER,
    prescriber_id INTEGER,
    prescriber_name TEXT,
    prescription_date TEXT DEFAULT (datetime('now')),
    notes TEXT,
    status TEXT DEFAULT 'pending',      -- pending, dispensed, partial, cancelled
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

CREATE TABLE IF NOT EXISTS pharmacy_prescription_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prescription_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    item_name TEXT,
    generic_name TEXT,
    dosage TEXT,
    frequency TEXT,
    duration TEXT,
    quantity REAL NOT NULL,
    dispensed_qty REAL DEFAULT 0,
    route TEXT,                         -- oral, IV, IM, topical, subcut
    instructions TEXT,
    status TEXT DEFAULT 'pending',      -- pending, dispensed, partial, cancelled
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (prescription_id) REFERENCES pharmacy_prescriptions(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id)
);

-- ============================================================
-- COMPLIANCE TABLES
-- ============================================================

-- Narcotic / Controlled Substance Records
CREATE TABLE IF NOT EXISTS pharmacy_narcotic_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    invoice_id INTEGER,
    patient_id INTEGER,
    batch_no TEXT,
    quantity REAL,
    buyer_name TEXT,
    doctor_name TEXT,
    nmc_number TEXT,
    is_controlled_substance INTEGER DEFAULT 1,
    remarks TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id),
    FOREIGN KEY (invoice_id) REFERENCES pharmacy_invoices(id)
);

-- Stock Write-Offs
CREATE TABLE IF NOT EXISTS pharmacy_write_offs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    write_off_date TEXT NOT NULL,
    total_amount INTEGER DEFAULT 0,     -- paisa
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

CREATE TABLE IF NOT EXISTS pharmacy_write_off_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    write_off_id INTEGER NOT NULL,
    stock_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    batch_no TEXT,
    quantity REAL NOT NULL,
    item_rate INTEGER DEFAULT 0,        -- paisa
    subtotal INTEGER DEFAULT 0,         -- paisa
    remarks TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (write_off_id) REFERENCES pharmacy_write_offs(id),
    FOREIGN KEY (stock_id) REFERENCES pharmacy_stock(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id)
);

-- ============================================================
-- WARD SUPPLY / REQUISITION & DISPATCH (from 0047_pharmacy)
-- ============================================================

CREATE TABLE IF NOT EXISTS pharmacy_requisitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requisition_no INTEGER NOT NULL,
    requesting_store TEXT,
    requesting_user_id INTEGER,
    requisition_date TEXT NOT NULL,
    status TEXT DEFAULT 'pending',      -- pending, partial, complete, cancelled
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    cancelled_by INTEGER,
    cancelled_at TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER
);

CREATE TABLE IF NOT EXISTS pharmacy_requisition_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requisition_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    requested_qty REAL NOT NULL,
    pending_qty REAL NOT NULL,
    item_status TEXT DEFAULT 'active',  -- active, cancelled
    remarks TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (requisition_id) REFERENCES pharmacy_requisitions(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id)
);

CREATE TABLE IF NOT EXISTS pharmacy_dispatches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispatch_no INTEGER NOT NULL,
    requisition_id INTEGER,
    source_store TEXT,
    target_store TEXT,
    dispatch_date TEXT NOT NULL,
    received_by TEXT,
    remarks TEXT,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (requisition_id) REFERENCES pharmacy_requisitions(id)
);

CREATE TABLE IF NOT EXISTS pharmacy_dispatch_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispatch_id INTEGER NOT NULL,
    requisition_item_id INTEGER,
    item_id INTEGER NOT NULL,
    stock_id INTEGER,
    batch_no TEXT NOT NULL,
    expiry_date TEXT,
    dispatched_qty REAL NOT NULL,
    cost_price INTEGER NOT NULL,        -- paisa (transfer price)
    sale_price INTEGER NOT NULL,        -- paisa
    remarks TEXT,
    tenant_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (dispatch_id) REFERENCES pharmacy_dispatches(id),
    FOREIGN KEY (requisition_item_id) REFERENCES pharmacy_requisition_items(id),
    FOREIGN KEY (item_id) REFERENCES pharmacy_items(id),
    FOREIGN KEY (stock_id) REFERENCES pharmacy_stock(id)
);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================

-- Categories & Generics
CREATE INDEX IF NOT EXISTS idx_pharm_generics_category ON pharmacy_generics(category_id);
CREATE INDEX IF NOT EXISTS idx_pharm_generics_tenant ON pharmacy_generics(tenant_id);

-- Items
CREATE INDEX IF NOT EXISTS idx_pharm_items_generic ON pharmacy_items(generic_id);
CREATE INDEX IF NOT EXISTS idx_pharm_items_category ON pharmacy_items(category_id);
CREATE INDEX IF NOT EXISTS idx_pharm_items_name ON pharmacy_items(name);
CREATE INDEX IF NOT EXISTS idx_pharm_items_tenant ON pharmacy_items(tenant_id);

-- Suppliers
CREATE INDEX IF NOT EXISTS idx_pharm_suppliers_tenant ON pharmacy_suppliers(tenant_id);

-- Purchase Orders
CREATE INDEX IF NOT EXISTS idx_pharm_po_supplier ON pharmacy_purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pharm_po_status ON pharmacy_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_pharm_po_date ON pharmacy_purchase_orders(po_date);
CREATE INDEX IF NOT EXISTS idx_pharm_po_tenant ON pharmacy_purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_po_items_po ON pharmacy_po_items(po_id);
CREATE INDEX IF NOT EXISTS idx_pharm_po_items_item ON pharmacy_po_items(item_id);

-- Goods Receipts
CREATE INDEX IF NOT EXISTS idx_pharm_grn_supplier ON pharmacy_goods_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pharm_grn_po ON pharmacy_goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_pharm_grn_date ON pharmacy_goods_receipts(grn_date);
CREATE INDEX IF NOT EXISTS idx_pharm_grn_tenant ON pharmacy_goods_receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_grn_items_grn ON pharmacy_grn_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_pharm_grn_items_item ON pharmacy_grn_items(item_id);

-- Stock
CREATE INDEX IF NOT EXISTS idx_pharm_stock_item ON pharmacy_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_pharm_stock_expiry ON pharmacy_stock(expiry_date);
CREATE INDEX IF NOT EXISTS idx_pharm_stock_batch ON pharmacy_stock(batch_no);
CREATE INDEX IF NOT EXISTS idx_pharm_stock_tenant ON pharmacy_stock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_stock_tx_stock ON pharmacy_stock_transactions(stock_id);
CREATE INDEX IF NOT EXISTS idx_pharm_stock_tx_type ON pharmacy_stock_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_pharm_stock_tx_tenant ON pharmacy_stock_transactions(tenant_id);

-- Invoices
CREATE INDEX IF NOT EXISTS idx_pharm_invoice_patient ON pharmacy_invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_pharm_invoice_status ON pharmacy_invoices(status);
CREATE INDEX IF NOT EXISTS idx_pharm_invoice_date ON pharmacy_invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_pharm_invoice_tenant ON pharmacy_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_invoice_items_invoice ON pharmacy_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pharm_invoice_items_item ON pharmacy_invoice_items(item_id);

-- Returns
CREATE INDEX IF NOT EXISTS idx_pharm_sup_return_supplier ON pharmacy_supplier_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pharm_sup_return_tenant ON pharmacy_supplier_returns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_inv_return_invoice ON pharmacy_invoice_returns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pharm_inv_return_tenant ON pharmacy_invoice_returns(tenant_id);

-- Financial
CREATE INDEX IF NOT EXISTS idx_pharm_deposit_patient ON pharmacy_deposits(patient_id);
CREATE INDEX IF NOT EXISTS idx_pharm_deposit_tenant ON pharmacy_deposits(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_settlement_patient ON pharmacy_settlements(patient_id);
CREATE INDEX IF NOT EXISTS idx_pharm_settlement_tenant ON pharmacy_settlements(tenant_id);

-- Provisional
CREATE INDEX IF NOT EXISTS idx_pharm_prov_patient ON pharmacy_provisional_invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_pharm_prov_status ON pharmacy_provisional_invoices(status);
CREATE INDEX IF NOT EXISTS idx_pharm_prov_tenant ON pharmacy_provisional_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_prov_items_prov ON pharmacy_provisional_items(provisional_id);

-- Prescriptions
CREATE INDEX IF NOT EXISTS idx_pharm_rx_patient ON pharmacy_prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_pharm_rx_status ON pharmacy_prescriptions(status);
CREATE INDEX IF NOT EXISTS idx_pharm_rx_tenant ON pharmacy_prescriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_rx_items_rx ON pharmacy_prescription_items(prescription_id);

-- Narcotics
CREATE INDEX IF NOT EXISTS idx_pharm_narcotic_item ON pharmacy_narcotic_records(item_id);
CREATE INDEX IF NOT EXISTS idx_pharm_narcotic_tenant ON pharmacy_narcotic_records(tenant_id);

-- Requisitions
CREATE INDEX IF NOT EXISTS idx_pharm_req_status ON pharmacy_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_pharm_req_tenant ON pharmacy_requisitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pharm_dispatch_req ON pharmacy_dispatches(requisition_id);
CREATE INDEX IF NOT EXISTS idx_pharm_dispatch_tenant ON pharmacy_dispatches(tenant_id);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default UOM (seeded for all tenants to pick from global; 
-- Note: tenant_id=0 used as system default — routes should return these for any tenant)
-- Actual per-tenant UOM will be created via API

-- Default packing types, categories, UOM are seeded per tenant via the API
-- after tenant registration, not in migrations (to avoid tenant_id issues)
