-- Tenant Database Schema (per hospital)
-- This schema is created for each new hospital

-- Patients
CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    father_husband TEXT NOT NULL,
    address TEXT NOT NULL,
    mobile TEXT,
    mobile_missing_reason TEXT
        CHECK (mobile_missing_reason IS NULL OR mobile_missing_reason IN (
            'no_personal_mobile',
            'no_family_mobile',
            'emergency_arrival',
            'patient_refused',
            'will_update_later',
            'other'
        )),
    guardian_mobile TEXT,
    registration_idempotency_key TEXT,
    village TEXT,
    union_name TEXT,
    upazila TEXT,
    district TEXT,
    division TEXT,
    age INTEGER,
    gender TEXT CHECK(gender IN ('male', 'female', 'other')),
    blood_group TEXT,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_tenant_registration_idempotency
    ON patients(tenant_id, registration_idempotency_key)
    WHERE registration_idempotency_key IS NOT NULL
      AND registration_idempotency_key <> '';

-- Serial/Token management
CREATE TABLE IF NOT EXISTS serials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    serial_number TEXT NOT NULL,
    date DATE NOT NULL,
    status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting', 'in-progress', 'completed')),
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- Tests
CREATE TABLE IF NOT EXISTS tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    test_name TEXT NOT NULL,
    result TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- Bills
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    admission_id INTEGER,
    test_bill REAL DEFAULT 0,
    admission_bill REAL DEFAULT 0,
    doctor_visit_bill REAL DEFAULT 0,
    operation_bill REAL DEFAULT 0,
    medicine_bill REAL DEFAULT 0,
    discount REAL DEFAULT 0,
    total REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    due REAL DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    referred_by_type TEXT,
    referred_by_hospital_id INTEGER REFERENCES referral_hospitals(id),
    referred_by_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- Referral hospitals
CREATE TABLE IF NOT EXISTS referral_hospitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    short_code TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_hospitals_tenant_active
    ON referral_hospitals(tenant_id, is_active);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_type TEXT CHECK(payment_type IN ('current', 'due')),
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    tenant_id INTEGER NOT NULL,
    FOREIGN KEY (bill_id) REFERENCES bills(id)
);

-- Income
CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other')),
    amount REAL NOT NULL,
    description TEXT,
    bill_id INTEGER,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (bill_id) REFERENCES bills(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    receipt_key TEXT,
    receipt_status TEXT DEFAULT 'not_uploaded'
      CHECK(receipt_status IN ('not_uploaded', 'uploaded', 'verified', 'rejected')),
    receipt_uploaded_by INTEGER,
    receipt_uploaded_at TEXT,
    receipt_verified_by INTEGER,
    receipt_verified_at TEXT,
    receipt_rejected_by INTEGER,
    receipt_rejected_at TEXT,
    receipt_rejection_reason TEXT,
    payee_name TEXT,
    approval_status TEXT NOT NULL DEFAULT 'approved'
      CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    payment_status TEXT NOT NULL DEFAULT 'paid'
      CHECK (payment_status IN ('unpaid', 'paid', 'void')),
    approval_required INTEGER NOT NULL DEFAULT 0,
    approval_threshold REAL NOT NULL DEFAULT 1000,
    counter_session_id INTEGER REFERENCES billing_counter_sessions(id),
    cash_movement_id INTEGER REFERENCES cash_drawer_movements(id),
    execution_idempotency_key TEXT,
    executed_by INTEGER REFERENCES users(id),
    executed_at TEXT,
    status TEXT DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected')),
    approved_by INTEGER,
    approved_at DATETIME,
    tenant_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (approved_by) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Executive dashboard KPI presentation settings (server-whitelisted metrics only)
CREATE TABLE IF NOT EXISTS dashboard_kpi_config (
    tenant_id TEXT NOT NULL,
    dashboard_key TEXT NOT NULL DEFAULT 'executive',
    metric_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0 AND position <= 100),
    label_override TEXT CHECK (label_override IS NULL OR length(label_override) <= 60),
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
    PRIMARY KEY (tenant_id, dashboard_key, metric_key)
);
CREATE INDEX IF NOT EXISTS idx_dashboard_kpi_config_order
    ON dashboard_kpi_config (tenant_id, dashboard_key, enabled, position, metric_key);

-- Investments
CREATE TABLE IF NOT EXISTS investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Medicines
CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    unit_price REAL NOT NULL,
    quantity INTEGER DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Staff
CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    position TEXT NOT NULL,
    salary REAL NOT NULL,
    bank_account TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT,
    date_of_birth DATE,
    gender TEXT CHECK(gender IN ('Male', 'Female', 'Other')),
    salutation TEXT CHECK(salutation IN ('Mr', 'Mrs', 'Ms', 'Dr')),
    joining_date DATE,
    department TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Salary payments
CREATE TABLE IF NOT EXISTS salary_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_date DATE NOT NULL,
    month TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES staff(id)
);

-- Shareholders
CREATE TABLE IF NOT EXISTS shareholders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    share_count INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('profit', 'owner')),
    investment REAL NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tenant settings
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Profit distributions
CREATE TABLE IF NOT EXISTS profit_distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    total_profit REAL NOT NULL,
    distributable_profit REAL NOT NULL,
    profit_percentage REAL NOT NULL,
    approved_by INTEGER,
    approved_at DATETIME,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'revenue', 'expense', 'equity')),
    parent_id INTEGER,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES chart_of_accounts(id)
);

