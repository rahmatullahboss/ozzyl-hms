-- Migration: 0293_ot_blueprint_foundation.sql
-- Implements the OT Module foundation per docs/ot-blueptint.md
-- (the approved blueprint). This migration is additive and does NOT
-- break existing ot_bookings / ot_team_members / ot_checklist_items /
-- ot_summaries / ot_surgery_notes / ot_anesthesia_records / ot_status_events.
--
-- Key design decision: AI Overview from the blueprint is implemented as
-- a *Programmatic* Overview (see src/services/ot/programmatic-overview.ts)
-- to satisfy the "no LLM in clinical decisions" safety rule.
--
-- Sections:
--   1. Expand ot_bookings -> ot_cases fields (additive, safe)
--   2. Expand ot_team_members -> ot_team_assignments fields
--   3. New tables from blueprint section 28
--   4. Settings / configuration tables
--   5. Performance indexes

-- ============================================================
-- 1. Expand ot_bookings with blueprint case fields
-- ============================================================
ALTER TABLE ot_bookings ADD COLUMN admission_id INTEGER;
ALTER TABLE ot_bookings ADD COLUMN department_id INTEGER;
ALTER TABLE ot_bookings ADD COLUMN requested_by_doctor_id INTEGER;
ALTER TABLE ot_bookings ADD COLUMN procedure_id INTEGER;
ALTER TABLE ot_bookings ADD COLUMN priority TEXT DEFAULT 'elective'
  CHECK(priority IN ('elective','urgent','emergency','high_risk'));
ALTER TABLE ot_bookings ADD COLUMN surgery_category TEXT;
ALTER TABLE ot_bookings ADD COLUMN estimated_duration_minutes INTEGER;
ALTER TABLE ot_bookings ADD COLUMN blood_required INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN icu_required INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN special_equipment TEXT;
ALTER TABLE ot_bookings ADD COLUMN implant_required INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN estimated_package_charge REAL DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN room_id INTEGER;
ALTER TABLE ot_bookings ADD COLUMN chief_surgeon_id INTEGER;
ALTER TABLE ot_bookings ADD COLUMN anesthetist_id INTEGER;
ALTER TABLE ot_bookings ADD COLUMN scheduled_start TEXT;
ALTER TABLE ot_bookings ADD COLUMN scheduled_end TEXT;
ALTER TABLE ot_bookings ADD COLUMN is_emergency INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN emergency_reason TEXT;
ALTER TABLE ot_bookings ADD COLUMN request_status TEXT DEFAULT 'requested'
  CHECK(request_status IN ('requested','pending_clearance','approved','rejected','postponed','cancelled'));
ALTER TABLE ot_bookings ADD COLUMN postpone_reason TEXT;
ALTER TABLE ot_bookings ADD COLUMN cancel_reason TEXT;
ALTER TABLE ot_bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE ot_bookings ADD COLUMN received_at TEXT;
ALTER TABLE ot_bookings ADD COLUMN received_by INTEGER;
ALTER TABLE ot_bookings ADD COLUMN received_from TEXT;
ALTER TABLE ot_bookings ADD COLUMN identity_verified INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN wristband_checked INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN allergy_checked INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN npo_checked INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN last_vitals_checked_at TEXT;
ALTER TABLE ot_bookings ADD COLUMN case_locked INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN case_locked_by INTEGER;
ALTER TABLE ot_bookings ADD COLUMN case_locked_at TEXT;
ALTER TABLE ot_bookings ADD COLUMN delay_minutes INTEGER DEFAULT 0;
ALTER TABLE ot_bookings ADD COLUMN delay_reason TEXT;

-- ============================================================
-- 2. Expand ot_team_members with blueprint assignment fields
-- ============================================================
ALTER TABLE ot_team_members ADD COLUMN role TEXT;
ALTER TABLE ot_team_members ADD COLUMN assigned_by INTEGER;
ALTER TABLE ot_team_members ADD COLUMN locked_at TEXT;
ALTER TABLE ot_team_members ADD COLUMN locked_by INTEGER;
ALTER TABLE ot_team_members ADD COLUMN unlock_reason TEXT;

-- ============================================================
-- 3. New tables from blueprint
-- ============================================================

