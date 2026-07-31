-- Migration 0017: Insurance Policies & Claims
-- Supports Bangladesh insurance providers (MetLife BD, Green Delta, Pragati Life, BRAC Saajan, etc.)

-- Insurance policies linked to a patient
CREATE TABLE IF NOT EXISTS insurance_policies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         INTEGER NOT NULL,
  patient_id        INTEGER NOT NULL,
  provider_name     TEXT    NOT NULL,       -- e.g. "MetLife Insurance BD"
  policy_no         TEXT    NOT NULL,       -- policy number from insurer
  policy_type       TEXT    NOT NULL DEFAULT 'individual',  -- individual | group | government
  coverage_limit    INTEGER NOT NULL DEFAULT 0,             -- in paisa (0 = unlimited/unknown)
  valid_from        TEXT,                                   -- ISO date
  valid_to          TEXT,                                   -- ISO date (NULL = lifetime)
  status            TEXT    NOT NULL DEFAULT 'active',      -- active | expired | cancelled
  notes             TEXT,
  created_by        INTEGER,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insurance_policies_patient ON insurance_policies(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_status  ON insurance_policies(tenant_id, status);

-- Insurance claims linked to a bill and a policy
CREATE TABLE IF NOT EXISTS insurance_claims (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL,
  claim_no         TEXT    NOT NULL,                        -- e.g. CLM-00001 (auto-generated)
  patient_id       INTEGER NOT NULL,
  policy_id        INTEGER REFERENCES insurance_policies(id) ON DELETE SET NULL,
  bill_id          INTEGER REFERENCES billing(id) ON DELETE SET NULL,
  diagnosis        TEXT,
  icd10_code       TEXT,                                    -- ICD-10 code for formal claims
  bill_amount      INTEGER NOT NULL,                        -- paisa — total bill
  claimed_amount   INTEGER NOT NULL,                        -- paisa — amount being claimed
  approved_amount  INTEGER,                                 -- paisa — NULL until decision
  rejection_reason TEXT,                                    -- filled when rejected
  status           TEXT    NOT NULL DEFAULT 'submitted',    -- submitted | under_review | approved | rejected | settled
  submitted_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at      TEXT,
  settled_at       TEXT,
  reviewer_notes   TEXT,
  created_by       INTEGER,
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insurance_claims_patient ON insurance_claims(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_status  ON insurance_claims(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_bill    ON insurance_claims(tenant_id, bill_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_claims_no ON insurance_claims(tenant_id, claim_no);
