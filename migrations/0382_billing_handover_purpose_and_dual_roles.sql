-- Dual-purpose cash handover work modes.

ALTER TABLE billing_handovers
  ADD COLUMN handover_purpose TEXT DEFAULT 'shift_transfer'
  CHECK (handover_purpose IN ('shift_transfer', 'management_collection'));

UPDATE billing_handovers
SET handover_purpose = 'management_collection'
WHERE handover_type = 'counter'
  AND handover_to IN (
    SELECT id FROM users
    WHERE users.tenant_id = billing_handovers.tenant_id
      AND role IN ('hospital_admin', 'md', 'director', 'accountant')
  );

UPDATE billing_handovers
SET handover_purpose = 'shift_transfer'
WHERE handover_type = 'counter'
  AND (handover_purpose IS NULL OR handover_purpose NOT IN ('shift_transfer', 'management_collection'));

CREATE INDEX IF NOT EXISTS idx_billing_handovers_purpose_status
  ON billing_handovers(tenant_id, handover_purpose, status, created_at);
