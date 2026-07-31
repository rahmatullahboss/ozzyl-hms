-- Migration: 0376_billing_counter_non_cash_settlement.sql
-- Purpose: Store non-cash settlement snapshots captured during billing counter shift close.

ALTER TABLE billing_counter_sessions ADD COLUMN non_cash_settlement_json TEXT;
ALTER TABLE billing_counter_sessions ADD COLUMN non_cash_remarks TEXT;
