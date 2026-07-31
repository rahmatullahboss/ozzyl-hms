-- Marketplace bookings: bridges marketplace booking requests to local tenant appointments
CREATE TABLE marketplace_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_global_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  booking_time TEXT NOT NULL,
  token_number INTEGER,
  fee INTEGER,
  status TEXT NOT NULL DEFAULT 'confirmed',
  local_appointment_id INTEGER,
  cancellation_reason TEXT,
  source TEXT DEFAULT 'marketplace',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_marketplace_bookings_patient ON marketplace_bookings(patient_global_id);
CREATE INDEX idx_marketplace_bookings_doctor ON marketplace_bookings(doctor_id, tenant_id);
CREATE INDEX idx_marketplace_bookings_date ON marketplace_bookings(booking_date);
CREATE INDEX idx_marketplace_bookings_status ON marketplace_bookings(status);
