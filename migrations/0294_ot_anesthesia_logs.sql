-- OT Anesthesia Logs (per booking)
-- Blueprint §28.7: tracks anesthesia delivery during surgery

CREATE TABLE IF NOT EXISTS ot_anesthesia_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    anesthesia_type TEXT NOT NULL
      CHECK(anesthesia_type IN ('general','regional','local','sedation','spinal','epidural','nerve_block','combined','other')),
    anesthetist_id INTEGER,
    start_time TEXT,
    end_time TEXT,
    airway_method TEXT,
    drugs TEXT,
    complications TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_anesthesia_booking ON ot_anesthesia_logs(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_anesthesia_anesthetist ON ot_anesthesia_logs(tenant_id, anesthetist_id);
