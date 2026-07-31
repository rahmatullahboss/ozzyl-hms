-- Migration: 0082_blood_bank.sql
-- Blood Bank Management — donor registry, stock, cross-match, transfusion

-- ═══════════════════════════════════════════════════════════════════════
-- 1. BLOOD DONORS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS blood_donors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    donor_name TEXT NOT NULL,
    donor_type TEXT DEFAULT 'voluntary' CHECK(donor_type IN ('voluntary','replacement','autologous','directed')),
    blood_group TEXT NOT NULL CHECK(blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    gender TEXT CHECK(gender IN ('Male','Female','Other')),
    age INTEGER,
    date_of_birth TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    national_id TEXT,
    weight_kg REAL,
    hemoglobin REAL,
    last_donation_date TEXT,
    total_donations INTEGER DEFAULT 0,
    is_eligible INTEGER DEFAULT 1,       -- 0 = deferred
    deferral_reason TEXT,
    deferral_until TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_blood_donor_tenant ON blood_donors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_blood_donor_group ON blood_donors(tenant_id, blood_group);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. BLOOD DONATIONS (collection events)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS blood_donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    donor_id INTEGER NOT NULL,
    bag_number TEXT NOT NULL,            -- unique bag/unit ID
    blood_group TEXT NOT NULL,
    component TEXT DEFAULT 'whole_blood' CHECK(component IN ('whole_blood','packed_rbc','ffp','platelets','cryoprecipitate','plasma')),
    volume_ml INTEGER DEFAULT 450,
    collection_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    collection_site TEXT,                -- "Blood Bank", "Camp: City Mall"
    hemoglobin_level REAL,
    blood_pressure TEXT,
    screening_status TEXT DEFAULT 'pending' CHECK(screening_status IN ('pending','passed','failed')),
    hiv_result TEXT DEFAULT 'pending' CHECK(hiv_result IN ('pending','negative','positive','indeterminate')),
    hbsag_result TEXT DEFAULT 'pending' CHECK(hbsag_result IN ('pending','negative','positive','indeterminate')),
    hcv_result TEXT DEFAULT 'pending' CHECK(hcv_result IN ('pending','negative','positive','indeterminate')),
    vdrl_result TEXT DEFAULT 'pending' CHECK(vdrl_result IN ('pending','negative','positive','indeterminate')),
    malaria_result TEXT DEFAULT 'pending' CHECK(malaria_result IN ('pending','negative','positive','indeterminate')),
    status TEXT DEFAULT 'in_stock' CHECK(status IN ('in_stock','reserved','cross_matched','issued','expired','discarded','quarantine')),
    remarks TEXT,
    collected_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (donor_id) REFERENCES blood_donors(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blood_bag_unique ON blood_donations(tenant_id, bag_number);
CREATE INDEX IF NOT EXISTS idx_blood_donation_tenant ON blood_donations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_blood_donation_group ON blood_donations(tenant_id, blood_group, status);
CREATE INDEX IF NOT EXISTS idx_blood_donation_expiry ON blood_donations(expiry_date);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. CROSS-MATCH REQUESTS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS blood_cross_match (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    patient_blood_group TEXT NOT NULL,
    requested_component TEXT DEFAULT 'packed_rbc',
    units_requested INTEGER DEFAULT 1,
    urgency TEXT DEFAULT 'routine' CHECK(urgency IN ('routine','urgent','emergency')),
    indication TEXT,                     -- "Pre-surgery", "Anemia", "Trauma"
    requested_by INTEGER,               -- doctor
    donation_id INTEGER,                -- matched blood unit
    compatibility_result TEXT CHECK(compatibility_result IN ('compatible','incompatible','pending')),
    tested_at TEXT,
    tested_by INTEGER,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','matched','issued','cancelled')),
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (donation_id) REFERENCES blood_donations(id)
);
CREATE INDEX IF NOT EXISTS idx_blood_xmatch_tenant ON blood_cross_match(tenant_id);
CREATE INDEX IF NOT EXISTS idx_blood_xmatch_patient ON blood_cross_match(tenant_id, patient_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. BLOOD TRANSFUSIONS (issue + administration)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS blood_transfusions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    patient_id INTEGER NOT NULL,
    cross_match_id INTEGER,
    donation_id INTEGER NOT NULL,
    bag_number TEXT NOT NULL,
    blood_group TEXT NOT NULL,
    component TEXT NOT NULL,
    volume_ml INTEGER,
    issued_at TEXT NOT NULL,
    issued_by INTEGER,
    transfusion_start TEXT,
    transfusion_end TEXT,
    administered_by INTEGER,
    vital_signs_pre TEXT,                -- JSON: {bp, pulse, temp}
    vital_signs_post TEXT,
    reaction_type TEXT CHECK(reaction_type IN (NULL,'none','mild','moderate','severe','fatal')),
    reaction_details TEXT,
    status TEXT DEFAULT 'issued' CHECK(status IN ('issued','in_progress','completed','reaction_stopped','returned')),
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (donation_id) REFERENCES blood_donations(id),
    FOREIGN KEY (cross_match_id) REFERENCES blood_cross_match(id)
);
CREATE INDEX IF NOT EXISTS idx_blood_transfusion_tenant ON blood_transfusions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_blood_transfusion_patient ON blood_transfusions(tenant_id, patient_id);
