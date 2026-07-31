-- Migration: 0087_housekeeping.sql
-- Housekeeping Management — cleaning schedules, task tracking, complaints

CREATE TABLE IF NOT EXISTS housekeeping_areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    area_name TEXT NOT NULL,             -- "Ward A", "OT 1", "ICU", "Lobby", "Corridor 2F"
    area_type TEXT DEFAULT 'ward' CHECK(area_type IN ('ward','ot','icu','lobby','corridor','toilet','office','canteen','other')),
    floor TEXT,
    building TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hk_area_tenant ON housekeeping_areas(tenant_id);

CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    task_number TEXT NOT NULL,
    area_id INTEGER,
    area_name TEXT,                       -- denormalized
    task_type TEXT NOT NULL CHECK(task_type IN ('routine','deep_clean','sanitization','spill','post_discharge','pest_control','waste_disposal','other')),
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
    description TEXT,
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT,
    assigned_to TEXT,                    -- staff name
    assigned_to_id INTEGER,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','verified','cancelled')),
    started_at TEXT,
    completed_at TEXT,
    verified_by INTEGER,
    verified_at TEXT,
    quality_rating INTEGER,              -- 1-5
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hk_task_num ON housekeeping_tasks(tenant_id, task_number);
CREATE INDEX IF NOT EXISTS idx_hk_task_tenant ON housekeeping_tasks(tenant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_hk_task_status ON housekeeping_tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_hk_task_area ON housekeeping_tasks(tenant_id, area_id);

CREATE TABLE IF NOT EXISTS housekeeping_complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    complaint_number TEXT NOT NULL,
    area_id INTEGER,
    area_name TEXT,
    reported_by TEXT NOT NULL,
    reported_by_role TEXT,                -- "Nurse", "Doctor", "Patient"
    complaint_type TEXT DEFAULT 'cleanliness' CHECK(complaint_type IN ('cleanliness','pest','odor','waste','damaged','other')),
    description TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
    status TEXT DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','resolved','closed')),
    assigned_to TEXT,
    resolved_at TEXT,
    resolution_notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hk_complaint_num ON housekeeping_complaints(tenant_id, complaint_number);
CREATE INDEX IF NOT EXISTS idx_hk_complaint_tenant ON housekeeping_complaints(tenant_id, status);
