-- Migration: 0380_expand_approval_request_types.sql
-- Expand approval_requests.type to cover the admin Approval Center tabs and
-- newer financial/cash workflows. SQLite/D1 cannot alter CHECK constraints in
-- place, so rebuild the table when an older constrained table exists.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS approval_requests_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'bill_edit',
    'bill_cancel',
    'discount',
    'refund',
    'payment_void',
    'cash_handover',
    'expense',
    'stock_adjustment',
    'doctor_payout',
    'manual_adjustment',
    'credit_note'
  )),
  entity_id INTEGER NOT NULL,
  entity_no TEXT,
  requested_by INTEGER NOT NULL,
  request_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

INSERT OR IGNORE INTO approval_requests_new (
  id, tenant_id, type, entity_id, entity_no, requested_by, request_data,
  status, reviewed_by, reviewed_at, review_notes, created_at
)
SELECT
  id,
  tenant_id,
  CASE type
    WHEN 'bill_cancellation' THEN 'bill_cancel'
    WHEN 'discount_approval' THEN 'discount'
    ELSE type
  END AS type,
  entity_id,
  entity_no,
  requested_by,
  request_data,
  status,
  reviewed_by,
  reviewed_at,
  review_notes,
  created_at
FROM approval_requests
WHERE type IN (
  'bill_edit',
  'bill_cancel',
  'bill_cancellation',
  'discount',
  'discount_approval',
  'refund',
  'payment_void',
  'cash_handover',
  'expense',
  'stock_adjustment',
  'doctor_payout',
  'manual_adjustment',
  'credit_note'
);

DROP TABLE approval_requests;
ALTER TABLE approval_requests_new RENAME TO approval_requests;

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant
  ON approval_requests(tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_type_status
  ON approval_requests(tenant_id, type, status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_entity
  ON approval_requests(tenant_id, type, entity_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status_created
  ON approval_requests(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status_type_created
  ON approval_requests(tenant_id, status, type, created_at DESC);

PRAGMA foreign_keys=on;
