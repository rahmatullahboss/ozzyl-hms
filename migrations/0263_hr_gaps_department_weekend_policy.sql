-- Migration: 0263_hr_gaps_department_weekend_policy.sql
-- Adds department field to staff, weekend policy table, leave carry-forward support

-- 1. ADD DEPARTMENT TO STAFF
ALTER TABLE staff ADD COLUMN department TEXT;

-- 2. WEEKEND POLICY (per-year, per-day configuration like DanpheEMR)
CREATE TABLE IF NOT EXISTS hr_weekend_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    day_of_week TEXT NOT NULL CHECK(day_of_week IN ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),
    week_pattern TEXT NOT NULL DEFAULT 'every' CHECK(week_pattern IN ('every','first','second','third','fourth','first_and_third','second_and_fourth')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, year, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_hr_weekend_policy_tenant ON hr_weekend_policies(tenant_id, year);

-- 3. LEAVE CARRY-FORWARD TRACKING
ALTER TABLE hr_employee_leave_balances ADD COLUMN carry_forward REAL NOT NULL DEFAULT 0;

-- 4. OVERTIME PAYROLL INTEGRATION
ALTER TABLE hr_payslips ADD COLUMN overtime_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE hr_payslips ADD COLUMN overtime_hours REAL NOT NULL DEFAULT 0;
