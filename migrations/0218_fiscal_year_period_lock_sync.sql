-- Migration: 0218_fiscal_year_period_lock_sync.sql
-- Description: Keep fiscal-year close/reopen behavior aligned with accounting period locks.
--
-- Production note: run after taking the normal D1 backup/export. This backfills
-- monthly accounting_period_closes rows for fiscal years that were already
-- marked closed before the route started synchronizing the lock table.

CREATE INDEX IF NOT EXISTS idx_accounting_period_closes_tenant_period
  ON accounting_period_closes(tenant_id, period_name, status);

WITH RECURSIVE closed_periods AS (
  SELECT
    tenant_id,
    id AS fiscal_year_id,
    substr(start_date, 1, 7) AS period_name,
    substr(end_date, 1, 7) AS end_period,
    COALESCE(CAST(created_by AS TEXT), 'system') AS closed_by
  FROM fiscal_years
  WHERE is_closed = 1

  UNION ALL

  SELECT
    tenant_id,
    fiscal_year_id,
    strftime('%Y-%m', date(period_name || '-01', '+1 month')) AS period_name,
    end_period,
    closed_by
  FROM closed_periods
  WHERE period_name < end_period
)
INSERT OR IGNORE INTO accounting_period_closes
  (tenant_id, fiscal_year_id, period_name, close_date, closed_at, closed_by, status)
SELECT
  tenant_id,
  fiscal_year_id,
  period_name,
  date(period_name || '-01', 'start of month', '+1 month', '-1 day') AS close_date,
  datetime('now', '+6 hours') AS closed_at,
  closed_by,
  'closed' AS status
FROM closed_periods;

WITH RECURSIVE closed_periods AS (
  SELECT
    tenant_id,
    id AS fiscal_year_id,
    substr(start_date, 1, 7) AS period_name,
    substr(end_date, 1, 7) AS end_period,
    COALESCE(CAST(created_by AS TEXT), 'system') AS closed_by
  FROM fiscal_years
  WHERE is_closed = 1

  UNION ALL

  SELECT
    tenant_id,
    fiscal_year_id,
    strftime('%Y-%m', date(period_name || '-01', '+1 month')) AS period_name,
    end_period,
    closed_by
  FROM closed_periods
  WHERE period_name < end_period
)
UPDATE accounting_period_closes
SET status = 'closed',
    closed_at = datetime('now', '+6 hours'),
    closed_by = COALESCE(
      (SELECT cp.closed_by
       FROM closed_periods cp
       WHERE cp.tenant_id = accounting_period_closes.tenant_id
         AND cp.fiscal_year_id = accounting_period_closes.fiscal_year_id
         AND cp.period_name = accounting_period_closes.period_name),
      closed_by
    )
WHERE status = 'open'
  AND EXISTS (
    SELECT 1
    FROM closed_periods cp
    WHERE cp.tenant_id = accounting_period_closes.tenant_id
      AND cp.fiscal_year_id = accounting_period_closes.fiscal_year_id
      AND cp.period_name = accounting_period_closes.period_name
  );
