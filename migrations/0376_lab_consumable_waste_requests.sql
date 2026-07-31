-- Migration: 0376_lab_consumable_waste_requests.sql
-- Purpose: Add approval workflow for lab consumable wastage/write-off.

CREATE TABLE IF NOT EXISTS lab_consumable_waste_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id       INTEGER NOT NULL,
  consumable_id  INTEGER NOT NULL,
  quantity       INTEGER NOT NULL CHECK(quantity > 0),
  reason         TEXT    NOT NULL CHECK(reason IN ('expired','broken','qc_failed','spillage','temperature_breach','other')),
  remarks        TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  requested_by   INTEGER NOT NULL,
  requested_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_by    INTEGER,
  reviewed_at    DATETIME,
  review_remarks TEXT,
  tenant_id      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lab_consumable_waste_status
  ON lab_consumable_waste_requests(tenant_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_lab_consumable_waste_stock
  ON lab_consumable_waste_requests(tenant_id, stock_id);
