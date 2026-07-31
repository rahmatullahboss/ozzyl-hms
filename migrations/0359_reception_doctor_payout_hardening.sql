-- Migration: 0359_reception_doctor_payout_hardening.sql
-- Description: Hardens reception doctor payout settlement references.

CREATE UNIQUE INDEX IF NOT EXISTS idx_dr_comm_settlements_tenant_reference_no
  ON doctor_commission_settlements(tenant_id, reference_no)
  WHERE reference_no IS NOT NULL AND reference_no != '';

CREATE INDEX IF NOT EXISTS idx_cash_drawer_movements_doctor_payout
  ON cash_drawer_movements(tenant_id, reference_type, reference_id, counter_session_id)
  WHERE reference_type = 'doctor_commission_settlement';
