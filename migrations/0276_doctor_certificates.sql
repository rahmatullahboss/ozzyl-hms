CREATE TABLE IF NOT EXISTS doctor_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  certificate_no TEXT NOT NULL,
  certificate_type TEXT NOT NULL CHECK (certificate_type IN ('medical', 'fitness', 'sick_leave', 'work_rest')),
  issue_date TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  recommendation TEXT NOT NULL,
  rest_days INTEGER,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('final', 'cancelled')),
  cancellation_reason TEXT,
  cancelled_at TEXT,
  cancelled_by INTEGER,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, certificate_no),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_certificates_patient
  ON doctor_certificates(tenant_id, patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_doctor_certificates_doctor
  ON doctor_certificates(tenant_id, doctor_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_doctor_certificates_no_rewrite
BEFORE UPDATE ON doctor_certificates
WHEN NOT (
  OLD.status = 'final'
  AND NEW.status = 'cancelled'
  AND NEW.cancellation_reason IS NOT NULL
  AND length(trim(NEW.cancellation_reason)) > 0
  AND NEW.cancelled_at IS NOT NULL
  AND NEW.cancelled_by IS NOT NULL
  AND NEW.tenant_id IS OLD.tenant_id
  AND NEW.patient_id IS OLD.patient_id
  AND NEW.doctor_id IS OLD.doctor_id
  AND NEW.certificate_no IS OLD.certificate_no
  AND NEW.certificate_type IS OLD.certificate_type
  AND NEW.issue_date IS OLD.issue_date
  AND NEW.valid_from IS OLD.valid_from
  AND NEW.valid_until IS OLD.valid_until
  AND NEW.recommendation IS OLD.recommendation
  AND NEW.rest_days IS OLD.rest_days
  AND NEW.purpose IS OLD.purpose
  AND NEW.created_by IS OLD.created_by
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'Issued certificate records cannot be rewritten');
END;

CREATE TRIGGER IF NOT EXISTS trg_doctor_certificates_no_delete
BEFORE DELETE ON doctor_certificates
BEGIN
  SELECT RAISE(ABORT, 'Certificate records cannot be deleted');
END;
