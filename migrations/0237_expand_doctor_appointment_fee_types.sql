-- Expand doctor appointment fee contexts to match OPD pricing workflows:
-- new patient, old patient, follow-up, report-show, free, discounted, emergency.
-- SQLite cannot ALTER CHECK constraints, so the constrained tables are rebuilt.

PRAGMA foreign_keys=OFF;

CREATE TABLE appointments_new_0237 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appt_no TEXT NOT NULL,
  token_no INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER,
  appt_date TEXT NOT NULL,
  appt_time TEXT,
  visit_type TEXT NOT NULL DEFAULT 'opd'
    CHECK(visit_type IN ('opd', 'followup', 'emergency')),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK(status IN ('scheduled', 'confirmed', 'booked', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show', 'pending_approval')),
  notes TEXT,
  chief_complaint TEXT,
  fee INTEGER NOT NULL DEFAULT 0,
  appointment_type TEXT NOT NULL DEFAULT 'new_patient'
    CHECK(appointment_type IN ('new_patient', 'old_patient', 'follow_up', 'report_show', 'free_visit', 'discounted_visit', 'emergency')),
  original_fee INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  final_fee INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  billing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(billing_status IN ('no_charge', 'pending', 'unpaid', 'partial_paid', 'paid', 'due_approved', 'refunded', 'cancelled')),
  created_by INTEGER,
  tenant_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'scheduled'
    CHECK(source IN ('scheduled', 'walk_in', 'online', 'phone')),
  checked_in_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

INSERT INTO appointments_new_0237 (
  id, appt_no, token_no, patient_id, doctor_id, appt_date, appt_time, visit_type,
  status, notes, chief_complaint, fee, appointment_type, original_fee,
  discount_amount, final_fee, discount_reason, billing_status, created_by,
  tenant_id, source, checked_in_at, created_at, updated_at
)
SELECT
  id,
  appt_no,
  token_no,
  patient_id,
  doctor_id,
  appt_date,
  appt_time,
  CASE WHEN visit_type IN ('opd', 'followup', 'emergency') THEN visit_type ELSE 'opd' END,
  CASE WHEN status IN ('scheduled', 'confirmed', 'booked', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show', 'pending_approval') THEN status ELSE 'scheduled' END,
  notes,
  chief_complaint,
  COALESCE(fee, 0),
  CASE WHEN appointment_type IN ('new_patient', 'old_patient', 'follow_up', 'report_show', 'free_visit', 'discounted_visit', 'emergency') THEN appointment_type ELSE 'new_patient' END,
  COALESCE(original_fee, COALESCE(fee, 0), 0),
  COALESCE(discount_amount, 0),
  COALESCE(final_fee, COALESCE(fee, 0), 0),
  discount_reason,
  CASE WHEN billing_status IN ('no_charge', 'pending', 'unpaid', 'partial_paid', 'paid', 'due_approved', 'refunded', 'cancelled') THEN billing_status ELSE 'pending' END,
  created_by,
  tenant_id,
  CASE WHEN source IN ('scheduled', 'walk_in', 'online', 'phone') THEN source ELSE 'scheduled' END,
  checked_in_at,
  created_at,
  updated_at
FROM appointments;

DROP TABLE appointments;
ALTER TABLE appointments_new_0237 RENAME TO appointments;

CREATE INDEX IF NOT EXISTS idx_appointments_tenant ON appointments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appt_date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_token
  ON appointments(tenant_id, doctor_id, appt_date, token_no);
CREATE INDEX IF NOT EXISTS idx_appointments_billing_status
  ON appointments(tenant_id, billing_status);
CREATE INDEX IF NOT EXISTS idx_appointments_type_billing
  ON appointments(tenant_id, appointment_type, billing_status, appt_date);

CREATE TABLE doctor_appointment_fees_new_0237 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  appointment_type TEXT NOT NULL
    CHECK (appointment_type IN ('new_patient', 'old_patient', 'follow_up', 'report_show', 'free_visit', 'discounted_visit', 'emergency')),
  fee INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, doctor_id, appointment_type)
);

INSERT INTO doctor_appointment_fees_new_0237 (
  id, tenant_id, doctor_id, appointment_type, fee, is_active, notes, created_by, created_at, updated_at
)
SELECT
  id,
  tenant_id,
  doctor_id,
  CASE WHEN appointment_type IN ('new_patient', 'old_patient', 'follow_up', 'report_show', 'free_visit', 'discounted_visit', 'emergency') THEN appointment_type ELSE 'new_patient' END,
  COALESCE(fee, 0),
  COALESCE(is_active, 1),
  notes,
  created_by,
  created_at,
  updated_at
FROM doctor_appointment_fees;

DROP TABLE doctor_appointment_fees;
ALTER TABLE doctor_appointment_fees_new_0237 RENAME TO doctor_appointment_fees;

CREATE INDEX IF NOT EXISTS idx_doctor_appointment_fees_lookup
  ON doctor_appointment_fees(tenant_id, doctor_id, appointment_type, is_active);

DELETE FROM sqlite_sequence WHERE name IN ('appointments', 'doctor_appointment_fees');
INSERT INTO sqlite_sequence(name, seq)
SELECT 'appointments', COALESCE(MAX(id), 0) FROM appointments;
INSERT INTO sqlite_sequence(name, seq)
SELECT 'doctor_appointment_fees', COALESCE(MAX(id), 0) FROM doctor_appointment_fees;

PRAGMA foreign_keys=ON;
