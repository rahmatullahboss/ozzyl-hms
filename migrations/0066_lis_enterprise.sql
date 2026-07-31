-- Migration number: 0066 	 2026-04-02T00:00:00.000Z
-- Enterprise LIS Enhancements

-- 1. Add verification and machine integration fields to lab_order_items
ALTER TABLE lab_order_items ADD COLUMN barcode TEXT;
ALTER TABLE lab_order_items ADD COLUMN verified_by INTEGER REFERENCES users(id);
ALTER TABLE lab_order_items ADD COLUMN verified_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN hl7_device_id TEXT;

-- Create index on barcode for fast scanning
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_order_items_barcode ON lab_order_items(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_order_items_verified ON lab_order_items(verified_by);

-- 2. Bulk Import Logs (tracking compendium upload history)
CREATE TABLE IF NOT EXISTS lab_bulk_import_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id),
    imported_by INTEGER NOT NULL REFERENCES users(id),
    file_name TEXT NOT NULL,
    total_records INTEGER NOT NULL,
    successful_records INTEGER NOT NULL,
    failed_records INTEGER NOT NULL,
    error_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_bulk_import_tenant ON lab_bulk_import_logs(tenant_id);
