-- Migration: 0094_biomedical_waste.sql
-- Biomedical Waste Management — categorization, collection, disposal tracking

CREATE TABLE IF NOT EXISTS bmw_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    category_code TEXT NOT NULL,          -- "Yellow", "Red", "White", "Blue"
    category_name TEXT NOT NULL,          -- "Infectious Waste", "Sharps", "Pathological"
    color TEXT NOT NULL,                  -- bag/bin color
    description TEXT,
    disposal_method TEXT,                 -- "Incineration", "Autoclave+Shredding", "Deep Burial"
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bmw_cat_tenant ON bmw_categories(tenant_id);

CREATE TABLE IF NOT EXISTS bmw_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    collection_number TEXT NOT NULL,
    collection_date TEXT NOT NULL,
    department TEXT NOT NULL,             -- "OT", "Lab", "Ward A"
    category_id INTEGER NOT NULL,
    category_name TEXT,                   -- denormalized
    weight_kg REAL NOT NULL,
    bag_count INTEGER DEFAULT 1,
    collected_by TEXT,
    handover_to TEXT,                     -- waste management vendor
    vehicle_number TEXT,
    manifest_number TEXT,                 -- govt tracking manifest
    status TEXT DEFAULT 'collected' CHECK(status IN ('collected','in_transit','disposed','reported')),
    disposed_at TEXT,
    disposal_method TEXT,
    disposal_certificate TEXT,            -- certificate number from vendor
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bmw_coll_num ON bmw_collections(tenant_id, collection_number);
CREATE INDEX IF NOT EXISTS idx_bmw_coll_tenant ON bmw_collections(tenant_id, collection_date);
CREATE INDEX IF NOT EXISTS idx_bmw_coll_dept ON bmw_collections(tenant_id, department);
