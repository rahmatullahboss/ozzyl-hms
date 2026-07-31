-- Migration: 0089_mortuary.sql
-- Mortuary Management — body intake, preservation, handover

CREATE TABLE IF NOT EXISTS mortuary_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    record_number TEXT NOT NULL,          -- MOR-YYYYMMDD-001
    patient_id INTEGER,
    deceased_name TEXT NOT NULL,
    age INTEGER,
    gender TEXT CHECK(gender IN ('Male','Female','Other')),
    national_id TEXT,
    date_of_death TEXT NOT NULL,
    time_of_death TEXT,
    cause_of_death TEXT,
    place_of_death TEXT,                  -- "Ward A", "ICU", "ER", "Brought Dead"
    brought_from TEXT,                    -- if external
    admission_id INTEGER,
    mlc_id INTEGER,                       -- if medico-legal
    is_mlc INTEGER DEFAULT 0,
    -- Preservation
    storage_unit TEXT,                    -- "Unit 1", "Freezer A"
    preservation_type TEXT DEFAULT 'refrigeration' CHECK(preservation_type IN ('refrigeration','embalming','none')),
    received_at TEXT NOT NULL,
    -- NOC / Police
    police_noc_received INTEGER DEFAULT 0,
    police_noc_date TEXT,
    police_station TEXT,
    -- Handover
    handover_to TEXT,                     -- person who collected the body
    handover_relation TEXT,               -- "Son", "Brother", "Wife"
    handover_id_type TEXT,                -- "NID", "Passport"
    handover_id_number TEXT,
    handover_phone TEXT,
    handover_date TEXT,
    handover_time TEXT,
    handover_witnessed_by TEXT,
    -- Post-mortem
    postmortem_required INTEGER DEFAULT 0,
    postmortem_done INTEGER DEFAULT 0,
    postmortem_date TEXT,
    postmortem_findings TEXT,
    -- Death certificate
    death_certificate_number TEXT,
    death_certificate_issued INTEGER DEFAULT 0,
    -- Status
    status TEXT DEFAULT 'received' CHECK(status IN ('received','preserved','awaiting_noc','awaiting_postmortem','ready_for_handover','handed_over','transferred')),
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mort_num ON mortuary_records(tenant_id, record_number);
CREATE INDEX IF NOT EXISTS idx_mort_tenant ON mortuary_records(tenant_id, date_of_death);
CREATE INDEX IF NOT EXISTS idx_mort_status ON mortuary_records(tenant_id, status);
