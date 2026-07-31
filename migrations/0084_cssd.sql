-- Migration: 0084_cssd.sql
-- CSSD (Central Sterile Supply Department) — instrument sterilization tracking

-- ═══════════════════════════════════════════════════════════════════════
-- 1. INSTRUMENT SETS (what needs sterilizing)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cssd_instrument_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    set_name TEXT NOT NULL,              -- "General Surgery Set", "C-Section Set"
    set_code TEXT,                       -- barcode/tracking code
    department TEXT,                     -- "OT", "Labor Room", "Ward A"
    item_count INTEGER DEFAULT 0,        -- number of instruments in the set
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cssd_set_tenant ON cssd_instrument_sets(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. STERILIZATION CYCLES (each autoclave run)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cssd_sterilization_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    cycle_number TEXT NOT NULL,           -- auto: CYC-YYYYMMDD-001
    autoclave_id TEXT,                    -- which machine
    cycle_type TEXT DEFAULT 'gravity' CHECK(cycle_type IN ('gravity','prevacuum','flash','eto','plasma','dry_heat')),
    temperature_celsius REAL,
    pressure_psi REAL,
    duration_minutes INTEGER,
    start_time TEXT NOT NULL,
    end_time TEXT,
    biological_indicator TEXT DEFAULT 'pending' CHECK(biological_indicator IN ('pending','pass','fail','not_applicable')),
    chemical_indicator TEXT DEFAULT 'pending' CHECK(chemical_indicator IN ('pending','pass','fail','not_applicable')),
    operator_id INTEGER,
    operator_name TEXT,
    status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','failed','cancelled')),
    failure_reason TEXT,
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cssd_cycle_number ON cssd_sterilization_cycles(tenant_id, cycle_number);
CREATE INDEX IF NOT EXISTS idx_cssd_cycle_tenant ON cssd_sterilization_cycles(tenant_id, start_time);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. CYCLE ITEMS (which sets were in each cycle)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cssd_cycle_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    cycle_id INTEGER NOT NULL,
    instrument_set_id INTEGER NOT NULL,
    pack_number TEXT,                     -- individual pack tracking
    status TEXT DEFAULT 'sterilized' CHECK(status IN ('sterilized','failed','recalled')),
    expiry_date TEXT,                     -- sterility expiry (typically 30 days)
    issued_to TEXT,                       -- department/OT
    issued_at TEXT,
    issued_by INTEGER,
    used INTEGER DEFAULT 0,              -- 1 = instrument used, needs re-sterilization
    FOREIGN KEY (cycle_id) REFERENCES cssd_sterilization_cycles(id),
    FOREIGN KEY (instrument_set_id) REFERENCES cssd_instrument_sets(id)
);
CREATE INDEX IF NOT EXISTS idx_cssd_item_cycle ON cssd_cycle_items(cycle_id);
CREATE INDEX IF NOT EXISTS idx_cssd_item_set ON cssd_cycle_items(instrument_set_id);
CREATE INDEX IF NOT EXISTS idx_cssd_item_status ON cssd_cycle_items(tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. COLLECTION LOG (dirty instruments received)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cssd_collection_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    instrument_set_id INTEGER,
    received_from TEXT NOT NULL,          -- "OT 1", "Ward B"
    received_at TEXT DEFAULT (datetime('now')),
    received_by INTEGER,
    condition TEXT DEFAULT 'dirty' CHECK(condition IN ('dirty','contaminated','damaged')),
    item_count INTEGER,
    remarks TEXT,
    FOREIGN KEY (instrument_set_id) REFERENCES cssd_instrument_sets(id)
);
CREATE INDEX IF NOT EXISTS idx_cssd_collect_tenant ON cssd_collection_log(tenant_id, received_at);
