-- Hot-path indexes for patient creation duplicate checks and inbox badge reads.
-- These routes run on common reception/header flows, so they must avoid table scans as data grows.

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_read_user
  ON notifications(tenant_id, is_read, user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created
  ON notifications(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_patients_tenant_mobile_duplicate
  ON patients(tenant_id, mobile, is_duplicate);

CREATE INDEX IF NOT EXISTS idx_patients_tenant_name_dob_gender_duplicate
  ON patients(tenant_id, lower(name), date_of_birth, gender, is_duplicate);

CREATE INDEX IF NOT EXISTS idx_global_patient_identity_phone
  ON global_patient_identity(primary_phone);

CREATE INDEX IF NOT EXISTS idx_global_patient_identity_email
  ON global_patient_identity(primary_email);

CREATE INDEX IF NOT EXISTS idx_global_patient_identity_name_dob
  ON global_patient_identity(lower(primary_name), date_of_birth);
