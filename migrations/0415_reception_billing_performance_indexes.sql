-- Reception and billing hot-path composite indexes.
-- These align indexes with the tenant-scoped filters used by payment,
-- deposit, appointment queue, pending bill, and visit-service queries.

CREATE INDEX IF NOT EXISTS idx_payments_tenant_bill_receipt
  ON payments(tenant_id, bill_id, receipt_no);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_date_receiver
  ON payments(tenant_id, date, received_by);

CREATE INDEX IF NOT EXISTS idx_billing_deposits_patient_active_type
  ON billing_deposits(tenant_id, patient_id, is_active, transaction_type);

CREATE INDEX IF NOT EXISTS idx_billing_deposits_bill_active_type
  ON billing_deposits(tenant_id, reference_bill_id, is_active, transaction_type);

CREATE INDEX IF NOT EXISTS idx_bills_tenant_status_created
  ON bills(tenant_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_billing_date_status
  ON appointments(tenant_id, billing_status, appt_date, status, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_provisional_appt_status_active
  ON billing_provisional_items(tenant_id, appointment_id, bill_status, is_active);

CREATE INDEX IF NOT EXISTS idx_visit_services_tenant_visit_status_bill
  ON visit_services(tenant_id, visit_id, status, bill_id);

CREATE INDEX IF NOT EXISTS idx_lab_order_items_tenant_order
  ON lab_order_items(tenant_id, lab_order_id, id);
