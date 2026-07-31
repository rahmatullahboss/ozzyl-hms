-- Token Reservations: Reserve specific token number ranges per doctor per day
-- Receptionists can pre-reserve tokens 1-10 for VIPs, staff, etc.
-- Regular auto-assigned tokens skip reserved ranges.
--
-- Range support: `reservation_date` is the start, `end_date` is the inclusive
-- last date the reservation is active. Single-day reservations store both
-- equal. "Always / indefinite" reservations use the sentinel '2099-12-31'
-- (see TOKEN_RESERVATION_ALWAYS_END_DATE in src/routes/tenant/reception.ts).

CREATE TABLE IF NOT EXISTS token_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER,
  reservation_date TEXT NOT NULL,
  end_date TEXT NOT NULL DEFAULT '2099-12-31',
  token_from INTEGER NOT NULL,
  token_to INTEGER NOT NULL,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, doctor_id, reservation_date, token_from, token_to)
);

CREATE INDEX IF NOT EXISTS idx_token_reservations_lookup
  ON token_reservations(tenant_id, doctor_id, reservation_date, is_active);

CREATE INDEX IF NOT EXISTS idx_token_reservations_date
  ON token_reservations(tenant_id, reservation_date);

-- Range lookup: ? between reservation_date and end_date.
CREATE INDEX IF NOT EXISTS idx_token_reservations_range
  ON token_reservations(tenant_id, doctor_id, reservation_date, end_date, is_active);
