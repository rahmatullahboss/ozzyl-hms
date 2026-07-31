-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Conditional-optional patient mobile
--
-- Phase 1+2 of the "mobile conditional optional" redesign.
--
-- Real-world reality (especially in rural Bangladesh): reception desks
-- encounter patients who do not have a personal mobile, no family mobile,
-- or arrive in an emergency without any number. Forcing reception to type
-- fake / hospital / their own numbers pollutes the patient matching index
-- and sends SMS / WhatsApp to the wrong people.
--
-- The new policy is:
--   1. If a Bangladesh mobile is provided, validate + normalise it as
--      before. The column remains the primary patient lookup key.
--   2. If no mobile is provided, the receptionist MUST:
--        a. Pick a `mobile_missing_reason` so the data quality team can
--           later chase up the number, AND
--        b. Supply at least one of:
--             - Guardian contact (name + relation, mobile optional) so
--               the patient can be reached through family, OR
--             - Full structured address (village + union + upazila +
--               district) so the patient can be located geographically.
--
-- This migration makes `patients.mobile` nullable, adds the reason enum
-- and the structured address columns (village + union), and rebuilds the
-- affected index so empty mobiles do not pollute the mobile-lookup index.
-- The pre-existing `division`, `district`, `upazila` columns are reused.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Recreate `patients` so `mobile` becomes nullable ────────────────────
-- SQLite cannot DROP a NOT NULL constraint in place, so the standard
-- pattern (used in 0106 / 0269 / 0286) is to copy the table, swap, and
-- rebuild the index.

PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

DROP INDEX IF EXISTS idx_patients_mobile;
DROP INDEX IF EXISTS idx_patients_tenant;
DROP INDEX IF EXISTS idx_patients_duplicate;

ALTER TABLE patients RENAME TO patients_old;

CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_code TEXT,
    branch_id INTEGER,
    name TEXT NOT NULL,
    father_husband TEXT NOT NULL,
    address TEXT NOT NULL,
    mobile TEXT,
    mobile_missing_reason TEXT
        CHECK (mobile_missing_reason IS NULL OR mobile_missing_reason IN (
            'no_personal_mobile',
            'no_family_mobile',
            'emergency_arrival',
            'patient_refused',
            'will_update_later',
            'other'
        )),
    guardian_mobile TEXT,
    age INTEGER,
    gender TEXT,
    blood_group TEXT,
    email TEXT,
    date_of_birth TEXT,
    nationality TEXT,
    photo_url TEXT,
    secondary_contact TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_verified INTEGER NOT NULL DEFAULT 1,
    national_id TEXT,
    uhid TEXT,
    brn TEXT,
    division TEXT,
    district TEXT,
    upazila TEXT,
    village TEXT,
    union_name TEXT,
    global_identity_id INTEGER,
    is_duplicate INTEGER DEFAULT 0,
    duplicate_of_patient_id INTEGER,
    verified_mobile INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO patients (
    id, tenant_id, patient_code, branch_id, name, father_husband, address,
    mobile, guardian_mobile, age, gender, blood_group, email, date_of_birth,
    nationality, photo_url, secondary_contact, is_active, is_verified,
    national_id, uhid, brn, division, district, upazila, global_identity_id,
    is_duplicate, duplicate_of_patient_id, verified_mobile, created_at,
    updated_at
)
SELECT
    id, tenant_id, patient_code, branch_id, name, father_husband, address,
    mobile, guardian_mobile, age, gender, blood_group, email, date_of_birth,
    nationality, photo_url, secondary_contact, is_active, is_verified,
    national_id, uhid, brn, division, district, upazila, global_identity_id,
    is_duplicate, duplicate_of_patient_id, verified_mobile, created_at,
    updated_at
FROM patients_old;

DROP TABLE patients_old;

-- ── 2. Indexes ─────────────────────────────────────────────────────────────
-- `mobile` is now sparse; the partial index keeps lookups for actual
-- numbers fast without indexing every null row.
CREATE INDEX idx_patients_mobile
    ON patients(mobile) WHERE mobile IS NOT NULL;
CREATE INDEX idx_patients_tenant ON patients(tenant_id);
CREATE INDEX idx_patients_duplicate
    ON patients(tenant_id, is_duplicate);

-- Useful for the rural-patient search path (no mobile, structured
-- address + father name + gender).
CREATE INDEX idx_patients_address_lookup
    ON patients(tenant_id, district, upazila, name);

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
