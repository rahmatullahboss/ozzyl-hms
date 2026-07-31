-- Allow the same global UHID to be linked into multiple hospitals while
-- still preventing duplicate UHID rows inside one tenant.

DROP INDEX IF EXISTS idx_patients_uhid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_uhid_tenant
  ON patients(uhid, tenant_id)
  WHERE uhid IS NOT NULL;
