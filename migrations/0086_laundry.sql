-- Migration: 0086_laundry.sql
-- Laundry Management — linen tracking, wash cycles, ward delivery

CREATE TABLE IF NOT EXISTS laundry_linen_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    linen_name TEXT NOT NULL,            -- "Bed Sheet", "Pillow Cover", "OT Gown", "Patient Gown", "Towel"
    category TEXT DEFAULT 'general' CHECK(category IN ('general','ot','icu','pediatric','maternity')),
    par_level INTEGER DEFAULT 0,         -- minimum stock per ward
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_laundry_linen_tenant ON laundry_linen_types(tenant_id);

CREATE TABLE IF NOT EXISTS laundry_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    collection_number TEXT NOT NULL,
    collected_from TEXT NOT NULL,         -- "Ward A", "OT", "ICU"
    collection_date TEXT NOT NULL,
    total_items INTEGER DEFAULT 0,
    status TEXT DEFAULT 'collected' CHECK(status IN ('collected','washing','drying','ironing','ready','delivered')),
    collected_by INTEGER,
    delivered_at TEXT,
    delivered_by INTEGER,
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_laundry_coll_num ON laundry_collections(tenant_id, collection_number);
CREATE INDEX IF NOT EXISTS idx_laundry_coll_tenant ON laundry_collections(tenant_id, collection_date);

CREATE TABLE IF NOT EXISTS laundry_collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    collection_id INTEGER NOT NULL,
    linen_type_id INTEGER NOT NULL,
    quantity_dirty INTEGER NOT NULL,
    quantity_clean INTEGER DEFAULT 0,
    quantity_damaged INTEGER DEFAULT 0,
    remarks TEXT,
    FOREIGN KEY (collection_id) REFERENCES laundry_collections(id) ON DELETE CASCADE,
    FOREIGN KEY (linen_type_id) REFERENCES laundry_linen_types(id)
);
CREATE INDEX IF NOT EXISTS idx_laundry_item_coll ON laundry_collection_items(collection_id);
