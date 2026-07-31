-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0101: Health Card Lifecycle Management
-- Versioned, revocable health cards with staleness detection
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS health_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  card_type TEXT NOT NULL DEFAULT 'hospital' CHECK(card_type IN ('hospital', 'global')),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked', 'expired', 'replaced', 'stale')),
  token_id INTEGER REFERENCES health_record_access_tokens(id),
  issued_by INTEGER NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoke_reason TEXT,
  replaced_by_id INTEGER REFERENCES health_cards(id),
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_cards_patient ON health_cards(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_health_cards_status ON health_cards(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_health_cards_token ON health_cards(token_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_cards_version ON health_cards(tenant_id, patient_id, version);
