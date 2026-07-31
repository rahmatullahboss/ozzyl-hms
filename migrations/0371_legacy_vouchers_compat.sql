-- Compatibility shim for legacy foreign keys that still reference `vouchers(id)`.
-- The accounting source of truth is `accounting_vouchers`; this table exists only
-- so older FK columns such as doctor_commission_settlements.voucher_id do not fail.

CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT,
  voucher_number TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours'))
);

INSERT OR IGNORE INTO vouchers (id, tenant_id, voucher_number, created_at)
SELECT id, tenant_id, voucher_number, created_at
FROM accounting_vouchers;

CREATE TRIGGER IF NOT EXISTS trg_accounting_vouchers_legacy_vouchers_insert
AFTER INSERT ON accounting_vouchers
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO vouchers (id, tenant_id, voucher_number, created_at)
  VALUES (NEW.id, NEW.tenant_id, NEW.voucher_number, COALESCE(NEW.created_at, datetime('now', '+6 hours')));
END;
