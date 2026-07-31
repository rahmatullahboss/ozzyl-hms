-- Migration number: 0172 	 2026-04-26T00:00:00.000Z
-- Lab Machine Bidirectional Orders

CREATE TABLE IF NOT EXISTS lab_machine_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL,
    lab_order_id INTEGER,
    lab_order_item_id INTEGER,
    machine_test_code TEXT,
    status TEXT DEFAULT 'pending',
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME,
    raw_request TEXT,
    raw_response TEXT,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_machine_orders_machine ON lab_machine_orders(machine_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_machine_orders_status ON lab_machine_orders(status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_machine_orders_lab_order ON lab_machine_orders(lab_order_id, tenant_id);
