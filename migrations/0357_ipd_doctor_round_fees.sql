-- Doctor-specific IPD round fees and billable round events.

ALTER TABLE doctors ADD COLUMN ipd_round_fee INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ipd_doctor_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  rounded_at TEXT NOT NULL,
  doctor_name_snapshot TEXT NOT NULL,
  round_fee_snapshot INTEGER NOT NULL CHECK (round_fee_snapshot > 0),
  entry_source TEXT NOT NULL CHECK (entry_source IN ('nurse_station', 'ipd_billing')),
  entered_by INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  provisional_item_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason TEXT,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (admission_id) REFERENCES admissions(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  FOREIGN KEY (provisional_item_id) REFERENCES billing_provisional_items(id)
);

CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_admission_time
  ON ipd_doctor_rounds(tenant_id, admission_id, rounded_at DESC);

CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_doctor_time
  ON ipd_doctor_rounds(tenant_id, doctor_id, rounded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_provisional_item
  ON ipd_doctor_rounds(tenant_id, provisional_item_id)
  WHERE provisional_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provisional_doctor_round_ref
  ON billing_provisional_items(tenant_id, item_category, reference_id)
  WHERE item_category = 'doctor_round' AND reference_id IS NOT NULL;
