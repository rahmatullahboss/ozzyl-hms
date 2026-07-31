-- Migration: Operation Theatre Module
-- Ported from danphe-next-cloudflare (0011_operation_theatre.sql)
-- Adapted for HMS SaaS multi-tenant pattern (tenant_id, snake_case)

-- ============================================================
-- OT Booking Details (main booking record)
-- ============================================================
CREATE TABLE IF NOT EXISTS ot_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER,
    booked_for_date TEXT NOT NULL,
    surgery_type TEXT,
    diagnosis TEXT,
    procedure_type TEXT,
    anesthesia_type TEXT,
    remarks TEXT,
    consent_form_path TEXT,
    pac_form_path TEXT,
    cancellation_remarks TEXT,
    cancelled_by INTEGER,
    cancelled_on TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (visit_id) REFERENCES visits(id)
);

-- ============================================================
-- OT Team Members (surgeon, anesthetist, nurse, assistant)
-- ============================================================
CREATE TABLE IF NOT EXISTS ot_team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER,
    staff_id INTEGER NOT NULL,
    role_type TEXT NOT NULL,  -- surgeon, anesthetist, anesthetist_assistant, scrub_nurse, ot_assistant
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (visit_id) REFERENCES visits(id),
    FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- ============================================================
-- Pre-Op Safety Checklist
-- ============================================================
CREATE TABLE IF NOT EXISTS ot_checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    item_value INTEGER DEFAULT 0,
    item_details TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);

-- ============================================================
-- Post-Op Summary
-- ============================================================
CREATE TABLE IF NOT EXISTS ot_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    team_member_id INTEGER,
    pre_op_diagnosis TEXT,
    post_op_diagnosis TEXT,
    anesthesia TEXT,
    ot_charge REAL DEFAULT 0,
    ot_description TEXT,
    category TEXT,
    nurse_signature TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id),
    FOREIGN KEY (team_member_id) REFERENCES ot_team_members(id)
);

-- ============================================================
-- Performance Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ot_bookings_tenant ON ot_bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_patient ON ot_bookings(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_date ON ot_bookings(tenant_id, booked_for_date);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_active_date ON ot_bookings(tenant_id, is_active, booked_for_date);

CREATE INDEX IF NOT EXISTS idx_ot_team_booking ON ot_team_members(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_team_staff ON ot_team_members(tenant_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_ot_team_role ON ot_team_members(tenant_id, role_type);

CREATE INDEX IF NOT EXISTS idx_ot_checklist_booking ON ot_checklist_items(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_summaries_booking ON ot_summaries(tenant_id, booking_id);
