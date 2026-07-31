CREATE TABLE IF NOT EXISTS global_family_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_identity_id INTEGER NOT NULL,
  manager_auth_user_id INTEGER NOT NULL,
  relationship TEXT NOT NULL,
  access_role TEXT NOT NULL DEFAULT 'manager',
  verification_basis TEXT NOT NULL DEFAULT 'dependent_created',
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by_auth_user_id INTEGER,
  revoked_by_auth_user_id INTEGER,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gfl_patient_identity
  ON global_family_links(patient_identity_id, status);

CREATE INDEX IF NOT EXISTS idx_gfl_manager_auth
  ON global_family_links(manager_auth_user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gfl_active_unique
  ON global_family_links(patient_identity_id, manager_auth_user_id)
  WHERE status = 'active';
