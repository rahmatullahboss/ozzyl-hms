-- Migration: 0049_hr_module.sql
-- HR / Payroll / Leave / Attendance Module
-- Ported from danphe-next, adapted for Ozzyl multi-tenant (tenant_id scoping)

-- ═══════════════════════════════════════════════════════════════════════
-- 1. LEAVE MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_leave_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    leave_name TEXT NOT NULL,
    description TEXT,
    max_days_per_year INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_cat_tenant ON hr_leave_categories(tenant_id);

CREATE TABLE IF NOT EXISTS hr_employee_leave_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    leave_category_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    total_allowed REAL NOT NULL DEFAULT 0,
    used REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (leave_category_id) REFERENCES hr_leave_categories(id),
    UNIQUE(tenant_id, staff_id, leave_category_id, year)
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_bal_staff ON hr_employee_leave_balances(tenant_id, staff_id, year);

CREATE TABLE IF NOT EXISTS hr_leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    leave_category_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    total_days REAL NOT NULL DEFAULT 1,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_by INTEGER,
    approved_on TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (leave_category_id) REFERENCES hr_leave_categories(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_leave_req_staff ON hr_leave_requests(tenant_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_hr_leave_req_status ON hr_leave_requests(tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. ATTENDANCE & SHIFTS
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    shift_name TEXT NOT NULL,
    start_time TEXT NOT NULL,  -- HH:mm
    end_time TEXT NOT NULL,    -- HH:mm
    grace_period INTEGER DEFAULT 0,  -- minutes
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_shifts_tenant ON hr_shifts(tenant_id);

CREATE TABLE IF NOT EXISTS hr_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    check_in TEXT,
    check_out TEXT,
    shift_id INTEGER,
    status TEXT DEFAULT 'present' CHECK(status IN ('present', 'absent', 'late', 'leave', 'half_day')),
    remarks TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (shift_id) REFERENCES hr_shifts(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_staff ON hr_attendance(tenant_id, staff_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_attendance_unique ON hr_attendance(tenant_id, staff_id, date);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PAYROLL SYSTEM
-- ═══════════════════════════════════════════════════════════════════════

-- Salary heads (Basic, HRA, Medical, Transport, PF Deduction, Tax, etc.)
CREATE TABLE IF NOT EXISTS hr_salary_heads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    head_name TEXT NOT NULL,
    head_type TEXT NOT NULL CHECK(head_type IN ('earning', 'deduction')),
    is_taxable INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_salary_heads_tenant ON hr_salary_heads(tenant_id);

-- Per-staff salary structure (which heads apply and amounts)
CREATE TABLE IF NOT EXISTS hr_staff_salary_structure (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    salary_head_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    calculation_type TEXT DEFAULT 'fixed' CHECK(calculation_type IN ('fixed', 'percentage')),
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (staff_id) REFERENCES staff(id),
    FOREIGN KEY (salary_head_id) REFERENCES hr_salary_heads(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_salary_struct_staff ON hr_staff_salary_structure(tenant_id, staff_id);

-- Payroll runs (monthly batch: DRAFT → LOCKED → APPROVED)
CREATE TABLE IF NOT EXISTS hr_payroll_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    run_month TEXT NOT NULL,  -- YYYY-MM
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'locked', 'approved', 'cancelled')),
    total_employees INTEGER DEFAULT 0,
    total_gross REAL DEFAULT 0,
    total_deductions REAL DEFAULT 0,
    total_net REAL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    locked_by INTEGER,
    locked_on TEXT,
    approved_by INTEGER,
    approved_on TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_payroll_run_month ON hr_payroll_runs(tenant_id, run_month);

-- Per-employee payslip within a payroll run
CREATE TABLE IF NOT EXISTS hr_payslips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    payroll_run_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    month TEXT NOT NULL,       -- YYYY-MM
    total_earning REAL NOT NULL DEFAULT 0,
    total_deduction REAL NOT NULL DEFAULT 0,
    net_pay REAL NOT NULL DEFAULT 0,
    payment_method TEXT,
    payment_reference TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'held')),
    breakdown_json TEXT,      -- JSON: { components: [{ head, type, amount }] }
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (payroll_run_id) REFERENCES hr_payroll_runs(id),
    FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_hr_payslips_run ON hr_payslips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_hr_payslips_staff ON hr_payslips(tenant_id, staff_id, month);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SEED DEFAULT LEAVE CATEGORIES & SALARY HEADS (per-tenant, done via app)
-- ═══════════════════════════════════════════════════════════════════════
-- Note: Seeds are NOT in migration; they are applied per-tenant via onboarding.

-- ═══════════════════════════════════════════════════════════════════════
-- 5. PERFORMANCE INDEXES
-- ═══════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_hr_leave_req_dates ON hr_leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_hr_attendance_date ON hr_attendance(date);
CREATE INDEX IF NOT EXISTS idx_hr_payslips_month ON hr_payslips(month);
