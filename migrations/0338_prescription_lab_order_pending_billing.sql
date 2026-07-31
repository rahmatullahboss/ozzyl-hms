-- Link prescription-origin lab orders so reception can bill selected pending items.

ALTER TABLE lab_orders ADD COLUMN prescription_id INTEGER REFERENCES prescriptions(id);

ALTER TABLE lab_order_items ADD COLUMN test_name TEXT;

CREATE INDEX IF NOT EXISTS idx_lab_orders_prescription
  ON lab_orders(tenant_id, prescription_id);

CREATE INDEX IF NOT EXISTS idx_lab_order_items_unbilled_lookup
  ON lab_order_items(tenant_id, lab_order_id, status);
