CREATE TABLE IF NOT EXISTS global_family_proxy_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_identity_id INTEGER NOT NULL,
  inviter_auth_user_id INTEGER NOT NULL,
  invitee_auth_user_id INTEGER NOT NULL,
  relationship TEXT NOT NULL,
  access_role TEXT NOT NULL DEFAULT 'manager',
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  declined_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gfpi_patient
  ON global_family_proxy_invites(patient_identity_id, status);

CREATE INDEX IF NOT EXISTS idx_gfpi_inviter
  ON global_family_proxy_invites(inviter_auth_user_id, status);

CREATE INDEX IF NOT EXISTS idx_gfpi_invitee
  ON global_family_proxy_invites(invitee_auth_user_id, status);
