-- Migration: 0203_accounting_journal_line_dimensions.sql
-- Description: Adds sub-ledger dimensions to accounting journal lines for reconciliation.

ALTER TABLE accounting_journal_lines ADD COLUMN patient_id INTEGER;
ALTER TABLE accounting_journal_lines ADD COLUMN doctor_id INTEGER;
ALTER TABLE accounting_journal_lines ADD COLUMN supplier_id INTEGER;
ALTER TABLE accounting_journal_lines ADD COLUMN department_id INTEGER;
ALTER TABLE accounting_journal_lines ADD COLUMN branch_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_accounting_lines_patient
  ON accounting_journal_lines(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_doctor
  ON accounting_journal_lines(tenant_id, doctor_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_supplier
  ON accounting_journal_lines(tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_branch
  ON accounting_journal_lines(tenant_id, branch_id);
