-- =============================================================================
-- HMS Migration 0172: Lab Validation Rules Engine
-- Date: 2026-04-26
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAB VALIDATION RULES
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lab_validation_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_test_id       INTEGER REFERENCES lab_test_catalog(id),
  component_id      INTEGER REFERENCES lab_test_components(id),
  rule_type         TEXT NOT NULL CHECK(rule_type IN ('range','mandatory','dependency','delta')),
  rule_config       TEXT NOT NULL,               -- JSON: {min,max} or {max_change_percent} etc.
  error_message     TEXT,
  is_blocking       INTEGER NOT NULL DEFAULT 1,  -- 1=reject save, 0=warn only
  is_active         INTEGER NOT NULL DEFAULT 1,
  tenant_id         INTEGER NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_val_rule_test   ON lab_validation_rules(lab_test_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_val_rule_type   ON lab_validation_rules(rule_type, is_active);
CREATE INDEX IF NOT EXISTS idx_lab_val_rule_tenant ON lab_validation_rules(tenant_id, is_active);
