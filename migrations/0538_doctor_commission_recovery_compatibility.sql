-- Migration: 0538_doctor_commission_recovery_compatibility.sql
-- Description: Formalise the existing doctor commission recovery obligation and application ledger.
-- Safety: Idempotent for production databases where these tables already exist. Does not restore abandoned accrual identity columns.

CREATE TABLE IF NOT EXISTS doctor_commission_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  accrual_id INTEGER NOT NULL,
  credit_note_id INTEGER NOT NULL,
  credit_note_item_id INTEGER,
  bill_id INTEGER NOT NULL,
  bill_item_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL
    CHECK (adjustment_type IN ('reversal','clawback')),
  amount REAL NOT NULL CHECK (amount >= 0),
  returned_quantity REAL NOT NULL DEFAULT 0,
  original_quantity REAL NOT NULL DEFAULT 1,
  return_ratio REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded','outstanding','applied','settled','cancelled')),
  settlement_id INTEGER,
  reason TEXT,
  metadata_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, credit_note_id, accrual_id, adjustment_type)
);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_adjustments_doctor_status
  ON doctor_commission_adjustments(tenant_id, doctor_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_adjustments_credit_note
  ON doctor_commission_adjustments(tenant_id, credit_note_id, bill_item_id);

CREATE TABLE IF NOT EXISTS doctor_commission_adjustment_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  adjustment_id INTEGER NOT NULL,
  settlement_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, adjustment_id, settlement_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_adjustment_applications_adjustment
  ON doctor_commission_adjustment_applications(tenant_id, adjustment_id, created_at);

CREATE INDEX IF NOT EXISTS idx_doctor_commission_adjustment_applications_settlement
  ON doctor_commission_adjustment_applications(tenant_id, settlement_id, created_at);

-- Balanced recovery settlement posting requires dedicated adjustment accounts and
-- an alias to the already-provisioned 7210 receivable used in production.
WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM doctor_commission_adjustments
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM doctor_commission_settlements
), required_accounts(code, name, type) AS (
  VALUES
    ('5855', 'Doctor Settlement Adjustment', 'expense'),
    ('5992', 'Rounding Adjustment', 'expense')
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id, is_active)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM chart_of_accounts existing WHERE existing.code = account.code)
      THEN account.code || '-T' || tenant.tenant_id
    WHEN tenant.tenant_id = (SELECT MIN(tenant_id) FROM tenant_source)
      THEN account.code
    ELSE account.code || '-T' || tenant.tenant_id
  END,
  account.name,
  account.type,
  tenant.tenant_id,
  1
FROM tenant_source tenant
CROSS JOIN required_accounts account
WHERE NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts existing
  WHERE CAST(existing.tenant_id AS TEXT) = tenant.tenant_id
    AND (existing.code = account.code OR existing.code = account.code || '-T' || tenant.tenant_id)
);

WITH tenant_source AS (
  SELECT CAST(id AS TEXT) AS tenant_id FROM tenants
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM doctor_commission_adjustments
  UNION
  SELECT DISTINCT CAST(tenant_id AS TEXT) FROM doctor_commission_settlements
), required_mappings(mapping_key, account_code) AS (
  VALUES
    ('doctor_advance_receivable', '7210'),
    ('doctor_settlement_adjustment', '5855'),
    ('rounding_adjustment', '5992')
), candidate_accounts AS (
  SELECT
    tenant.tenant_id,
    mapping.mapping_key,
    account.id AS account_id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant.tenant_id, mapping.mapping_key
      ORDER BY CASE WHEN account.code = mapping.account_code THEN 0 ELSE 1 END, account.id
    ) AS rn
  FROM tenant_source tenant
  CROSS JOIN required_mappings mapping
  JOIN chart_of_accounts account
    ON CAST(account.tenant_id AS TEXT) = tenant.tenant_id
   AND COALESCE(account.is_active, 1) = 1
   AND (account.code = mapping.account_code OR account.code = mapping.account_code || '-T' || tenant.tenant_id)
)
INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active)
SELECT tenant_id, mapping_key, account_id, 1
FROM candidate_accounts
WHERE rn = 1
ON CONFLICT(tenant_id, mapping_key) DO UPDATE SET
  account_id = excluded.account_id,
  is_active = 1,
  updated_at = datetime('now', '+6 hours');