-- 3.1 OT Rooms
CREATE TABLE IF NOT EXISTS ot_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    room_code TEXT,
    floor TEXT,
    room_type TEXT DEFAULT 'general'
      CHECK(room_type IN ('general','cardiac','neuro','ortho','ophthalmic','emergency','laparoscopic','minor')),
    status TEXT DEFAULT 'available'
      CHECK(status IN ('available','occupied','cleaning','sterilization','maintenance','blocked')),
    cleaning_duration_minutes INTEGER DEFAULT 30,
    sterilization_duration_minutes INTEGER DEFAULT 45,
    available_from TEXT,
    available_to TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ot_rooms_tenant ON ot_rooms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ot_rooms_status ON ot_rooms(tenant_id, status, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ot_rooms_tenant_name ON ot_rooms(tenant_id, name);

-- 3.2 OT Clearance Checks (pre-OT readiness)
CREATE TABLE IF NOT EXISTS ot_clearance_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    check_type TEXT NOT NULL,
    is_required INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending'
      CHECK(status IN ('pending','done','rejected','waived','not_required')),
    verified_by INTEGER,
    verified_at TEXT,
    attachment_url TEXT,
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_clearance_booking ON ot_clearance_checks(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_clearance_type ON ot_clearance_checks(tenant_id, check_type);
CREATE INDEX IF NOT EXISTS idx_ot_clearance_status ON ot_clearance_checks(tenant_id, booking_id, status);

-- 3.3 OT Consents
CREATE TABLE IF NOT EXISTS ot_consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    consent_type TEXT NOT NULL
      CHECK(consent_type IN ('general_surgery','anesthesia','high_risk','blood_transfusion','c_section','minor_guardian','laparoscopic','icu','other')),
    guardian_name TEXT,
    guardian_relation TEXT,
    guardian_phone TEXT,
    witness_name TEXT,
    doctor_id INTEGER,
    status TEXT DEFAULT 'pending'
      CHECK(status IN ('not_required','pending','uploaded','signed','verified','rejected')),
    file_url TEXT,
    file_key TEXT,
    signed_at TEXT,
    verified_by INTEGER,
    verified_at TEXT,
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_consents_booking ON ot_consents(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_consents_status ON ot_consents(tenant_id, booking_id, status);

-- 3.4 OT Safety Checklists (Sign-In / Time-Out / Sign-Out)
-- Replaces ad-hoc ot_checklist_items with section-based structure
CREATE TABLE IF NOT EXISTS ot_safety_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    section TEXT NOT NULL
      CHECK(section IN ('sign_in','time_out','sign_out','pre_ot','handover')),
    item_name TEXT NOT NULL,
    item_value INTEGER DEFAULT 0,
    item_details TEXT,
    is_required INTEGER DEFAULT 1,
    checked_by INTEGER,
    checked_at TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_safety_booking ON ot_safety_checklists(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_safety_section ON ot_safety_checklists(tenant_id, booking_id, section);

-- 3.5 OT Vitals (intra-operative time-series)
CREATE TABLE IF NOT EXISTS ot_vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    bp_systolic INTEGER,
    bp_diastolic INTEGER,
    pulse INTEGER,
    spo2 INTEGER,
    respiration INTEGER,
    temperature REAL,
    blood_sugar REAL,
    urine_output_ml INTEGER,
    fluid_input_ml INTEGER,
    blood_loss_ml INTEGER,
    remarks TEXT,
    recorded_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_vitals_booking ON ot_vitals(tenant_id, booking_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_ot_vitals_patient ON ot_vitals(tenant_id, patient_id, recorded_at DESC);

-- 3.6 OT Inventory Consumptions (drug cart + consumables)
CREATE TABLE IF NOT EXISTS ot_inventory_consumptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    batch_id INTEGER,
    qty_issued REAL DEFAULT 0,
    qty_used REAL DEFAULT 0,
    qty_returned REAL DEFAULT 0,
    qty_wasted REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    source TEXT DEFAULT 'ot_sub_store'
      CHECK(source IN ('ot_sub_store','central_pharmacy','central_store','cssd','emergency_cart','department_stock','patient_brought')),
    is_billable INTEGER DEFAULT 1,
    status TEXT DEFAULT 'issued'
      CHECK(status IN ('issued','used','returned','wasted','billed','cancelled')),
    issued_by INTEGER,
    used_by INTEGER,
    returned_by INTEGER,
    issued_at TEXT,
    used_at TEXT,
    returned_at TEXT,
    bill_id INTEGER,
    visit_service_id INTEGER,
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_inventory_booking ON ot_inventory_consumptions(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_inventory_item ON ot_inventory_consumptions(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_ot_inventory_status ON ot_inventory_consumptions(tenant_id, booking_id, status);

-- 3.7 OT Bills (header)
CREATE TABLE IF NOT EXISTS ot_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL,
    visit_id INTEGER,
    admission_id INTEGER,
    gross_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    net_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'draft'
      CHECK(status IN ('draft','pending_review','posted','locked','cancelled')),
    posted_to_ipd_bill_id INTEGER,
    posted_by INTEGER,
    posted_at TEXT,
    locked_by INTEGER,
    locked_at TEXT,
    unlock_reason TEXT,
    review_notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_bills_tenant ON ot_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ot_bills_booking ON ot_bills(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_bills_status ON ot_bills(tenant_id, status, posted_at);
CREATE INDEX IF NOT EXISTS idx_ot_bills_patient ON ot_bills(tenant_id, patient_id);

-- 3.8 OT Bill Items (line items with charge heads)
CREATE TABLE IF NOT EXISTS ot_bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    ot_bill_id INTEGER NOT NULL,
    charge_head TEXT NOT NULL
      CHECK(charge_head IN ('ot_room','surgery','surgeon_fee','assistant_surgeon_fee','anesthesia','anesthetist_fee','ot_nurse_service','equipment','consumables','medicines','implant','cssd','recovery','emergency_surcharge','misc')),
    item_id INTEGER,
    inventory_consumption_id INTEGER,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    total REAL DEFAULT 0,
    doctor_id INTEGER,
    is_commissionable INTEGER DEFAULT 1,
    is_billable INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (ot_bill_id) REFERENCES ot_bills(id),
    FOREIGN KEY (inventory_consumption_id) REFERENCES ot_inventory_consumptions(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_bill_items_bill ON ot_bill_items(tenant_id, ot_bill_id);
CREATE INDEX IF NOT EXISTS idx_ot_bill_items_charge_head ON ot_bill_items(tenant_id, charge_head);
CREATE INDEX IF NOT EXISTS idx_ot_bill_items_doctor ON ot_bill_items(tenant_id, doctor_id, is_commissionable);

-- 3.9 OT Commissions (surgeon/anesthetist share)
CREATE TABLE IF NOT EXISTS ot_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    ot_bill_id INTEGER,
    doctor_id INTEGER NOT NULL,
    role TEXT NOT NULL
      CHECK(role IN ('chief_surgeon','assistant_surgeon','anesthetist','anesthetist_assistant')),
    gross_amount REAL DEFAULT 0,
    commission_rule TEXT,
    commission_percent REAL DEFAULT 0,
    commission_amount REAL DEFAULT 0,
    deduction REAL DEFAULT 0,
    net_payable REAL DEFAULT 0,
    status TEXT DEFAULT 'pending'
      CHECK(status IN ('pending','approved','paid','rejected')),
    approved_by INTEGER,
    approved_at TEXT,
    paid_at TEXT,
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id),
    FOREIGN KEY (ot_bill_id) REFERENCES ot_bills(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_commissions_doctor ON ot_commissions(tenant_id, doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_ot_commissions_booking ON ot_commissions(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_commissions_status ON ot_commissions(tenant_id, status, created_at);

-- 3.10 OT Recovery Handovers
CREATE TABLE IF NOT EXISTS ot_recovery_handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL,
    shifted_to TEXT NOT NULL
      CHECK(shifted_to IN ('recovery','ward','icu','pacu','home','discharged')),
    shift_time TEXT NOT NULL,
    consciousness_level TEXT,
    bp TEXT,
    pulse INTEGER,
    spo2 INTEGER,
    pain_score INTEGER,
    drain_status TEXT,
    catheter_status TEXT,
    oxygen_support TEXT,
    post_op_medicine TEXT,
    post_op_instruction TEXT,
    handover_by INTEGER,
    received_by INTEGER,
    received_at TEXT,
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_recovery_booking ON ot_recovery_handovers(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_recovery_shift ON ot_recovery_handovers(tenant_id, shifted_to, shift_time);

-- 3.11 OT Audit Logs (detailed, separate from status events)
CREATE TABLE IF NOT EXISTS ot_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    user_role TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    ip_address TEXT,
    device_info TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_audit_booking ON ot_audit_logs(tenant_id, booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ot_audit_user ON ot_audit_logs(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ot_audit_action ON ot_audit_logs(tenant_id, action, created_at DESC);

-- 3.12 OT Delay Records
CREATE TABLE IF NOT EXISTS ot_delay_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    delay_type TEXT NOT NULL
      CHECK(delay_type IN ('scheduled_to_actual','consent','surgeon','anesthetist','cleaning','patient_transfer','payment_clearance','equipment','blood_arrangement','other')),
    scheduled_time TEXT,
    actual_time TEXT,
    delay_minutes INTEGER NOT NULL,
    reason TEXT,
    responsible_department TEXT,
    reported_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_delay_booking ON ot_delay_records(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_delay_type ON ot_delay_records(tenant_id, delay_type, created_at DESC);

-- ============================================================
-- 4. Settings / configuration tables
-- ============================================================

-- 4.1 OT Procedures (catalog)
CREATE TABLE IF NOT EXISTS ot_procedures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    department_id INTEGER,
    default_duration_minutes INTEGER DEFAULT 60,
    default_charge REAL DEFAULT 0,
    default_anesthesia_type TEXT,
    required_equipment TEXT,
    required_ot_pack_id INTEGER,
    high_risk_flag INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ot_procedures_tenant ON ot_procedures(tenant_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ot_procedures_tenant_name ON ot_procedures(tenant_id, name);

-- 4.2 OT Charge Heads (rules for charge calculation)
CREATE TABLE IF NOT EXISTS ot_charge_heads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    charge_head TEXT NOT NULL,
    name TEXT NOT NULL,
    calculation_type TEXT DEFAULT 'fixed'
      CHECK(calculation_type IN ('fixed','per_hour','percentage','package','dynamic')),
    default_amount REAL DEFAULT 0,
    is_commissionable INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ot_charge_heads_tenant ON ot_charge_heads(tenant_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ot_charge_heads_tenant_head ON ot_charge_heads(tenant_id, charge_head);

-- 4.3 OT Packs (predefined inventory sets)
CREATE TABLE IF NOT EXISTS ot_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    procedure_id INTEGER,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (procedure_id) REFERENCES ot_procedures(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_packs_tenant ON ot_packs(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS ot_pack_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    pack_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    default_quantity REAL DEFAULT 1,
    is_billable INTEGER DEFAULT 1,
    is_required INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (pack_id) REFERENCES ot_packs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ot_pack_items_pack ON ot_pack_items(tenant_id, pack_id);

-- 4.4 OT Note Templates (quick-pick for surgeons)
CREATE TABLE IF NOT EXISTS ot_note_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    procedure_id INTEGER,
    section TEXT NOT NULL
      CHECK(section IN ('operative_findings','procedure_steps','complications','specimen','drain','closure','post_op_plan','final_note')),
    template_text TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (procedure_id) REFERENCES ot_procedures(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_note_templates_tenant ON ot_note_templates(tenant_id, section, is_active);

-- 4.5 OT Settings (per-tenant config)
CREATE TABLE IF NOT EXISTS ot_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL UNIQUE,
    default_cleaning_minutes INTEGER DEFAULT 30,
    default_sterilization_minutes INTEGER DEFAULT 45,
    vitals_reminder_minutes INTEGER DEFAULT 5,
    emergency_override_allowed INTEGER DEFAULT 1,
    hard_block_on_consent INTEGER DEFAULT 1,
    hard_block_on_anesthesia_fitness INTEGER DEFAULT 1,
    hard_block_on_payment INTEGER DEFAULT 0,
    hard_block_on_blood INTEGER DEFAULT 0,
    bill_post_requires_review INTEGER DEFAULT 1,
    commission_calculation_enabled INTEGER DEFAULT 1,
    auto_deduct_stock_on_post INTEGER DEFAULT 1,
    offline_draft_enabled INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

-- 4.6 Commission Rules (settings)
CREATE TABLE IF NOT EXISTS ot_commission_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    rule_type TEXT NOT NULL
      CHECK(rule_type IN ('fixed_amount','percentage_of_surgery','percentage_after_discount','package_based','department_based','doctor_based')),
    amount REAL DEFAULT 0,
    percent REAL DEFAULT 0,
    procedure_id INTEGER,
    department_id INTEGER,
    doctor_id INTEGER,
    include_emergency_surcharge INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ot_commission_rules_tenant ON ot_commission_rules(tenant_id, role, is_active, priority DESC);

-- ============================================================
-- 5. Performance indexes for hot paths
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ot_bookings_room ON ot_bookings(tenant_id, room_id, booked_for_date);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_status ON ot_bookings(tenant_id, operation_status, booked_for_date);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_priority ON ot_bookings(tenant_id, priority, is_emergency, booked_for_date);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_case_status ON ot_bookings(tenant_id, request_status, booked_for_date);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_surgeon ON ot_bookings(tenant_id, chief_surgeon_id, booked_for_date);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_anesthetist ON ot_bookings(tenant_id, anesthetist_id, booked_for_date);
CREATE INDEX IF NOT EXISTS idx_ot_bookings_locked ON ot_bookings(tenant_id, case_locked, booked_for_date);
