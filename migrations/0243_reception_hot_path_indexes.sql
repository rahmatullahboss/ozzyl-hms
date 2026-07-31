-- Reception daily-list hot path indexes.
-- These routes are read frequently by reception/admission screens and should
-- filter by tenant/date without scanning full tenant history.

CREATE INDEX IF NOT EXISTS idx_reception_visits_tenant_date_created
  ON visits(tenant_id, visit_date, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reception_visit_services_visit_status
  ON visit_services(visit_id, status);

CREATE INDEX IF NOT EXISTS idx_reception_bills_tenant_visit_latest
  ON bills(tenant_id, visit_id, created_at DESC, id DESC)
  WHERE status IS NULL OR status NOT IN ('cancelled', 'refunded', 'draft');

CREATE INDEX IF NOT EXISTS idx_reception_bills_tenant_visit_latest_all
  ON bills(tenant_id, visit_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reception_appointments_tenant_date_order
  ON appointments(tenant_id, appt_date, created_at DESC, id DESC, token_no DESC);

CREATE INDEX IF NOT EXISTS idx_reception_bpi_appt_billed_latest
  ON billing_provisional_items(tenant_id, appointment_id, id DESC)
  WHERE billed_bill_id IS NOT NULL
    AND COALESCE(is_active, 1) = 1
    AND bill_status IN ('finalized', 'billed');
