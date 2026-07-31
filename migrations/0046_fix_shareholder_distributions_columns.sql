-- Migration 0046: Add missing columns to shareholder_distributions
-- The backend INSERT references gross_dividend, tax_deducted, net_payable
-- but the production table was created from 0001 (older schema) which lacks these.

ALTER TABLE shareholder_distributions ADD COLUMN gross_dividend REAL DEFAULT 0;
ALTER TABLE shareholder_distributions ADD COLUMN tax_deducted REAL DEFAULT 0;
ALTER TABLE shareholder_distributions ADD COLUMN net_payable REAL DEFAULT 0;
