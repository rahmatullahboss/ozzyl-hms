-- Migration: 0239_pharmacy_invoice_counter_session.sql
-- Description: Link pharmacy invoices to active billing/pharmacy counter sessions for cash reconciliation.

ALTER TABLE pharmacy_invoices ADD COLUMN counter_session_id INTEGER REFERENCES billing_counter_sessions(id);

CREATE INDEX IF NOT EXISTS idx_pharm_invoice_counter_session
  ON pharmacy_invoices(tenant_id, counter_session_id);
