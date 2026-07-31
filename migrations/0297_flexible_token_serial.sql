-- Migration 0297: Flexible token serial (manual override at reception)

ALTER TABLE queue_entries ADD COLUMN manual_serial_set_by INTEGER;
ALTER TABLE queue_entries ADD COLUMN manual_serial_set_at TEXT;

CREATE INDEX IF NOT EXISTS idx_queue_entry_manual_serial
    ON queue_entries(tenant_id, manual_serial_set_by)
    WHERE manual_serial_set_by IS NOT NULL;

-- Two partial unique indexes because SQLite treats NULL as distinct in UNIQUE.
-- Together they prevent duplicate (tenant, dept-or-null, date, token_number).
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_token_number_dept
    ON queue_entries(tenant_id, department_id, queue_date, token_number)
    WHERE department_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_token_number_nodept
    ON queue_entries(tenant_id, queue_date, token_number)
    WHERE department_id IS NULL;
