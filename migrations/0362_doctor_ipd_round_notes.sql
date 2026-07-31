-- Widen entry_source to allow doctor-driven round notes from the Doctor Dashboard.
-- Migration 0357 created the table with CHECK (entry_source IN ('nurse_station', 'ipd_billing')).
-- SQLite cannot ALTER a CHECK constraint in place, so we recreate the table
-- with the new constraint while preserving all existing rows.

ALTER TABLE clinical_notes ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cln_notes_idempotency
  ON clinical_notes(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- This trigger belongs to billing_provisional_items but references
-- ipd_doctor_rounds. SQLite validates dependent trigger SQL while replacing
-- the referenced table, so remove it for the rebuild and restore it below.
DROP TRIGGER IF EXISTS trg_doctor_round_provisional_cancel_requires_round;

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS ipd_doctor_rounds_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  rounded_at TEXT NOT NULL,
  doctor_name_snapshot TEXT NOT NULL,
  round_fee_snapshot INTEGER NOT NULL CHECK (round_fee_snapshot > 0),
  entry_source TEXT NOT NULL CHECK (entry_source IN ('nurse_station', 'ipd_billing', 'doctor_dashboard')),
  entered_by INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  provisional_item_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason TEXT,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  clinical_note_id INTEGER,
  clinical_status TEXT NOT NULL DEFAULT 'billing_only'
    CHECK (clinical_status IN ('billing_only', 'documented', 'signed', 'cancelled')),
  signed_by INTEGER,
  signed_at TEXT,
  round_summary TEXT,
  patient_condition TEXT
    CHECK (patient_condition IS NULL OR patient_condition IN ('improving', 'stable', 'deteriorating', 'critical')),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (admission_id) REFERENCES admissions(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  FOREIGN KEY (provisional_item_id) REFERENCES billing_provisional_items(id)
);

INSERT INTO ipd_doctor_rounds_new (
  id, tenant_id, admission_id, patient_id, doctor_id, rounded_at,
  doctor_name_snapshot, round_fee_snapshot, entry_source, entered_by,
  idempotency_key, provisional_item_id, status, cancel_reason, cancelled_by,
  cancelled_at, clinical_note_id, clinical_status, signed_by, signed_at,
  round_summary, patient_condition, created_at, updated_at
)
SELECT
  id, tenant_id, admission_id, patient_id, doctor_id, rounded_at,
  doctor_name_snapshot, round_fee_snapshot, entry_source, entered_by,
  idempotency_key, provisional_item_id, status, cancel_reason, cancelled_by,
  cancelled_at, NULL, 'billing_only', NULL, NULL,
  NULL, NULL, created_at, updated_at
FROM ipd_doctor_rounds;

DROP TABLE ipd_doctor_rounds;
ALTER TABLE ipd_doctor_rounds_new RENAME TO ipd_doctor_rounds;

PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_doctor_round_provisional_cancel_requires_round
BEFORE UPDATE OF bill_status ON billing_provisional_items
WHEN OLD.item_category = 'doctor_round'
  AND NEW.bill_status = 'cancelled'
  AND NOT EXISTS (
    SELECT 1
    FROM ipd_doctor_rounds r
    WHERE r.tenant_id = OLD.tenant_id
      AND r.id = OLD.reference_id
      AND r.status = 'cancelled'
  )
BEGIN
  SELECT RAISE(ABORT, 'Cancel doctor rounds through the doctor-round cancellation workflow');
END;

CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_admission_time
  ON ipd_doctor_rounds(tenant_id, admission_id, rounded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_doctor_time
  ON ipd_doctor_rounds(tenant_id, doctor_id, rounded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_provisional_item
  ON ipd_doctor_rounds(tenant_id, provisional_item_id)
  WHERE provisional_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_clinical_status
  ON ipd_doctor_rounds(tenant_id, admission_id, clinical_status);
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_clinical_note
  ON ipd_doctor_rounds(tenant_id, clinical_note_id)
  WHERE clinical_note_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_clinical_signed
  ON ipd_doctor_rounds(tenant_id, doctor_id, signed_at DESC)
  WHERE signed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_condition
  ON ipd_doctor_rounds(tenant_id, patient_condition)
  WHERE patient_condition IS NOT NULL;
