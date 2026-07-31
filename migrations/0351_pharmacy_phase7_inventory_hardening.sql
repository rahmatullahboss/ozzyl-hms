-- Migration: 0351_pharmacy_phase7_inventory_hardening.sql
-- Branch: fix/pharmacy-inventory
-- Description: Adds the canonical stock/invoice repair queue, the stock
-- adjustment approval queue, and the idempotency surface for pharmacy
-- invoice/return/purchase/GRN flows (P0-21..P0-24 + stock adjustment approval).

-- 1. Pending-repair queue for the canonical pharmacy invoice service.
--    When the invoice commit fails mid-flight, the row is queued here so a
--    supervisor can re-run the recovery endpoint and complete the commit.
CREATE TABLE IF NOT EXISTS pharmacy_invoice_repair_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    invoice_no TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'repaired', 'cancelled')),
    repaired_invoice_id INTEGER,
    reviewed_by INTEGER,
    reviewed_at TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_repair_tenant_status
    ON pharmacy_invoice_repair_queue(tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_pharmacy_repair_invoice_no
    ON pharmacy_invoice_repair_queue(tenant_id, invoice_no);

-- 2. Stock adjustment approval queue.
--    Adjustments above the threshold, or any narcotic adjustment, are queued
--    here until a supervisor (or hospital_admin) approves and applies them.
CREATE TABLE IF NOT EXISTS stock_adjustment_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    request_no TEXT NOT NULL,
    stock_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('in', 'out')),
    quantity REAL NOT NULL,
    amount_impact INTEGER NOT NULL DEFAULT 0,
    is_narcotic INTEGER NOT NULL DEFAULT 0,
    remarks TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by INTEGER NOT NULL,
    reviewed_by INTEGER,
    reviewed_at TEXT,
    review_notes TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
    UNIQUE(tenant_id, request_no)
);

CREATE INDEX IF NOT EXISTS idx_stock_adj_approvals_tenant_status
    ON stock_adjustment_approvals(tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_adj_approvals_stock
    ON stock_adjustment_approvals(tenant_id, stock_id);
