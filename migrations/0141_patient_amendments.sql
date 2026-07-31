-- Patient Amendments & Corrections (HIPAA § 164.526)
-- Patients can request amendments to their health records.
-- Providers review and approve/deny with documented reason.

CREATE TABLE IF NOT EXISTS patient_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  -- What record is being amended
  record_type TEXT NOT NULL,            -- 'demographics', 'vitals', 'allergy', 'medication', 'lab_result', 'clinical_note', 'other'
  record_id TEXT,                       -- optional reference to specific record
  -- The amendment details
  field_name TEXT NOT NULL,             -- which field is wrong
  current_value TEXT,                   -- what it currently says
  requested_value TEXT NOT NULL,        -- what patient wants it to say
  reason TEXT NOT NULL,                 -- patient's reason for amendment
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'denied', 'partial'
  reviewer_id TEXT,                     -- staff who reviewed
  reviewer_name TEXT,
  review_note TEXT,                     -- reason for approval/denial
  reviewed_at TEXT,
  -- Audit
  requested_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_amendments_tenant_patient ON patient_amendments(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_amendments_status ON patient_amendments(tenant_id, status);

-- Audit log for all amendment actions (immutable)
CREATE TABLE IF NOT EXISTS patient_amendment_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amendment_id INTEGER NOT NULL REFERENCES patient_amendments(id),
  action TEXT NOT NULL,                 -- 'requested', 'approved', 'denied', 'partial', 'applied'
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,             -- 'patient' or staff role
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_amendment_audit_amendment ON patient_amendment_audit(amendment_id);
