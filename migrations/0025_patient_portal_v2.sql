-- =============================================================================
-- HMS Migration 0025: Patient Portal V2 (Sprint 3)
-- Applied: 2026-03-13
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PATIENT MESSAGES (secure patient ↔ doctor messaging)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    INTEGER NOT NULL,
  doctor_id     INTEGER NOT NULL,
  sender_type   TEXT    NOT NULL CHECK(sender_type IN ('patient', 'doctor')),
  message       TEXT    NOT NULL,
  is_read       INTEGER NOT NULL DEFAULT 0,
  tenant_id     INTEGER NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id)  REFERENCES doctors(id)
);

CREATE INDEX IF NOT EXISTS idx_patient_messages_patient  ON patient_messages(patient_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_doctor   ON patient_messages(doctor_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_patient_messages_unread   ON patient_messages(is_read, sender_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PRESCRIPTION REFILL REQUESTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prescription_refill_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL,
  patient_id      INTEGER NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'approved', 'denied', 'completed')),
  notes           TEXT,
  response_notes  TEXT,
  responded_at    DATETIME,
  tenant_id       INTEGER NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prescription_id) REFERENCES prescriptions(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE INDEX IF NOT EXISTS idx_refill_requests_patient ON prescription_refill_requests(patient_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_refill_requests_status  ON prescription_refill_requests(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PATIENT FAMILY LINKS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_family_links (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_patient_id   INTEGER NOT NULL,
  child_patient_id    INTEGER NOT NULL,
  relationship        TEXT    NOT NULL CHECK(relationship IN ('spouse', 'child', 'parent', 'sibling', 'other')),
  tenant_id           INTEGER NOT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_patient_id) REFERENCES patients(id),
  FOREIGN KEY (child_patient_id)  REFERENCES patients(id),
  UNIQUE(parent_patient_id, child_patient_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_family_links_parent ON patient_family_links(parent_patient_id, tenant_id);
