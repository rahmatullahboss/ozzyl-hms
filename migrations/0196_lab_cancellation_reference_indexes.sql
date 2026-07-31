-- Item-level lab billing/cancellation lookup indexes.
CREATE INDEX IF NOT EXISTS idx_invoice_items_test_reference
  ON invoice_items(tenant_id, item_category, reference_id);

CREATE INDEX IF NOT EXISTS idx_visit_services_reference
  ON visit_services(tenant_id, reference_type, reference_id);
