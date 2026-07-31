-- Migration: 0201_accounting_posting_core.sql
-- Description: Danphe-style accounting posting outbox, voucher headers, journal lines, and COA mappings.

CREATE TABLE IF NOT EXISTS accounting_vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  fiscal_year_id INTEGER NOT NULL,
  voucher_type_id INTEGER NOT NULL,
  voucher_number TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'verified' CHECK(status IN ('pending', 'verified', 'rejected', 'voided')),
  reversal_of_voucher_id INTEGER,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  UNIQUE(tenant_id, voucher_number),
  UNIQUE(tenant_id, source_event_key),
  FOREIGN KEY (fiscal_year_id) REFERENCES fiscal_years(id),
  FOREIGN KEY (voucher_type_id) REFERENCES voucher_types(id),
  FOREIGN KEY (reversal_of_voucher_id) REFERENCES accounting_vouchers(id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_tenant_date
  ON accounting_vouchers(tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_source
  ON accounting_vouchers(tenant_id, source_type, source_id, event_type);

CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  voucher_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  debit_amount REAL NOT NULL DEFAULT 0 CHECK(debit_amount >= 0),
  credit_amount REAL NOT NULL DEFAULT 0 CHECK(credit_amount >= 0),
  memo TEXT,
  line_no INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  CHECK((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)),
  UNIQUE(voucher_id, line_no),
  FOREIGN KEY (voucher_id) REFERENCES accounting_vouchers(id),
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_lines_tenant_account
  ON accounting_journal_lines(tenant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_accounting_lines_voucher
  ON accounting_journal_lines(voucher_id);

CREATE TABLE IF NOT EXISTS accounting_posting_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  source_event_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'bill_created',
    'bill_cancelled',
    'payment_received',
    'patient_deposit_received',
    'patient_deposit_adjusted',
    'patient_deposit_refunded',
    'commission_accrued',
    'commission_cancelled',
    'commission_settled'
  )),
  event_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'posted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  posted_voucher_id INTEGER,
  posted_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  UNIQUE(tenant_id, source_event_key),
  FOREIGN KEY (posted_voucher_id) REFERENCES accounting_vouchers(id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_posting_events_status
  ON accounting_posting_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_accounting_posting_events_source
  ON accounting_posting_events(tenant_id, source_type, source_id, event_type);

CREATE TABLE IF NOT EXISTS accounting_account_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  mapping_key TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  UNIQUE(tenant_id, mapping_key),
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_account_mappings_account
  ON accounting_account_mappings(account_id);

-- Standard voucher types needed by automated GL posting.
WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM bills
),
voucher_defaults(code, name) AS (
  VALUES
    ('JV', 'Journal Voucher'),
    ('RCPT', 'Receipt Voucher'),
    ('PMTV', 'Payment Voucher')
)
INSERT OR IGNORE INTO voucher_types (tenant_id, code, name, allow_verification)
SELECT tenant_id, code, name, 1
FROM tenant_source
CROSS JOIN voucher_defaults;

-- Danphe-grade HMS finance accounts. These are inserted only when a tenant lacks the code.
WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM bills
),
default_accounts(code, name, type) AS (
  VALUES
    ('7000', 'Cash', 'asset'),
    ('7100', 'Bank / Mobile Wallet', 'asset'),
    ('7200', 'Accounts Receivable - Patients', 'asset'),
    ('4000', 'Pharmacy Revenue', 'revenue'),
    ('4100', 'Laboratory Revenue', 'revenue'),
    ('4200', 'Doctor Visit Revenue', 'revenue'),
    ('4300', 'Admission Revenue', 'revenue'),
    ('4400', 'Operation Revenue', 'revenue'),
    ('4600', 'Other Patient Revenue', 'revenue'),
    ('5850', 'Doctor Commission Expense', 'expense'),
    ('5950', 'Discount Allowed', 'expense'),
    ('8250', 'Patient Deposit Liability', 'liability'),
    ('8300', 'Doctor Commission Payable', 'liability')
)
INSERT INTO chart_of_accounts (code, name, type, tenant_id)
SELECT
  a.code,
  a.name,
  a.type,
  COALESCE((SELECT tenant_id FROM chart_of_accounts LIMIT 1), (SELECT MIN(tenant_id) FROM tenant_source))
FROM default_accounts a
WHERE NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.code = a.code
);

-- Semantic mappings let operational modules post without hard-coding account ids.
WITH tenant_source AS (
  SELECT DISTINCT tenant_id FROM fiscal_years
  UNION
  SELECT DISTINCT tenant_id FROM chart_of_accounts
  UNION
  SELECT DISTINCT tenant_id FROM bills
),
mapping_defaults(mapping_key, account_code) AS (
  VALUES
    ('cash', '7000'),
    ('bank', '7100'),
    ('accounts_receivable', '7200'),
    ('pharmacy_revenue', '4000'),
    ('lab_revenue', '4100'),
    ('doctor_visit_revenue', '4200'),
    ('admission_revenue', '4300'),
    ('operation_revenue', '4400'),
    ('other_revenue', '4600'),
    ('doctor_commission_expense', '5850'),
    ('discount_allowed', '5950'),
    ('patient_deposit_liability', '8250'),
    ('doctor_commission_payable', '8300')
)
INSERT OR IGNORE INTO accounting_account_mappings (tenant_id, mapping_key, account_id)
SELECT ts.tenant_id, md.mapping_key, coa.id
FROM tenant_source ts
JOIN mapping_defaults md
JOIN chart_of_accounts coa
  ON coa.code = md.account_code
  AND coa.is_active = 1
WHERE ts.tenant_id IS NOT NULL;
