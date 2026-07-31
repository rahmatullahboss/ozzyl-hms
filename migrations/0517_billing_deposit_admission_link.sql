-- Link patient deposit receipts to the IPD admission that received the money.
-- Reporting must not infer financial classification from free-text remarks.
ALTER TABLE billing_deposits
  ADD COLUMN admission_id INTEGER REFERENCES admissions(id);

-- Deterministic historical backfill for admission-created receipts.
UPDATE billing_deposits AS d
SET admission_id = (
  SELECT a.id
  FROM admissions a
  WHERE a.tenant_id = d.tenant_id
    AND a.patient_id = d.patient_id
    AND d.remarks = 'Admission deposit for ' || a.admission_no
  ORDER BY a.id DESC
  LIMIT 1
)
WHERE d.admission_id IS NULL
  AND d.transaction_type = 'deposit'
  AND d.remarks LIKE 'Admission deposit for %';

-- Older IPD/provisional screens wrote generic or empty remarks. Link only deposits
-- whose date falls inside an admission window; reservation deposits remain unlinked.
UPDATE billing_deposits AS d
SET admission_id = (
  SELECT a.id
  FROM admissions a
  WHERE a.tenant_id = d.tenant_id
    AND a.patient_id = d.patient_id
    AND date(d.created_at) >= date(a.admission_date)
    AND date(d.created_at) <= date(COALESCE(a.discharge_date, d.created_at))
  ORDER BY a.id DESC
  LIMIT 1
)
WHERE d.admission_id IS NULL
  AND d.transaction_type = 'deposit'
  AND (
    d.remarks IS NULL
    OR LOWER(d.remarks) LIKE '%ipd%'
    OR LOWER(d.remarks) LIKE '%provisional billing%'
  )
  AND EXISTS (
    SELECT 1
    FROM admissions a
    WHERE a.tenant_id = d.tenant_id
      AND a.patient_id = d.patient_id
      AND date(d.created_at) >= date(a.admission_date)
      AND date(d.created_at) <= date(COALESCE(a.discharge_date, d.created_at))
  );

CREATE INDEX IF NOT EXISTS idx_billing_deposits_admission
  ON billing_deposits(tenant_id, admission_id, transaction_type, created_at);

-- Cross-tenant/patient admission linkage is validated by the deposit write route
-- before insert. The foreign key preserves admission identity, while keeping this
-- migration compatible with the production D1 migration statement parser.
