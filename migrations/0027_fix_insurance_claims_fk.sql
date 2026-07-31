-- =============================================================================
-- HMS Migration 0027: Fix insurance_claims broken FK reference
-- Problem: bill_id REFERENCES billing(id) — but actual table is `bills`
-- Fix: Recreate table with correct FK
-- Applied: 2026-03-14
-- =============================================================================

-- 1. Copy existing data (if any) to temp
CREATE TABLE IF NOT EXISTS _insurance_claims_backup AS SELECT * FROM insurance_claims;

-- 2. Drop old table + indexes
DROP INDEX IF EXISTS idx_insurance_claims_patient;
DROP INDEX IF EXISTS idx_insurance_claims_status;
DROP INDEX IF EXISTS idx_insurance_claims_bill;
DROP INDEX IF EXISTS idx_insurance_claims_no;
DROP TABLE IF EXISTS insurance_claims;

-- 3. Recreate with correct FK → bills(id)
CREATE TABLE insurance_claims (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL,
  claim_no         TEXT    NOT NULL,
  patient_id       INTEGER NOT NULL,
  policy_id        INTEGER REFERENCES insurance_policies(id) ON DELETE SET NULL,
  bill_id          INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  diagnosis        TEXT,
  icd10_code       TEXT,
  bill_amount      INTEGER NOT NULL,
  claimed_amount   INTEGER NOT NULL,
  approved_amount  INTEGER,
  rejection_reason TEXT,
  status           TEXT    NOT NULL DEFAULT 'submitted'
                   CHECK(status IN ('submitted','under_review','approved','rejected','settled')),
  submitted_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at      TEXT,
  settled_at       TEXT,
  reviewer_notes   TEXT,
  created_by       INTEGER,
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 4. Restore data from backup
INSERT INTO insurance_claims SELECT * FROM _insurance_claims_backup;

-- 5. Recreate indexes
CREATE INDEX idx_insurance_claims_patient ON insurance_claims(tenant_id, patient_id);
CREATE INDEX idx_insurance_claims_status  ON insurance_claims(tenant_id, status);
CREATE INDEX idx_insurance_claims_bill    ON insurance_claims(tenant_id, bill_id);
CREATE UNIQUE INDEX idx_insurance_claims_no ON insurance_claims(tenant_id, claim_no);

-- 6. Drop backup
DROP TABLE _insurance_claims_backup;
