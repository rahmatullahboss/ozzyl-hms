-- Migration: 0009_prescriptions_unique_rxno.sql
-- Adds UNIQUE constraint on (rx_no, tenant_id) as a safety net for concurrent writes

CREATE UNIQUE INDEX IF NOT EXISTS idx_prescriptions_rxno_unique ON prescriptions(rx_no, tenant_id);
