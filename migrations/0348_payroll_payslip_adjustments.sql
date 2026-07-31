-- Migration: 0348_payroll_payslip_adjustments.sql
-- Audit trail for per-payslip net pay overrides applied during draft review.

CREATE TABLE IF NOT EXISTS hr_payslip_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    payslip_id INTEGER NOT NULL,
    payroll_run_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    old_net_pay REAL NOT NULL CHECK (old_net_pay >= 0),
    new_net_pay REAL NOT NULL CHECK (new_net_pay >= 0),
    reason TEXT NOT NULL CHECK (length(reason) <= 500),
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (payslip_id) REFERENCES hr_payslips(id),
    FOREIGN KEY (payroll_run_id) REFERENCES hr_payroll_runs(id),
    FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE INDEX IF NOT EXISTS idx_hr_payslip_adj_payslip
  ON hr_payslip_adjustments(payslip_id);
CREATE INDEX IF NOT EXISTS idx_hr_payslip_adj_run
  ON hr_payslip_adjustments(payroll_run_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_hr_payslip_adj_tenant_created
  ON hr_payslip_adjustments(tenant_id, created_at DESC);
