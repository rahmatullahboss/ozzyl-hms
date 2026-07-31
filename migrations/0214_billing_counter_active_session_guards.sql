-- Danphe-style counter drawers must be exclusive while active.
-- Before adding partial unique guards, close older duplicates defensively and
-- keep the newest active row per cashier and per counter.

WITH ranked_by_employee AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, employee_id
      ORDER BY opened_at DESC, id DESC
    ) AS rn
  FROM billing_counter_sessions
  WHERE status = 'active'
)
UPDATE billing_counter_sessions
SET status = 'closed',
    closed_at = COALESCE(closed_at, datetime('now', '+6 hours')),
    remarks = COALESCE(remarks, 'Auto-closed by migration 0214: duplicate active cashier session'),
    updated_at = datetime('now', '+6 hours')
WHERE id IN (SELECT id FROM ranked_by_employee WHERE rn > 1);

WITH ranked_by_counter AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, counter_id
      ORDER BY opened_at DESC, id DESC
    ) AS rn
  FROM billing_counter_sessions
  WHERE status = 'active'
)
UPDATE billing_counter_sessions
SET status = 'closed',
    closed_at = COALESCE(closed_at, datetime('now', '+6 hours')),
    remarks = COALESCE(remarks, 'Auto-closed by migration 0214: duplicate active counter session'),
    updated_at = datetime('now', '+6 hours')
WHERE id IN (SELECT id FROM ranked_by_counter WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_counter_sessions_active_employee
  ON billing_counter_sessions (tenant_id, employee_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_counter_sessions_active_counter
  ON billing_counter_sessions (tenant_id, counter_id)
  WHERE status = 'active';
