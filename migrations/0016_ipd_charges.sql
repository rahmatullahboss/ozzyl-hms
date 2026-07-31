-- Migration 0016: IPD daily room charges
-- Tracks daily bed charges during admission

CREATE TABLE IF NOT EXISTS ipd_charges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL,
  admission_id    INTEGER NOT NULL,
  patient_id      INTEGER NOT NULL,
  charge_date     TEXT NOT NULL,           -- YYYY-MM-DD
  charge_type     TEXT NOT NULL DEFAULT 'room', -- room | nursing | other
  description     TEXT,
  amount          REAL NOT NULL DEFAULT 0,
  posted_by       INTEGER,                 -- user ID who posted
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ipd_charges_tenant       ON ipd_charges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipd_charges_admission    ON ipd_charges(admission_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipd_charges_date         ON ipd_charges(charge_date, tenant_id);
