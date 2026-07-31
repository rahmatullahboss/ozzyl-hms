-- Migration: 0275_medication_fulfilment_orders.sql
-- Optional hospital dispensing orders separate from immutable clinical prescriptions.

CREATE TABLE IF NOT EXISTS medication_orders (
  id                    TEXT PRIMARY KEY NOT NULL,
  tenant_id             TEXT NOT NULL,
  prescription_id       INTEGER NOT NULL REFERENCES prescriptions(id),
  patient_id            INTEGER NOT NULL REFERENCES patients(id),
  channel               TEXT NOT NULL CHECK (channel IN ('hospital_counter', 'patient_app')),
  provider_type         TEXT NOT NULL CHECK (provider_type IN ('hospital_pharmacy', 'ozzyl_partner')),
  provider_tenant_id    TEXT,
  partner_provider_id   TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled', 'refunded')),
  payment_status        TEXT NOT NULL DEFAULT 'paid'
                        CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'refunded')),
  delivery_status       TEXT NOT NULL DEFAULT 'not_applicable'
                        CHECK (delivery_status IN ('not_applicable', 'pending', 'dispatched', 'delivered', 'cancelled')),
  patient_consent_at    TEXT,
  substitution_consent_at TEXT,
  idempotency_key       TEXT NOT NULL,
  request_hash          TEXT NOT NULL,
  sale_id               INTEGER REFERENCES pharmacy_sales(id),
  created_by            INTEGER NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_medication_orders_prescription
  ON medication_orders(tenant_id, prescription_id, created_at);
CREATE INDEX IF NOT EXISTS idx_medication_orders_patient
  ON medication_orders(tenant_id, patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_medication_orders_provider
  ON medication_orders(tenant_id, provider_type, status);

CREATE TABLE IF NOT EXISTS medication_order_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              TEXT NOT NULL REFERENCES medication_orders(id) ON DELETE CASCADE,
  prescription_item_id  INTEGER NOT NULL REFERENCES prescription_items(id),
  prescribed_name       TEXT NOT NULL,
  prescribed_dosage     TEXT,
  prescribed_frequency  TEXT,
  prescribed_duration   TEXT,
  selected_medicine_id  INTEGER REFERENCES medicines(id),
  selected_name         TEXT NOT NULL,
  selected_generic_name TEXT,
  selected_company      TEXT,
  selected_unit         TEXT,
  requested_quantity    INTEGER NOT NULL CHECK (requested_quantity > 0),
  fulfilled_quantity    INTEGER NOT NULL CHECK (fulfilled_quantity > 0 AND fulfilled_quantity <= requested_quantity),
  unit_price            INTEGER NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  line_total            INTEGER NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  is_alternative        INTEGER NOT NULL DEFAULT 0 CHECK (is_alternative IN (0, 1)),
  equivalence_basis     TEXT,
  patient_confirmed_alternative INTEGER NOT NULL DEFAULT 0
                        CHECK (patient_confirmed_alternative IN (0, 1)),
  created_at            TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(order_id, prescription_item_id)
);

CREATE INDEX IF NOT EXISTS idx_medication_order_items_order
  ON medication_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_medication_order_items_prescription_item
  ON medication_order_items(prescription_item_id);

ALTER TABLE pharmacy_sales ADD COLUMN medication_order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacy_sales_medication_order
  ON pharmacy_sales(tenant_id, medication_order_id)
  WHERE medication_order_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_medication_fulfilment_batch_nonnegative
BEFORE UPDATE OF quantity_available ON medicine_stock_batches
FOR EACH ROW
WHEN NEW.quantity_available < 0
BEGIN
  SELECT RAISE(ABORT, 'medication_fulfilment_stock_negative');
END;

CREATE TRIGGER IF NOT EXISTS trg_medication_fulfilment_medicine_nonnegative
BEFORE UPDATE OF quantity ON medicines
FOR EACH ROW
WHEN NEW.quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'medication_fulfilment_stock_negative');
END;

CREATE TRIGGER IF NOT EXISTS trg_medication_fulfilment_item_overdispense
BEFORE UPDATE OF dispensed_qty ON prescription_items
FOR EACH ROW
WHEN NEW.dispensed_qty < 0 OR NEW.dispensed_qty > NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'medication_fulfilment_overdispense');
END;
