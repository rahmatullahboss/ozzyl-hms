-- Migration: 0212_default_accounting_fiscal_year.sql
-- Description: Ensure each tenant with operational finance data has an active open accounting fiscal year.
--
-- This keeps the centralized accounting posting engine usable after upgrading
-- legacy tenants that had billing_fiscal_years but no accounting fiscal_years.
-- Hospitals should still review and configure their real fiscal-year calendar.

WITH tenant_source AS (
  SELECT DISTINCT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM bills
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM chart_of_accounts
),
current_calendar AS (
  SELECT
    strftime('%Y', 'now') AS year,
    date(strftime('%Y', 'now') || '-01-01') AS start_date,
    date(strftime('%Y', 'now') || '-12-31') AS end_date
)
INSERT OR IGNORE INTO fiscal_years (
  tenant_id, fiscal_year_name, start_date, end_date, prefix,
  insurance_prefix, pharmacy_prefix, is_active, is_closed, created_by
)
SELECT
  ts.tenant_id,
  'FY' || cc.year,
  cc.start_date,
  cc.end_date,
  'BL',
  'INS',
  'PHR',
  1,
  0,
  NULL
FROM tenant_source ts
CROSS JOIN current_calendar cc
WHERE ts.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM fiscal_years fy
    WHERE fy.tenant_id = ts.tenant_id
      AND fy.is_active = 1
      AND fy.is_closed = 0
      AND fy.start_date <= date('now')
      AND fy.end_date >= date('now')
  );