-- Journal Entries (Double-Entry)
CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date DATE NOT NULL,
    reference TEXT,
    description TEXT,
    debit_account_id INTEGER NOT NULL,
    credit_account_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_deleted INTEGER DEFAULT 0,
    FOREIGN KEY (debit_account_id) REFERENCES chart_of_accounts(id),
    FOREIGN KEY (credit_account_id) REFERENCES chart_of_accounts(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Expense Categories
CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    requires_approval INTEGER DEFAULT 0,
    is_recurring_eligible INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recurring Expenses
CREATE TABLE IF NOT EXISTS recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly')),
    next_run_date DATE NOT NULL,
    end_date DATE,
    is_active INTEGER DEFAULT 1,
    tenant_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES expense_categories(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Income Detail (links income to chart of accounts)
CREATE TABLE IF NOT EXISTS income_detail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    income_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    FOREIGN KEY (income_id) REFERENCES income(id),
    FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN')),
    table_name TEXT NOT NULL,
    record_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Daily Income Summary (for fast dashboard queries)
CREATE TABLE IF NOT EXISTS daily_income_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    source TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_count INTEGER DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Monthly Expense Summary (for fast dashboard queries)
CREATE TABLE IF NOT EXISTS monthly_expense_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year_month TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    transaction_count INTEGER DEFAULT 0,
    tenant_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_patients_mobile ON patients(mobile);
CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tests_patient ON tests(patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id);
CREATE INDEX IF NOT EXISTS idx_income_date ON income(date);
CREATE INDEX IF NOT EXISTS idx_income_source ON income(source);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_shareholders_type ON shareholders(type);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_code ON chart_of_accounts(code);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_type ON chart_of_accounts(type);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_daily_income_summary_date ON daily_income_summary(date);
CREATE INDEX IF NOT EXISTS idx_monthly_expense_summary_month ON monthly_expense_summary(year_month);

-- Local Server Sync Outbox
CREATE TABLE IF NOT EXISTS local_sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete', 'upsert')),
    payload_hash TEXT NOT NULL,
    payload_json TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'exporting', 'exported', 'failed', 'poison')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at DATETIME,
    locked_at DATETIME,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    exported_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_local_sync_outbox_status_next
    ON local_sync_outbox(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_local_sync_outbox_tenant_entity
    ON local_sync_outbox(tenant_id, entity_type, entity_id);

-- Cloud Sync Ingest Ledger
CREATE TABLE IF NOT EXISTS cloud_sync_ingest_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete', 'upsert')),
    payload_hash TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    apply_status TEXT NOT NULL DEFAULT 'metadata_only' CHECK(apply_status IN ('metadata_only', 'applied', 'failed')),
    apply_error TEXT,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_ingest_server_batch
    ON cloud_sync_ingest_events(server_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sync_ingest_tenant_entity
    ON cloud_sync_ingest_events(tenant_id, entity_type, entity_id);
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
-- OT Anesthesia Logs (per booking)
-- Blueprint §28.7: tracks anesthesia delivery during surgery

CREATE TABLE IF NOT EXISTS ot_anesthesia_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    anesthesia_type TEXT NOT NULL
      CHECK(anesthesia_type IN ('general','regional','local','sedation','spinal','epidural','nerve_block','combined','other')),
    anesthetist_id INTEGER,
    start_time TEXT,
    end_time TEXT,
    airway_method TEXT,
    drugs TEXT,
    complications TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (booking_id) REFERENCES ot_bookings(id)
);
CREATE INDEX IF NOT EXISTS idx_ot_anesthesia_booking ON ot_anesthesia_logs(tenant_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_ot_anesthesia_anesthetist ON ot_anesthesia_logs(tenant_id, anesthetist_id);

CREATE TABLE IF NOT EXISTS prescription_medicine_usage_stats (
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  medicine_key TEXT NOT NULL,
  medicine_name TEXT NOT NULL,
  generic_name TEXT,
  strength TEXT,
  dosage_form TEXT,
  manufacturer TEXT,
  default_frequency TEXT,
  default_duration TEXT,
  default_instructions TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  PRIMARY KEY (tenant_id, doctor_id, medicine_key)
);
CREATE INDEX IF NOT EXISTS idx_rx_medicine_usage_rank
  ON prescription_medicine_usage_stats(tenant_id, doctor_id, usage_count DESC, last_used_at DESC);

CREATE TABLE IF NOT EXISTS prescription_lab_test_usage_stats (
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  test_name TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  PRIMARY KEY (tenant_id, doctor_id, test_name)
);
CREATE INDEX IF NOT EXISTS idx_rx_lab_test_usage_rank
  ON prescription_lab_test_usage_stats(tenant_id, doctor_id, usage_count DESC, last_used_at DESC);

CREATE TABLE IF NOT EXISTS local_schema_migrations (
  filename TEXT PRIMARY KEY,
  safety TEXT NOT NULL CHECK(safety IN ('safe', 'destructive')),
  content_hash TEXT NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS local_schema_sync_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  safety TEXT NOT NULL CHECK(safety IN ('destructive')),
  content_hash TEXT NOT NULL,
  sql_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'rejected', 'applied', 'failed')),
  reviewed_by TEXT,
  reviewed_at DATETIME,
  apply_error TEXT,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME
);

CREATE TABLE IF NOT EXISTS local_schema_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT,
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_local_schema_approvals_status
  ON local_schema_sync_approvals(status, detected_at);

CREATE INDEX IF NOT EXISTS idx_local_schema_log_filename
  ON local_schema_sync_log(filename, created_at);

CREATE TABLE IF NOT EXISTS bank_deposit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  request_no TEXT NOT NULL,
  counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  counter_id INTEGER NOT NULL REFERENCES billing_counters(id),
  requested_by INTEGER NOT NULL,
  requested_amount REAL NOT NULL CHECK(requested_amount > 0),
  proposed_bank_name TEXT,
  request_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected','resolved')),
  idempotency_key TEXT NOT NULL,
  cash_movement_id INTEGER REFERENCES cash_drawer_movements(id),
  bank_transaction_id INTEGER REFERENCES bank_transactions(id),
  confirmed_bank_name TEXT,
  confirmed_reference_no TEXT,
  confirmed_date TEXT,
  confirmed_by INTEGER,
  confirmed_at TEXT,
  rejection_reason TEXT,
  rejected_by INTEGER,
  rejected_at TEXT,
  resolution_type TEXT
    CHECK(resolution_type IS NULL OR resolution_type IN ('deposited','returned_to_counter','manual_adjustment')),
  resolution_note TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  UNIQUE(tenant_id, request_no),
  UNIQUE(tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_bank_deposit_requests_status
  ON bank_deposit_requests(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_bank_deposit_requests_session
  ON bank_deposit_requests(tenant_id, counter_session_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposit_requests_requester
  ON bank_deposit_requests(tenant_id, requested_by, created_at);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('deposit','card_settlement','supplier_payment','other')),
  amount REAL NOT NULL DEFAULT 0,
  bank_name TEXT,
  reference_no TEXT,
  description TEXT,
  date TEXT NOT NULL,
  bank_deposit_request_id INTEGER REFERENCES bank_deposit_requests(id),
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_date
  ON bank_transactions(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_tenant_type_date
  ON bank_transactions(tenant_id, type, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transactions_deposit_request
  ON bank_transactions(tenant_id, bank_deposit_request_id)
  WHERE bank_deposit_request_id IS NOT NULL;

-- Doctor-specific IPD round fees and billable round events.
ALTER TABLE doctors ADD COLUMN ipd_round_fee INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ipd_doctor_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  admission_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL,
  rounded_at TEXT NOT NULL,
  doctor_name_snapshot TEXT NOT NULL,
  round_fee_snapshot INTEGER NOT NULL CHECK (round_fee_snapshot > 0),
  entry_source TEXT NOT NULL CHECK (entry_source IN ('nurse_station', 'ipd_billing', 'doctor_dashboard')),
  entered_by INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  provisional_item_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason TEXT,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  clinical_note_id INTEGER,
  clinical_status TEXT NOT NULL DEFAULT 'billing_only'
    CHECK (clinical_status IN ('billing_only', 'documented', 'signed', 'cancelled')),
  signed_by INTEGER,
  signed_at TEXT,
  round_summary TEXT,
  patient_condition TEXT
    CHECK (patient_condition IS NULL OR patient_condition IN ('improving', 'stable', 'deteriorating', 'critical')),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (admission_id) REFERENCES admissions(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  FOREIGN KEY (provisional_item_id) REFERENCES billing_provisional_items(id)
);

CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_admission_time
  ON ipd_doctor_rounds(tenant_id, admission_id, rounded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_doctor_time
  ON ipd_doctor_rounds(tenant_id, doctor_id, rounded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_clinical_status
  ON ipd_doctor_rounds(tenant_id, admission_id, clinical_status);
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_clinical_note
  ON ipd_doctor_rounds(tenant_id, clinical_note_id)
  WHERE clinical_note_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_clinical_signed
  ON ipd_doctor_rounds(tenant_id, doctor_id, signed_at DESC)
  WHERE signed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_condition
  ON ipd_doctor_rounds(tenant_id, patient_condition)
  WHERE patient_condition IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ipd_doctor_rounds_provisional_item
  ON ipd_doctor_rounds(tenant_id, provisional_item_id)
  WHERE provisional_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_provisional_doctor_round_ref
  ON billing_provisional_items(tenant_id, item_category, reference_id)
  WHERE item_category = 'doctor_round' AND reference_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_doctor_round_provisional_cancel_requires_round
BEFORE UPDATE OF bill_status ON billing_provisional_items
WHEN OLD.item_category = 'doctor_round'
  AND NEW.bill_status = 'cancelled'
  AND NOT EXISTS (
    SELECT 1
    FROM ipd_doctor_rounds r
    WHERE r.tenant_id = OLD.tenant_id
      AND r.id = OLD.reference_id
      AND r.status = 'cancelled'
  )
BEGIN
  SELECT RAISE(ABORT, 'Cancel doctor rounds through the doctor-round cancellation workflow');
END;

-- Reception counter cash custody transfers (mirrors migration 0360).
CREATE TABLE IF NOT EXISTS billing_counter_cash_transfers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          TEXT NOT NULL,
  counter_session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  counter_id         INTEGER NOT NULL REFERENCES billing_counters(id),
  transfer_no        TEXT NOT NULL,
  transfer_by        INTEGER NOT NULL,
  transfer_to        INTEGER NOT NULL,
  amount             REAL NOT NULL CHECK(amount > 0),
  received_amount    REAL NOT NULL DEFAULT 0 CHECK(received_amount >= 0),
  due_amount         REAL NOT NULL DEFAULT 0 CHECK(due_amount >= 0),
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','received','partial','disputed','cancelled')),
  destination_type   TEXT NOT NULL DEFAULT 'admin_custody'
    CHECK(destination_type IN ('admin_custody', 'counter_session', 'bank_deposit')),
  destination_counter_id INTEGER REFERENCES billing_counters(id),
  destination_counter_session_id INTEGER REFERENCES billing_counter_sessions(id),
  custody_label      TEXT,
  accepted_cash_movement_id INTEGER REFERENCES cash_drawer_movements(id),
  cancelled_by       INTEGER REFERENCES users(id),
  cancelled_at       TEXT,
  cancel_reason      TEXT,
  note               TEXT,
  receiver_note      TEXT,
  received_by        INTEGER,
  received_at        DATETIME,
  accounting_voucher_id INTEGER REFERENCES accounting_vouchers(id),
  idempotency_key    TEXT,
  created_by         INTEGER,
  created_at         DATETIME DEFAULT (datetime('now', '+6 hours')),
  updated_at         DATETIME DEFAULT (datetime('now', '+6 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_counter_cash_transfers_no
  ON billing_counter_cash_transfers(tenant_id, transfer_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_counter_cash_transfers_idempotency
  ON billing_counter_cash_transfers(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

CREATE INDEX IF NOT EXISTS idx_billing_counter_cash_transfers_session
  ON billing_counter_cash_transfers(tenant_id, counter_session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_billing_counter_cash_transfers_recipient
  ON billing_counter_cash_transfers(tenant_id, transfer_to, status, created_at);

-- Reception shift handover report snapshots (mirrors migration 0365).
CREATE TABLE IF NOT EXISTS shift_handover_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES billing_counter_sessions(id),
  report_no TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'finalized'
    CHECK(status IN ('finalized','accepted','void')),
  generated_by INTEGER NOT NULL REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  finalized_by INTEGER REFERENCES users(id),
  finalized_at TEXT,
  accepted_by INTEGER REFERENCES users(id),
  accepted_at TEXT,
  voided_by INTEGER REFERENCES users(id),
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_handover_reports_session_final
  ON shift_handover_reports(tenant_id, session_id)
  WHERE status IN ('finalized','accepted');

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_handover_reports_no
  ON shift_handover_reports(tenant_id, report_no);

CREATE INDEX IF NOT EXISTS idx_shift_handover_reports_tenant_status
  ON shift_handover_reports(tenant_id, status, generated_at);

-- Reception counter manual cash-out block (mirrors migration 0361).
CREATE TRIGGER IF NOT EXISTS trg_cash_drawer_movements_block_unlinked_cash_out
BEFORE INSERT ON cash_drawer_movements
FOR EACH ROW
WHEN NEW.movement_type = 'cash_out'
  AND (
    NEW.reference_type IS NULL
    OR TRIM(COALESCE(NEW.reference_type, '')) = ''
    OR NEW.reference_type NOT IN (
      'expense',
      'expense_pending',
      'doctor_commission_settlement',
      'patient_refund',
      'patient_deposit_refund',
      'sales_return',
      'credit_note_refund'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Manual drawer cash-out is blocked. Use Expense, Doctor Payout, Refund, Cash Drop/Custody, Bank Deposit, or Handover.');
END;

-- Doctor commission rule and accrual ledgers (current shape through migration 0421).
CREATE TABLE IF NOT EXISTS doctor_commission_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  service_type TEXT NOT NULL CHECK(service_type IN ('lab_test','consultation_fee','referral','procedure','ipd_round')),
  lab_test_id INTEGER,
  category TEXT,
  incentive_type TEXT NOT NULL DEFAULT 'performer'
    CHECK(incentive_type IN ('performer','prescriber','referrer')),
  rate_type TEXT NOT NULL DEFAULT 'percent' CHECK(rate_type IN ('percent','flat')),
  rate_value INTEGER NOT NULL DEFAULT 0,
  waiver_policy TEXT NOT NULL DEFAULT 'full_earned'
    CHECK(waiver_policy IN ('full_earned','protected_floor','no_doctor_waiver')),
  protected_rate_bps INTEGER NOT NULL DEFAULT 0,
  protected_flat_amount REAL NOT NULL DEFAULT 0,
  effective_from TEXT DEFAULT CURRENT_DATE,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_tenant_doctor
  ON doctor_commission_rules(tenant_id, doctor_id, service_type, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_test
  ON doctor_commission_rules(tenant_id, lab_test_id, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_rules_dates
  ON doctor_commission_rules(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_dc_rules_incentive_type
  ON doctor_commission_rules(incentive_type);

CREATE TABLE IF NOT EXISTS doctor_commission_accruals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  patient_id INTEGER,
  visit_id INTEGER,
  bill_id INTEGER,
  lab_order_id INTEGER,
  lab_order_item_id INTEGER,
  lab_test_id INTEGER,
  settlement_id INTEGER,
  source_type TEXT NOT NULL
    CHECK(source_type IN ('lab_test','consultation_fee','referral','procedure','ipd_round')),
  incentive_type TEXT NOT NULL DEFAULT 'performer'
    CHECK(incentive_type IN ('performer','prescriber','referrer')),
  gross_amount INTEGER NOT NULL DEFAULT 0,
  commission_base_amount REAL NOT NULL DEFAULT 0,
  performer_reserve_amount REAL NOT NULL DEFAULT 0,
  performer_reserve_id INTEGER,
  commission_rule_id INTEGER,
  commission_rate_bps INTEGER NOT NULL DEFAULT 0,
  commission_flat_amount INTEGER NOT NULL DEFAULT 0,
  commission_amount INTEGER NOT NULL DEFAULT 0,
  earned_commission_amount REAL NOT NULL DEFAULT 0,
  waiver_policy_snapshot TEXT NOT NULL DEFAULT 'full_earned',
  protected_rate_bps_snapshot INTEGER NOT NULL DEFAULT 0,
  protected_flat_amount_snapshot REAL NOT NULL DEFAULT 0,
  protected_commission_amount REAL NOT NULL DEFAULT 0,
  maximum_waiver_amount REAL NOT NULL DEFAULT 0,
  requested_waiver_amount REAL NOT NULL DEFAULT 0,
  hospital_funded_overflow_amount REAL NOT NULL DEFAULT 0,
  doctor_waiver_amount REAL NOT NULL DEFAULT 0,
  payable_commission_amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  balance_amount REAL NOT NULL DEFAULT 0,
  waiver_reason TEXT,
  waiver_allocation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'accrued'
    CHECK(status IN ('accrued','approved','paid','cancelled')),
  accrued_date TEXT DEFAULT CURRENT_DATE,
  paid_date TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_comm_accruals_lab_unique
  ON doctor_commission_accruals(tenant_id, doctor_id, lab_order_item_id)
  WHERE source_type = 'lab_test' AND lab_order_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_commission_accrual_performer_reserve
  ON doctor_commission_accruals(tenant_id, performer_reserve_id)
  WHERE performer_reserve_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_tenant_status
  ON doctor_commission_accruals(tenant_id, status, accrued_date);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_doctor
  ON doctor_commission_accruals(tenant_id, doctor_id, accrued_date);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_bill
  ON doctor_commission_accruals(tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_dr_comm_accruals_settlement
  ON doctor_commission_accruals(tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_dc_accruals_incentive_type
  ON doctor_commission_accruals(incentive_type);
CREATE INDEX IF NOT EXISTS idx_doctor_comm_accruals_payable_balance
  ON doctor_commission_accruals(tenant_id, doctor_id, status, balance_amount);

-- Reception Cash Operations schema (mirrors migration 0363 for fresh tenant installs).
CREATE TABLE IF NOT EXISTS doctor_commission_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  settlement_date DATE DEFAULT CURRENT_DATE,
  total_amount REAL NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'cash'
    CHECK(payment_mode IN ('cash','bank','cheque','card','mobile_banking','other')),
  reference_no TEXT,
  settlement_no TEXT,
  gross_commission_amount REAL NOT NULL DEFAULT 0,
  advance_deduction REAL NOT NULL DEFAULT 0,
  other_adjustment REAL NOT NULL DEFAULT 0,
  rounding_adjustment REAL NOT NULL DEFAULT 0,
  net_paid_amount REAL NOT NULL DEFAULT 0,
  receiver_type TEXT NOT NULL DEFAULT 'doctor'
    CHECK(receiver_type IN ('doctor', 'assistant', 'representative')),
  receiver_name TEXT,
  receiver_reference TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK(payment_method IN ('cash', 'bank', 'mobile_banking')),
  counter_session_id INTEGER REFERENCES billing_counter_sessions(id),
  counter_id INTEGER REFERENCES billing_counters(id),
  cash_movement_id INTEGER REFERENCES cash_drawer_movements(id),
  attachment_key TEXT,
  idempotency_key TEXT,
  accounting_voucher_id INTEGER REFERENCES accounting_vouchers(id),
  reversed_at TEXT,
  reversed_by INTEGER REFERENCES users(id),
  reversal_reason TEXT,
  reversal_voucher_id INTEGER REFERENCES accounting_vouchers(id),
  notes TEXT,
  voucher_id INTEGER REFERENCES accounting_vouchers(id),
  created_by INTEGER,
  created_at DATETIME DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_dr_comm_settlements_tenant_doctor
  ON doctor_commission_settlements(tenant_id, doctor_id, settlement_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_commission_settlements_no
  ON doctor_commission_settlements(tenant_id, settlement_no)
  WHERE settlement_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_commission_settlements_idempotency
  ON doctor_commission_settlements(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlements_accounting_voucher
  ON doctor_commission_settlements(tenant_id, accounting_voucher_id);
CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlements_reversal
  ON doctor_commission_settlements(tenant_id, reversed_at);

CREATE TABLE IF NOT EXISTS doctor_commission_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  accrual_id INTEGER NOT NULL,
  credit_note_id INTEGER NOT NULL,
  credit_note_item_id INTEGER,
  bill_id INTEGER NOT NULL,
  bill_item_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL
    CHECK (adjustment_type IN ('reversal','clawback')),
  amount REAL NOT NULL CHECK (amount >= 0),
  returned_quantity REAL NOT NULL DEFAULT 0,
  original_quantity REAL NOT NULL DEFAULT 1,
  return_ratio REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded','outstanding','applied','settled','cancelled')),
  settlement_id INTEGER,
  reason TEXT,
  metadata_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, credit_note_id, accrual_id, adjustment_type)
);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_adjustments_doctor_status
  ON doctor_commission_adjustments(tenant_id, doctor_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_doctor_commission_adjustments_credit_note
  ON doctor_commission_adjustments(tenant_id, credit_note_id, bill_item_id);

CREATE TABLE IF NOT EXISTS doctor_commission_adjustment_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  adjustment_id INTEGER NOT NULL,
  settlement_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, adjustment_id, settlement_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_adjustment_applications_adjustment
  ON doctor_commission_adjustment_applications(tenant_id, adjustment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_doctor_commission_adjustment_applications_settlement
  ON doctor_commission_adjustment_applications(tenant_id, settlement_id, created_at);

CREATE TABLE IF NOT EXISTS doctor_commission_settlement_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  settlement_id INTEGER NOT NULL REFERENCES doctor_commission_settlements(id) ON DELETE CASCADE,
  accrual_id INTEGER NOT NULL REFERENCES doctor_commission_accruals(id) ON DELETE RESTRICT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  invoice_id INTEGER,
  bill_id INTEGER,
  patient_id INTEGER,
  service_date TEXT,
  gross_amount REAL NOT NULL DEFAULT 0,
  commission_amount REAL NOT NULL DEFAULT 0,
  calculated_commission_amount REAL,
  override_amount REAL,
  override_reason TEXT,
  overridden_by INTEGER,
  overridden_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, accrual_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlement_items_settlement
  ON doctor_commission_settlement_items(tenant_id, settlement_id);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_settlement_items_doctor_date
  ON doctor_commission_settlement_items(tenant_id, doctor_id, service_date);

-- Test-level performer payout rules and unit reserve ledger (migration 0421).
CREATE TABLE IF NOT EXISTS diagnostic_performer_payout_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  billing_service_item_id INTEGER NOT NULL REFERENCES billing_service_items(id) ON DELETE RESTRICT,
  diagnostic_kind TEXT NOT NULL CHECK (diagnostic_kind IN ('lab', 'radiology')),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('flat', 'percent')),
  rate_value REAL NOT NULL CHECK (rate_value >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  CHECK (effective_to IS NULL OR date(effective_to) >= date(effective_from)),
  CHECK (rate_type != 'percent' OR rate_value <= 10000)
);

CREATE INDEX IF NOT EXISTS idx_diag_performer_rules_lookup
  ON diagnostic_performer_payout_rules(
    tenant_id, billing_service_item_id, is_active, effective_from, effective_to
  );
CREATE INDEX IF NOT EXISTS idx_diag_performer_rules_kind
  ON diagnostic_performer_payout_rules(tenant_id, diagnostic_kind, is_active);

CREATE TABLE IF NOT EXISTS diagnostic_performer_reserves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_id INTEGER NOT NULL REFERENCES diagnostic_performer_payout_rules(id) ON DELETE RESTRICT,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id) ON DELETE RESTRICT,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  billing_service_item_id INTEGER NOT NULL REFERENCES billing_service_items(id) ON DELETE RESTRICT,
  diagnostic_kind TEXT NOT NULL CHECK (diagnostic_kind IN ('lab', 'radiology')),
  lab_test_id INTEGER REFERENCES lab_test_catalog(id) ON DELETE SET NULL,
  radiology_imaging_item_id INTEGER REFERENCES radiology_imaging_items(id) ON DELETE SET NULL,
  test_code TEXT,
  test_name TEXT NOT NULL,
  unit_sequence INTEGER NOT NULL CHECK (unit_sequence > 0),
  unit_service_amount REAL NOT NULL CHECK (unit_service_amount >= 0),
  unit_discount_amount REAL NOT NULL DEFAULT 0 CHECK (unit_discount_amount >= 0),
  net_unit_service_amount REAL NOT NULL CHECK (net_unit_service_amount >= 0),
  rule_rate_type TEXT NOT NULL CHECK (rule_rate_type IN ('flat', 'percent')),
  rule_rate_value REAL NOT NULL CHECK (rule_rate_value >= 0),
  reserved_amount REAL NOT NULL CHECK (reserved_amount >= 0),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'paid', 'cancelled', 'reversed')),
  assigned_doctor_id INTEGER REFERENCES doctors(id) ON DELETE RESTRICT,
  commission_accrual_id INTEGER REFERENCES doctor_commission_accruals(id) ON DELETE RESTRICT,
  settlement_id INTEGER REFERENCES doctor_commission_settlements(id) ON DELETE RESTRICT,
  reserved_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  paid_at TEXT,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  reversed_at TEXT,
  reversed_by INTEGER REFERENCES users(id),
  cancel_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, invoice_item_id, unit_sequence)
);

CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_status
  ON diagnostic_performer_reserves(tenant_id, status, reserved_at);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_service
  ON diagnostic_performer_reserves(tenant_id, billing_service_item_id, status, reserved_at);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_bill
  ON diagnostic_performer_reserves(tenant_id, bill_id, invoice_item_id);
CREATE INDEX IF NOT EXISTS idx_diag_performer_reserves_settlement
  ON diagnostic_performer_reserves(tenant_id, settlement_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_diag_performer_reserve_accrual
  ON diagnostic_performer_reserves(tenant_id, commission_accrual_id)
  WHERE commission_accrual_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_drawer_accepted_transfer_once
  ON cash_drawer_movements(tenant_id, reference_type, reference_id, movement_type)
  WHERE reference_type = 'accepted_cash_transfer' AND movement_type = 'cash_in';

CREATE TABLE IF NOT EXISTS cash_operation_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  petty_cash_auto_approve_limit REAL NOT NULL DEFAULT 1000,
  receipt_required_limit REAL NOT NULL DEFAULT 1000,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  receipt_key TEXT,
  receipt_status TEXT DEFAULT 'not_uploaded',
  receipt_uploaded_by INTEGER,
  receipt_uploaded_at TEXT,
  receipt_verified_by INTEGER,
  receipt_verified_at TEXT,
  receipt_rejected_by INTEGER,
  receipt_rejected_at TEXT,
  receipt_rejection_reason TEXT,
  payee_name TEXT,
  approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  payment_status TEXT NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('unpaid', 'paid', 'void')),
  approval_required INTEGER NOT NULL DEFAULT 0,
  approval_threshold REAL NOT NULL DEFAULT 1000,
  counter_session_id INTEGER REFERENCES billing_counter_sessions(id),
  cash_movement_id INTEGER REFERENCES cash_drawer_movements(id),
  execution_idempotency_key TEXT,
  executed_by INTEGER REFERENCES users(id),
  executed_at TEXT,
  status TEXT DEFAULT 'approved',
  approved_by INTEGER REFERENCES users(id),
  approved_at DATETIME,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_execution_idempotency
  ON expenses(tenant_id, execution_idempotency_key)
  WHERE execution_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_approval_payment_status
  ON expenses(tenant_id, approval_status, payment_status, date);

CREATE TABLE IF NOT EXISTS bill_discount_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  bill_item_id INTEGER,
  settlement_id INTEGER,
  allocation_type TEXT NOT NULL,
  discount_reason TEXT NOT NULL DEFAULT 'normal_hospital_discount',
  doctor_id INTEGER,
  amount REAL NOT NULL DEFAULT 0,
  percent REAL,
  reference_name TEXT,
  approval_status TEXT NOT NULL DEFAULT 'recorded',
  approved_by INTEGER,
  note TEXT,
  metadata_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours'))
);

CREATE INDEX IF NOT EXISTS idx_bill_discount_allocations_bill
  ON bill_discount_allocations(tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_discount_allocations_settlement
  ON bill_discount_allocations(tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_bill_discount_allocations_doctor
  ON bill_discount_allocations(tenant_id, doctor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bill_discount_allocations_type_date
  ON bill_discount_allocations(tenant_id, allocation_type, created_at);

CREATE TRIGGER IF NOT EXISTS trg_cash_drawer_movements_no_negative_cash_out
BEFORE INSERT ON cash_drawer_movements
WHEN NEW.movement_type IN ('cash_out', 'cash_drop', 'handover')
BEGIN
  SELECT CASE
    WHEN (
      COALESCE((
        SELECT SUM(CASE
          WHEN movement_type IN ('cash_in', 'opening') THEN amount
          WHEN movement_type IN ('cash_out', 'cash_drop', 'handover') THEN -amount
          ELSE 0
        END)
        FROM cash_drawer_movements
        WHERE tenant_id = NEW.tenant_id
          AND counter_session_id = NEW.counter_session_id
      ), 0) - NEW.amount
    ) < 0
    THEN RAISE(ABORT, 'INSUFFICIENT_DRAWER_CASH')
  END;
END;

CREATE TABLE IF NOT EXISTS lab_inventory_policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL UNIQUE,
  lab_inventory_mode TEXT NOT NULL DEFAULT 'soft' CHECK(lab_inventory_mode IN ('disabled','soft','strict')),
  reagent_consumption_timing TEXT NOT NULL DEFAULT 'billing' CHECK (reagent_consumption_timing IN ('billing', 'result')),
  allow_result_without_stock INTEGER NOT NULL DEFAULT 1 CHECK(allow_result_without_stock IN (0,1)),
  require_test_mapping_for_completion INTEGER NOT NULL DEFAULT 0 CHECK(require_test_mapping_for_completion IN (0,1)),
  updated_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_inventory_policy_tenant ON lab_inventory_policy(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_inventory_policy_mode ON lab_inventory_policy(tenant_id, lab_inventory_mode);

CREATE TABLE IF NOT EXISTS lab_consumable_consumption_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  lab_order_id INTEGER,
  lab_test_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_no INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_consumable_claim_once
  ON lab_consumable_consumption_claims(tenant_id, reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_lab_consumable_claim_order
  ON lab_consumable_consumption_claims(tenant_id, lab_order_id);
CREATE INDEX IF NOT EXISTS idx_lab_consumable_claim_status
  ON lab_consumable_consumption_claims(tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS lab_inventory_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lab_order_id INTEGER,
  lab_order_item_id INTEGER,
  lab_test_id INTEGER,
  consumable_id INTEGER,
  source_event TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error' CHECK(severity IN ('warning','error')),
  reason TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
  created_by TEXT,
  resolved_by TEXT,
  resolved_at DATETIME,
  resolution_remarks TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_occurred_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lab_inventory_exceptions_open
  ON lab_inventory_exceptions(tenant_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_inventory_exception_open_unique
  ON lab_inventory_exceptions(
    tenant_id,
    source_event,
    COALESCE(lab_order_item_id, -1),
    COALESCE(consumable_id, -1),
    reason
  )
  WHERE status = 'open';

-- Durable lab-item cancellation orchestration (mirrors migration 0411).
CREATE TABLE IF NOT EXISTS lab_cancellation_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lab_order_item_id INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing', 'core_completed', 'completed', 'failed')),
  skip_invoice_update INTEGER NOT NULL DEFAULT 0,
  bill_id INTEGER,
  lab_order_id INTEGER NOT NULL,
  cancelled_amount REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  notes TEXT,
  last_error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(tenant_id, lab_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_cancellation_operation_status
  ON lab_cancellation_operations(tenant_id, status, updated_at);

-- Durable operational cash reservations for approval-based bill refunds (mirrors migration 0421).
CREATE TABLE IF NOT EXISTS billing_refund_cash_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method = 'cash'),
  employee_id INTEGER NOT NULL,
  counter_id INTEGER NOT NULL,
  counter_session_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'consumed', 'released')),
  idempotency_key TEXT NOT NULL,
  credit_note_id INTEGER,
  held_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  consumed_at TEXT,
  released_at TEXT,
  resolved_by INTEGER,
  resolution_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_request_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_refund_holds_tenant_status
  ON billing_refund_cash_holds(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_refund_holds_counter_session
  ON billing_refund_cash_holds(tenant_id, counter_session_id, status);
CREATE INDEX IF NOT EXISTS idx_refund_holds_bill_status
  ON billing_refund_cash_holds(tenant_id, bill_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_hold_bill_held
  ON billing_refund_cash_holds(tenant_id, bill_id)
  WHERE status = 'held';

CREATE TRIGGER IF NOT EXISTS trg_refund_hold_validate_before_insert
BEFORE INSERT ON billing_refund_cash_holds
WHEN NEW.status = 'held'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM billing_counter_sessions s
      WHERE s.tenant_id = NEW.tenant_id
        AND s.id = NEW.counter_session_id
        AND s.employee_id = NEW.employee_id
        AND s.counter_id = NEW.counter_id
        AND s.status = 'active'
    )
    THEN RAISE(ABORT, 'refund hold requires active originating counter session')
  END;

  SELECT CASE
    WHEN NEW.amount > COALESCE((
      SELECT
        COALESCE(s.opening_cash, 0)
        + COALESCE((
          SELECT SUM(CASE
            WHEN ect.payment_method = 'cash'
             AND ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
            THEN ect.amount
            WHEN ect.payment_method = 'cash'
             AND ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
            THEN -ect.amount
            ELSE 0
          END)
          FROM emp_cash_transactions ect
          WHERE ect.tenant_id = s.tenant_id
            AND ect.counter_session_id = s.id
        ), 0)
        + COALESCE((
          SELECT SUM(CASE
            WHEN cdm.movement_type = 'cash_in' THEN cdm.amount
            WHEN cdm.movement_type IN ('cash_out', 'cash_drop') THEN -cdm.amount
            ELSE 0
          END)
          FROM cash_drawer_movements cdm
          WHERE cdm.tenant_id = s.tenant_id
            AND cdm.counter_session_id = s.id
        ), 0)
        - COALESCE((
          SELECT SUM(existing.amount)
          FROM billing_refund_cash_holds existing
          WHERE existing.tenant_id = s.tenant_id
            AND existing.counter_session_id = s.id
            AND existing.status = 'held'
        ), 0)
      FROM billing_counter_sessions s
      WHERE s.tenant_id = NEW.tenant_id
        AND s.id = NEW.counter_session_id
        AND s.employee_id = NEW.employee_id
        AND s.counter_id = NEW.counter_id
        AND s.status = 'active'
    ), 0)
    THEN RAISE(ABORT, 'insufficient counter cash for refund hold')
  END;
END;

-- Executed-pending payment void accountability state (mirrors migration 0536).
CREATE TABLE IF NOT EXISTS billing_payment_void_disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_request_id INTEGER NOT NULL,
  payment_id INTEGER NOT NULL,
  bill_id INTEGER NOT NULL,
  reversal_payment_id INTEGER,
  reversal_receipt_no TEXT NOT NULL,
  requester_user_id INTEGER NOT NULL,
  accountable_employee_id INTEGER NOT NULL,
  counter_id INTEGER,
  counter_session_id INTEGER,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','written_off')),
  rejection_reason TEXT NOT NULL,
  rejected_by INTEGER NOT NULL,
  rejected_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  resolved_by INTEGER,
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_request_id),
  UNIQUE (tenant_id, payment_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_void_disputes_tenant_status
  ON billing_payment_void_disputes(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_void_disputes_employee_status
  ON billing_payment_void_disputes(tenant_id, accountable_employee_id, status, created_at);

-- One-time, tenant-scoped password reset tokens for hospital staff accounts.
CREATE TABLE IF NOT EXISTS staff_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staff_password_resets_token
  ON staff_password_resets(token_hash, used_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_staff_password_resets_user_active
  ON staff_password_resets(tenant_id, user_id, used_at, expires_at);

-- Patient duplicate merge safety and rollback baseline.
CREATE TABLE IF NOT EXISTS patient_merge_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  primary_patient_id INTEGER NOT NULL,
  merged_patient_id INTEGER NOT NULL,
  merged_data TEXT,
  tables_updated TEXT,
  merge_reason TEXT,
  merged_by INTEGER NOT NULL,
  merged_at TEXT DEFAULT (datetime('now')),
  confirmation_token_hash TEXT,
  request_hash TEXT,
  rows_moved_json TEXT,
  applied_by INTEGER,
  applied_at TEXT,
  is_unmerged INTEGER NOT NULL DEFAULT 0,
  unmerged_by INTEGER,
  unmerged_at TEXT,
  unmerge_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_merge_tenant ON patient_merge_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_merge_primary ON patient_merge_log(primary_patient_id);

CREATE TABLE IF NOT EXISTS patient_merge_confirmation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  confirmation_token_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  primary_patient_id INTEGER NOT NULL,
  secondary_patient_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'applied', 'expired', 'revoked')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  applied_at TEXT,
  applied_merge_log_id INTEGER,
  UNIQUE(tenant_id, request_hash)
);
CREATE INDEX IF NOT EXISTS idx_merge_confirm_tenant
  ON patient_merge_confirmation(tenant_id, status);

CREATE TABLE IF NOT EXISTS patient_merge_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  merge_log_id INTEGER,
  action TEXT NOT NULL,
  primary_patient_id INTEGER,
  secondary_patient_id INTEGER,
  confirmation_token_hash TEXT,
  payload_json TEXT,
  result_json TEXT,
  actor_user_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_merge_audit_tenant_log
  ON patient_merge_audit(tenant_id, merge_log_id);

CREATE TABLE IF NOT EXISTS patient_merge_record_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merge_log_id INTEGER NOT NULL REFERENCES patient_merge_log(id),
  tenant_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL DEFAULT 'patient_id',
  record_id INTEGER NOT NULL,
  original_patient_id INTEGER NOT NULL,
  target_patient_id INTEGER NOT NULL,
  moved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_merge_record_map_log
  ON patient_merge_record_map(merge_log_id);
CREATE INDEX IF NOT EXISTS idx_merge_record_map_record
  ON patient_merge_record_map(table_name, column_name, record_id);
CREATE INDEX IF NOT EXISTS idx_merge_record_map_tenant
  ON patient_merge_record_map(tenant_id, original_patient_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_map_unique_record
  ON patient_merge_record_map(merge_log_id, table_name, column_name, record_id);

-- Tenant-scoped MFA registrations (mirrors repair migration 0552).
CREATE TABLE IF NOT EXISTS mfa_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  mfa_type TEXT NOT NULL DEFAULT 'totp' CHECK (mfa_type IN ('totp', 'u2f')),
  secret TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  recovery_codes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_user
  ON mfa_registrations(tenant_id, user_id, mfa_type);

CREATE INDEX IF NOT EXISTS idx_mfa_tenant
  ON mfa_registrations(tenant_id);

-- Password-bound, tenant-scoped MFA login challenges (mirrors migration 0417).
CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  challenge_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mfa_login_challenges_active
  ON mfa_login_challenges(tenant_id, user_id, expires_at)
  WHERE consumed_at IS NULL;

-- Tenant-scoped one-time staff authentication sessions (mirrors migration 0418).
CREATE TABLE IF NOT EXISTS staff_auth_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'rotated', 'revoked')),
  expires_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_auth_sessions_active
  ON staff_auth_sessions(tenant_id, user_id, status, expires_at);
