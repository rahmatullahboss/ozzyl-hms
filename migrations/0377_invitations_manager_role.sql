-- 0377: Allow manager invitations
-- SQLite/D1 cannot alter an existing CHECK constraint in place, so rebuild
-- invitations with the same columns and indexes while adding the manager role.

PRAGMA foreign_keys = OFF;

CREATE TABLE invitations_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL,
  email       TEXT,
  role        TEXT NOT NULL CHECK(role IN (
                'hospital_admin','doctor','nurse','laboratory',
                'reception','manager','md','director','pharmacist','accountant')),
  token       TEXT NOT NULL,
  invited_by  INTEGER NOT NULL,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  doctor_id   INTEGER REFERENCES doctors(id),
  revoked_at  TEXT,
  staff_id    INTEGER REFERENCES staff(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

INSERT INTO invitations_new
  (id, tenant_id, email, role, token, invited_by, expires_at, accepted_at, created_at, doctor_id, revoked_at, staff_id)
SELECT id, tenant_id, email, role, token, invited_by, expires_at, accepted_at, created_at, doctor_id, revoked_at, staff_id
  FROM invitations;

DROP TABLE invitations;
ALTER TABLE invitations_new RENAME TO invitations;

CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_doctor ON invitations(tenant_id, doctor_id);
CREATE INDEX IF NOT EXISTS idx_invitations_staff ON invitations(tenant_id, staff_id);

PRAGMA foreign_keys = ON;
