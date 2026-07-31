-- Production hotfix: allow global identities without NID on older deployed schema
-- Rebuilds the table using the currently deployed production columns while making
-- national_id nullable so self-signup can create identities without NID.

DROP INDEX IF EXISTS idx_global_identity_nid;
DROP INDEX IF EXISTS idx_global_identity_uhid;
DROP INDEX IF EXISTS idx_gpi_claim_status;

ALTER TABLE global_patient_identity RENAME TO global_patient_identity_old;

CREATE TABLE global_patient_identity_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  national_id TEXT UNIQUE,
  uhid TEXT NOT NULL UNIQUE,
  primary_name TEXT,
  primary_phone TEXT,
  primary_email TEXT,
  blood_group TEXT,
  date_of_birth TEXT,
  gender TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  claim_status TEXT NOT NULL DEFAULT 'unclaimed',
  claimed_auth_user_id INTEGER,
  claimed_at TEXT,
  created_source TEXT NOT NULL DEFAULT 'hospital',
  created_tenant_id TEXT
);

INSERT INTO global_patient_identity_new (
  id,
  national_id,
  uhid,
  primary_name,
  primary_phone,
  primary_email,
  blood_group,
  date_of_birth,
  gender,
  created_at,
  updated_at,
  claim_status,
  claimed_auth_user_id,
  claimed_at,
  created_source,
  created_tenant_id
)
SELECT
  id,
  national_id,
  uhid,
  primary_name,
  primary_phone,
  primary_email,
  blood_group,
  date_of_birth,
  gender,
  created_at,
  updated_at,
  claim_status,
  claimed_auth_user_id,
  claimed_at,
  created_source,
  created_tenant_id
FROM global_patient_identity_old;

DROP TABLE global_patient_identity_old;
ALTER TABLE global_patient_identity_new RENAME TO global_patient_identity;

CREATE UNIQUE INDEX idx_global_identity_nid
  ON global_patient_identity(national_id) WHERE national_id IS NOT NULL;

CREATE UNIQUE INDEX idx_global_identity_uhid
  ON global_patient_identity(uhid);

CREATE INDEX idx_gpi_claim_status
  ON global_patient_identity(claim_status);
