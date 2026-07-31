-- ════════════════════════════════════════════════════════════════
-- Sprint 8: Consent Model V2 (Advanced Privacy & Security)
-- ════════════════════════════════════════════════════════════════

-- ── 1. Break-Glass / Emergency Consent Overrides ────────────────
-- Records when a clinician bypasses privacy blocks for life-saving reasons.
CREATE TABLE IF NOT EXISTS health_record_consent_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  national_id TEXT NOT NULL,
  accessing_tenant_id INTEGER NOT NULL,
  accessing_user_id INTEGER NOT NULL,
  emergency_reason_code TEXT NOT NULL CHECK(emergency_reason_code IN ('ETREAT', 'EMERGENCY', 'LEGAL', 'OTHER')),
  emergency_reason_details TEXT,
  resource_type TEXT,
  resource_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consent_overrides_nid
  ON health_record_consent_overrides(national_id);

CREATE INDEX IF NOT EXISTS idx_consent_overrides_tenant
  ON health_record_consent_overrides(accessing_tenant_id);

-- ── 2. Health Record Block List (Patient explicit exclusions) ───
-- Patients can block entire hospitals (tenant_id) or specific doctors.
CREATE TABLE IF NOT EXISTS health_record_block_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  national_id TEXT NOT NULL,
  blocked_tenant_id INTEGER,
  blocked_doctor_id INTEGER,
  reason TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  CHECK (blocked_tenant_id IS NOT NULL OR blocked_doctor_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_block_list_nid
  ON health_record_block_list(national_id, is_active);

-- ── 3. Sensitive Data Classification (HL7 Security Labels) ──────
-- Labels applied statically to resources to restrict default access.
CREATE TABLE IF NOT EXISTS health_record_sensitivity_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id INTEGER NOT NULL,
  sensitivity_category TEXT NOT NULL CHECK(sensitivity_category IN ('PSY', 'STI', 'SUD', 'REP', 'HIV')),
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sensitivity_resource
  ON health_record_sensitivity_labels(resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_sensitivity_tenant_patient
  ON health_record_sensitivity_labels(tenant_id, patient_id);
