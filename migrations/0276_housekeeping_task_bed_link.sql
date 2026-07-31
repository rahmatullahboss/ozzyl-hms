-- Migration 0276: Link housekeeping tasks to beds for auto post-discharge cleaning
ALTER TABLE housekeeping_tasks ADD COLUMN bed_id INTEGER;
ALTER TABLE housekeeping_tasks ADD COLUMN admission_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_hk_task_bed ON housekeeping_tasks(tenant_id, bed_id);
