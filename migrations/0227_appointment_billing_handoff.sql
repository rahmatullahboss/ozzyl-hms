-- Appointment billing handoff hardening.
-- Adds durable status/linkage columns used to create pending consultation
-- charges at appointment booking while keeping official invoice/payment/GL
-- posting inside the central billing flow.

ALTER TABLE appointments ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (billing_status IN ('no_charge', 'pending', 'unpaid', 'partial_paid', 'paid', 'due_approved', 'refunded', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_appointments_billing_status
  ON appointments(tenant_id, billing_status);

ALTER TABLE billing_provisional_items ADD COLUMN appointment_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_billing_provisional_appointment
  ON billing_provisional_items(tenant_id, appointment_id, bill_status);
