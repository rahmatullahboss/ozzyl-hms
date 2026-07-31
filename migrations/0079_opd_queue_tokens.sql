-- Migration: 0079_opd_queue_tokens.sql
-- OPD Queue/Token System with Display Board Support

-- ═══════════════════════════════════════════════════════════════════════
-- 1. TOKEN COUNTER (auto-increment per department per day)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS queue_token_counters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    department_id INTEGER,
    counter_date TEXT NOT NULL,           -- YYYY-MM-DD
    last_token INTEGER NOT NULL DEFAULT 0,
    prefix TEXT DEFAULT 'T',             -- e.g. "T" → T001, T002
    UNIQUE(tenant_id, department_id, counter_date)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. QUEUE ENTRIES (extends visits with queue-specific fields)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS queue_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    visit_id INTEGER,
    patient_id INTEGER NOT NULL,
    department_id INTEGER,
    doctor_id INTEGER,
    token_no TEXT NOT NULL,              -- "T001", "E003" etc.
    token_number INTEGER NOT NULL,       -- numeric part for sorting
    queue_date TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('normal','urgent','emergency','vip')),
    status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','serving','called','no_show','completed','cancelled','transferred')),
    check_in_time TEXT,
    called_at TEXT,                      -- when doctor pressed "call next"
    serve_start_time TEXT,               -- when patient entered doctor room
    serve_end_time TEXT,                 -- when consultation finished
    counter_no TEXT,                     -- which counter/room "Room 3", "Counter A"
    called_by INTEGER,                   -- staff who called
    estimated_wait_minutes INTEGER,
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (visit_id) REFERENCES visits(id)
);
CREATE INDEX IF NOT EXISTS idx_queue_entry_tenant ON queue_entries(tenant_id, queue_date);
CREATE INDEX IF NOT EXISTS idx_queue_entry_dept ON queue_entries(tenant_id, department_id, queue_date, status);
CREATE INDEX IF NOT EXISTS idx_queue_entry_doctor ON queue_entries(tenant_id, doctor_id, queue_date);
CREATE INDEX IF NOT EXISTS idx_queue_entry_status ON queue_entries(status);
CREATE INDEX IF NOT EXISTS idx_queue_entry_token ON queue_entries(tenant_id, token_no, queue_date);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. DISPLAY BOARD CONFIGURATION
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS queue_display_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    display_name TEXT NOT NULL,          -- "Main OPD Display", "Floor 2 TV"
    department_ids TEXT,                 -- JSON array of dept IDs to show, NULL = all
    show_doctor_name INTEGER DEFAULT 1,
    show_estimated_wait INTEGER DEFAULT 1,
    show_token_count INTEGER DEFAULT 1,
    announcement_text TEXT,              -- scrolling text at bottom
    refresh_seconds INTEGER DEFAULT 10,
    theme TEXT DEFAULT 'default' CHECK(theme IN ('default','dark','hospital_brand')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_queue_display_tenant ON queue_display_config(tenant_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. QUEUE ANNOUNCEMENTS (audio call history)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS queue_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    queue_entry_id INTEGER NOT NULL,
    token_no TEXT NOT NULL,
    patient_name TEXT,
    counter_no TEXT,
    doctor_name TEXT,
    announced_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (queue_entry_id) REFERENCES queue_entries(id)
);
CREATE INDEX IF NOT EXISTS idx_queue_announce_tenant ON queue_announcements(tenant_id, announced_at);
