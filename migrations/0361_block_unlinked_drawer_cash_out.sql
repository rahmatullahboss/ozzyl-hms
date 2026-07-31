-- Migration: 0361_block_unlinked_drawer_cash_out.sql
-- Description: Blocks generic/unlinked cash-out drawer movements so reception cash leaves only through controlled workflows.

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
