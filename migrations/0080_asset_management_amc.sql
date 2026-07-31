-- Migration: 0080_asset_management_amc.sql
-- Asset/Equipment Management with AMC (Annual Maintenance Contract) tracking
-- Extends existing InventoryFixedAssetStock from 0037_inventory.sql

-- ═══════════════════════════════════════════════════════════════════════
-- 1. AMC (Annual Maintenance Contracts)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asset_amc_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    asset_stock_id INTEGER,              -- FK to InventoryFixedAssetStock
    contract_number TEXT NOT NULL,
    vendor_name TEXT NOT NULL,
    vendor_contact TEXT,
    vendor_email TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    contract_amount REAL DEFAULT 0,
    payment_frequency TEXT DEFAULT 'annual' CHECK(payment_frequency IN ('monthly','quarterly','half_yearly','annual','one_time')),
    coverage_type TEXT DEFAULT 'comprehensive' CHECK(coverage_type IN ('comprehensive','non_comprehensive','labor_only','parts_only')),
    terms TEXT,                           -- contract terms/notes
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_amc_tenant ON asset_amc_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_amc_asset ON asset_amc_contracts(asset_stock_id);
CREATE INDEX IF NOT EXISTS idx_amc_expiry ON asset_amc_contracts(end_date);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. MAINTENANCE LOG (service/repair records)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asset_maintenance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    asset_stock_id INTEGER NOT NULL,
    amc_contract_id INTEGER,
    maintenance_type TEXT NOT NULL CHECK(maintenance_type IN ('preventive','corrective','calibration','inspection','breakdown')),
    description TEXT NOT NULL,
    performed_by TEXT,                    -- technician name
    performed_date TEXT NOT NULL,
    next_due_date TEXT,
    cost REAL DEFAULT 0,
    covered_by_amc INTEGER DEFAULT 0,
    parts_replaced TEXT,                  -- JSON array of parts
    status TEXT DEFAULT 'completed' CHECK(status IN ('scheduled','in_progress','completed','cancelled')),
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (asset_stock_id) REFERENCES InventoryFixedAssetStock(FixedAssetStockId),
    FOREIGN KEY (amc_contract_id) REFERENCES asset_amc_contracts(id)
);
CREATE INDEX IF NOT EXISTS idx_maint_tenant ON asset_maintenance_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maint_asset ON asset_maintenance_log(asset_stock_id);
CREATE INDEX IF NOT EXISTS idx_maint_date ON asset_maintenance_log(performed_date);
CREATE INDEX IF NOT EXISTS idx_maint_due ON asset_maintenance_log(next_due_date);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. ASSET ALLOCATION (which department/room has the asset)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asset_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    asset_stock_id INTEGER NOT NULL,
    department TEXT,
    location TEXT,                        -- "ICU Room 3", "OT Block 2"
    allocated_to TEXT,                    -- staff name
    allocated_date TEXT NOT NULL,
    returned_date TEXT,
    condition_on_allocate TEXT DEFAULT 'good' CHECK(condition_on_allocate IN ('good','fair','poor')),
    condition_on_return TEXT,
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (asset_stock_id) REFERENCES InventoryFixedAssetStock(FixedAssetStockId)
);
CREATE INDEX IF NOT EXISTS idx_alloc_tenant ON asset_allocations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alloc_asset ON asset_allocations(asset_stock_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. EXTEND InventoryFixedAssetStock with additional fields
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE InventoryFixedAssetStock ADD COLUMN asset_category TEXT;        -- "Medical Equipment", "Furniture", "IT", "Vehicle"
ALTER TABLE InventoryFixedAssetStock ADD COLUMN manufacturer TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN model_number TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN serial_number TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN purchase_date TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN purchase_cost REAL;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN warranty_expiry TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN depreciation_rate REAL;     -- annual %
ALTER TABLE InventoryFixedAssetStock ADD COLUMN current_value REAL;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN asset_status TEXT DEFAULT 'active' CHECK(asset_status IN ('active','under_repair','disposed','condemned','in_storage'));
ALTER TABLE InventoryFixedAssetStock ADD COLUMN last_maintenance_date TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN next_maintenance_due TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN department TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN location TEXT;
ALTER TABLE InventoryFixedAssetStock ADD COLUMN asset_image_url TEXT;
