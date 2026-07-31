-- Migration: 0083_medico_legal_cases.sql
-- MLC (Medico-Legal Case) tracking — extends emergency module

-- ═══════════════════════════════════════════════════════════════════════
-- 1. MLC REGISTER (main medico-legal case record)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mlc_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    mlc_number TEXT NOT NULL,             -- auto-generated: MLC-YYYYMMDD-001
    patient_id INTEGER NOT NULL,
    er_patient_id INTEGER,                -- FK to er_patients if from emergency
    admission_id INTEGER,
    case_type TEXT NOT NULL CHECK(case_type IN ('accident','assault','poisoning','burns','sexual_assault','suicide_attempt','snake_bite','dog_bite','industrial','drowning','hanging','firearm','stabbing','other')),
    case_date TEXT NOT NULL,
    case_time TEXT,
    brought_by TEXT,                      -- "Police", "Relative", "Ambulance", "Self"
    mode_of_arrival TEXT,
    police_station TEXT,
    fir_number TEXT,                      -- First Information Report number
    police_officer_name TEXT,
    police_officer_rank TEXT,
    police_officer_badge TEXT,
    informant_name TEXT,                  -- person who reported
    informant_relation TEXT,
    informant_address TEXT,
    informant_phone TEXT,
    incident_place TEXT,
    incident_date TEXT,
    incident_time TEXT,
    incident_description TEXT,
    -- Clinical findings
    general_condition TEXT CHECK(general_condition IN ('conscious','semiconscious','unconscious','dead')),
    injury_description TEXT,
    injury_type TEXT,                     -- "Blunt", "Sharp", "Burn", "Chemical", "Firearm"
    injury_site TEXT,                     -- body parts
    alcohol_smell INTEGER DEFAULT 0,
    substance_suspected TEXT,
    clothes_condition TEXT,               -- "Torn", "Blood-stained", "Normal"
    -- Samples collected
    blood_sample_collected INTEGER DEFAULT 0,
    urine_sample_collected INTEGER DEFAULT 0,
    viscera_preserved INTEGER DEFAULT 0,
    other_samples TEXT,
    -- Opinion
    provisional_opinion TEXT,
    final_opinion TEXT,
    cause_of_injury TEXT,
    nature_of_injury TEXT CHECK(nature_of_injury IN ('simple','grievous','dangerous','fatal')),
    -- Status
    status TEXT DEFAULT 'active' CHECK(status IN ('active','discharged','referred','absconded','expired','closed')),
    outcome TEXT,
    discharge_date TEXT,
    referred_to TEXT,
    -- Certification
    examining_doctor_id INTEGER,
    examining_doctor_name TEXT,
    certified_at TEXT,
    -- Audit
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mlc_number ON mlc_cases(tenant_id, mlc_number);
CREATE INDEX IF NOT EXISTS idx_mlc_tenant ON mlc_cases(tenant_id, case_date);
CREATE INDEX IF NOT EXISTS idx_mlc_patient ON mlc_cases(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_mlc_type ON mlc_cases(tenant_id, case_type);
CREATE INDEX IF NOT EXISTS idx_mlc_status ON mlc_cases(tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. MLC INJURY DETAILS (multiple injuries per case)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mlc_injuries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    mlc_id INTEGER NOT NULL,
    injury_number INTEGER NOT NULL,       -- 1, 2, 3...
    body_part TEXT NOT NULL,              -- "Head", "Left arm", "Abdomen"
    injury_type TEXT,                     -- "Laceration", "Contusion", "Fracture", "Abrasion", "Incised wound"
    size_cm TEXT,                         -- "5x3 cm"
    depth TEXT,                           -- "Superficial", "Deep", "Penetrating"
    weapon_used TEXT,
    age_of_injury TEXT,                   -- "Fresh", "1-2 days old", "Healing"
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (mlc_id) REFERENCES mlc_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mlc_injury ON mlc_injuries(mlc_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. MLC NOTES / FOLLOW-UP (timeline of events)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mlc_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    mlc_id INTEGER NOT NULL,
    note_type TEXT DEFAULT 'progress' CHECK(note_type IN ('progress','police_visit','court_order','sample_sent','opinion_given','discharge','other')),
    note_text TEXT NOT NULL,
    noted_by INTEGER,
    noted_by_name TEXT,
    noted_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (mlc_id) REFERENCES mlc_cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mlc_notes ON mlc_notes(mlc_id);
