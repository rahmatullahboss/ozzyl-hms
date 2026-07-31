-- Basic HMS daily-flow support:
-- appointment type fees, discount/free metadata, and duplicate-safe doctor
-- payable rows for appointment fee handoff.

ALTER TABLE appointments ADD COLUMN appointment_type TEXT NOT NULL DEFAULT 'new_patient'
  CHECK (appointment_type IN ('new_patient', 'follow_up', 'report_show', 'free_visit', 'discounted_visit'));
ALTER TABLE appointments ADD COLUMN original_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN final_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN discount_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_type_billing
  ON appointments(tenant_id, appointment_type, billing_status, appt_date);

CREATE TABLE IF NOT EXISTS doctor_appointment_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('new_patient', 'follow_up', 'report_show', 'free_visit', 'discounted_visit')),
  fee INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, doctor_id, appointment_type)
);

CREATE INDEX IF NOT EXISTS idx_doctor_appointment_fees_lookup
  ON doctor_appointment_fees(tenant_id, doctor_id, appointment_type, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_comm_accruals_consultation_bill_unique
  ON doctor_commission_accruals(tenant_id, doctor_id, bill_id)
  WHERE source_type = 'consultation_fee' AND bill_id IS NOT NULL;
