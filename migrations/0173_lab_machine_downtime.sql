-- Migration number: 0173 	 2026-04-26T00:00:00.000Z
-- Lab Machine Downtime Tracking

CREATE TABLE IF NOT EXISTS lab_machine_downtime (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    description TEXT,
    reported_by INTEGER,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolution_notes TEXT,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_machine_downtime_machine ON lab_machine_downtime(machine_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_machine_downtime_active ON lab_machine_downtime(machine_id, tenant_id, resolved_at);
