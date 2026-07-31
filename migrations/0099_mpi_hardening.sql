-- Migration 0099: MPI (Master Patient Index) Hardening
-- Adds BRN, guardian entities, alias history, cross-tenant duplicate detection,
-- BD address components, and verification metadata

-- ============================================================
-- 1. Add BRN (Birth Registration Number) to patients table
-- BRN is a 17-digit number issued at birth, used for minors before NID
-- ============================================================
ALTER TABLE patients ADD COLUMN brn TEXT;
CREATE INDEX idx_patients_brn ON patients(brn) WHERE brn IS NOT NULL;

-- ============================================================
-- 2. Add BRN to global_patient_identity (cross-tenant)
-- ============================================================
ALTER TABLE global_patient_identity ADD COLUMN brn TEXT;
CREATE UNIQUE INDEX idx_gpi_brn ON global_patient_identity(brn) WHERE brn IS NOT NULL;

-- ============================================================
-- 3. Add verification metadata to global_patient_identity
-- JSON: {"verified_by":"porichoy_api","verified_at":"...","response_hash":"..."}
-- verification_level values: 0=Unverified, 1=Self-Declared, 2=Staff-Verified, 3=Govt-Verified
-- ============================================================
ALTER TABLE global_patient_identity ADD COLUMN verification_metadata TEXT;

-- ============================================================
-- 4. Add BD address components to patients
-- 8 divisions, 64 districts, ~500 upazilas — stored as text, not FK
-- ============================================================
ALTER TABLE patients ADD COLUMN division TEXT;
ALTER TABLE patients ADD COLUMN district TEXT;
ALTER TABLE patients ADD COLUMN upazila TEXT;

-- ============================================================
-- 5. Patient Guardians table
-- For non-patient guardians (e.g., parents of minors who are not patients)
-- Tenant-scoped because guardian data is entered per-hospital
-- ============================================================
CREATE TABLE IF NOT EXISTS patient_guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  guardian_name TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK(relationship IN (
    'mother', 'father', 'grandparent', 'uncle', 'aunt',
    'sibling', 'spouse', 'legal_guardian', 'other'
  )),
  national_id TEXT,                        -- Guardian's own NID if available
  phone TEXT,
  address TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,   -- Primary guardian flag
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE INDEX idx_guardians_patient ON patient_guardians(tenant_id, patient_id);
CREATE INDEX idx_guardians_nid ON patient_guardians(national_id) WHERE national_id IS NOT NULL;
CREATE INDEX idx_guardians_phone ON patient_guardians(phone) WHERE phone IS NOT NULL;

-- ============================================================
-- 6. Patient Alias History
-- Tracks old names, phones, NIDs when identity fields change
-- Tenant-scoped; cross-tenant dedup uses mpi_duplicate_suspects
-- ============================================================
CREATE TABLE IF NOT EXISTS patient_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  alias_type TEXT NOT NULL CHECK(alias_type IN (
    'name', 'phone', 'nid', 'brn', 'email', 'address'
  )),
  alias_value TEXT NOT NULL,
  valid_from TEXT,                          -- When this alias was first known
  valid_to TEXT,                            -- When it was superseded
  reason TEXT,                              -- 'correction', 'marriage', 'typo', 'migration'
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE INDEX idx_aliases_patient ON patient_aliases(tenant_id, patient_id);
CREATE INDEX idx_aliases_type_value ON patient_aliases(alias_type, alias_value);

-- ============================================================
-- 7. Cross-Tenant Duplicate Suspects Queue
-- Global table (references global_patient_identity.id, not tenant-scoped)
-- Used for manual review of potential cross-tenant duplicates
-- ============================================================
CREATE TABLE IF NOT EXISTS mpi_duplicate_suspects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_id_1 INTEGER NOT NULL,          -- FK to global_patient_identity.id
  identity_id_2 INTEGER NOT NULL,          -- FK to global_patient_identity.id
  match_type TEXT NOT NULL,                -- 'nid', 'brn', 'phone', 'name_dob', 'phone_name'
  confidence INTEGER NOT NULL,             -- 0-100 match confidence score
  match_details TEXT,                      -- JSON with match specifics
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending', 'confirmed', 'rejected', 'auto_linked'
  )),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(identity_id_1, identity_id_2)
);

CREATE INDEX idx_dup_suspects_status ON mpi_duplicate_suspects(status);
CREATE INDEX idx_dup_suspects_id1 ON mpi_duplicate_suspects(identity_id_1);
CREATE INDEX idx_dup_suspects_id2 ON mpi_duplicate_suspects(identity_id_2);
