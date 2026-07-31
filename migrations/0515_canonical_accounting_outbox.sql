-- Canonical accounting outbox consumer, immutable balanced vouchers, and cash custody authority.
-- Triggerless for remote D1/Wrangler compatibility. Cross-row integrity is enforced by
-- same-batch exact guards in the canonical accounting poster.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_accounting_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  account_public_id TEXT NOT NULL,
  account_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  normal_balance TEXT NOT NULL,
  parent_account_public_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(account_code))>0),
  CHECK (length(trim(display_name))>0),
  CHECK (account_type IN ('asset','liability','equity','revenue','contra_revenue','expense','contra_expense','other')),
  CHECK (normal_balance IN ('debit','credit')),
  CHECK (status IN ('active','inactive','retired')),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,parent_account_public_id)
    REFERENCES canonical_accounting_accounts(tenant_id,account_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,account_public_id),
  UNIQUE (tenant_id,account_code)
);
CREATE INDEX IF NOT EXISTS idx_canonical_accounting_accounts_type
  ON canonical_accounting_accounts(tenant_id,account_type,status,account_code);

CREATE TABLE IF NOT EXISTS canonical_accounting_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  mapping_key TEXT NOT NULL,
  account_public_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(mapping_key))>0),
  CHECK (status IN ('active','inactive','retired')),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,account_public_id)
    REFERENCES canonical_accounting_accounts(tenant_id,account_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,mapping_key)
);
CREATE INDEX IF NOT EXISTS idx_canonical_accounting_mappings_account
  ON canonical_accounting_mappings(tenant_id,account_public_id,status);

CREATE TABLE IF NOT EXISTS canonical_accounting_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  period_public_id TEXT NOT NULL,
  period_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at_utc TEXT,
  closed_by_public_id TEXT,
  reopened_at_utc TEXT,
  reopened_by_public_id TEXT,
  reopen_authorization_public_id TEXT,
  reopen_reason_code TEXT,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(period_name))>0),
  CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (end_date>=start_date),
  CHECK (status IN ('open','closed','reopened')),
  CHECK (closed_at_utc IS NULL OR substr(closed_at_utc,-1)='Z'),
  CHECK (reopened_at_utc IS NULL OR substr(reopened_at_utc,-1)='Z'),
  CHECK (
    (status='open' AND closed_at_utc IS NULL AND closed_by_public_id IS NULL
      AND reopened_at_utc IS NULL AND reopened_by_public_id IS NULL
      AND reopen_authorization_public_id IS NULL AND reopen_reason_code IS NULL)
    OR (status='closed' AND closed_at_utc IS NOT NULL AND closed_by_public_id IS NOT NULL
      AND reopened_at_utc IS NULL AND reopened_by_public_id IS NULL
      AND reopen_authorization_public_id IS NULL AND reopen_reason_code IS NULL)
    OR (status='reopened' AND closed_at_utc IS NOT NULL AND closed_by_public_id IS NOT NULL
      AND reopened_at_utc IS NOT NULL AND reopened_by_public_id IS NOT NULL
      AND reopen_authorization_public_id IS NOT NULL AND reopen_reason_code IS NOT NULL)
  ),
  CHECK (length(source_evidence_sha256)=64),
  UNIQUE (tenant_id,period_public_id),
  UNIQUE (tenant_id,period_name),
  UNIQUE (tenant_id,start_date,end_date)
);
CREATE INDEX IF NOT EXISTS idx_canonical_accounting_periods_lookup
  ON canonical_accounting_periods(tenant_id,start_date,end_date,status);

CREATE TABLE IF NOT EXISTS canonical_accounting_posting_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  posting_job_public_id TEXT NOT NULL,
  outbox_event_public_id TEXT NOT NULL,
  source_event_type TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  posting_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  voucher_public_id TEXT,
  custody_movement_public_id TEXT,
  skip_code TEXT,
  last_error_code TEXT,
  last_error_summary TEXT,
  first_attempt_at_utc TEXT,
  last_attempt_at_utc TEXT,
  posted_at_utc TEXT,
  next_attempt_at_utc TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(source_fingerprint)=64),
  CHECK (posting_kind IN ('voucher','cash_custody','skip')),
  CHECK (status IN ('pending','processing','retry','posted','skipped','dead_letter')),
  CHECK (attempts BETWEEN 0 AND 1000),
  CHECK (max_attempts BETWEEN 1 AND 1000),
  CHECK (attempts<=max_attempts),
  CHECK (first_attempt_at_utc IS NULL OR substr(first_attempt_at_utc,-1)='Z'),
  CHECK (last_attempt_at_utc IS NULL OR substr(last_attempt_at_utc,-1)='Z'),
  CHECK (posted_at_utc IS NULL OR substr(posted_at_utc,-1)='Z'),
  CHECK (next_attempt_at_utc IS NULL OR substr(next_attempt_at_utc,-1)='Z'),
  CHECK (
    (status='posted' AND posted_at_utc IS NOT NULL
      AND ((posting_kind='voucher' AND voucher_public_id IS NOT NULL AND custody_movement_public_id IS NULL)
        OR (posting_kind='cash_custody' AND custody_movement_public_id IS NOT NULL AND voucher_public_id IS NULL)))
    OR (status='skipped' AND posting_kind='skip' AND posted_at_utc IS NOT NULL
      AND skip_code IS NOT NULL AND voucher_public_id IS NULL AND custody_movement_public_id IS NULL)
    OR (status IN ('pending','processing','retry','dead_letter')
      AND voucher_public_id IS NULL AND custody_movement_public_id IS NULL AND posted_at_utc IS NULL)
  ),
  FOREIGN KEY (tenant_id,outbox_event_public_id)
    REFERENCES canonical_outbox_events(tenant_id,event_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,voucher_public_id)
    REFERENCES canonical_accounting_vouchers(tenant_id,voucher_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,custody_movement_public_id)
    REFERENCES canonical_cash_custody_movements(tenant_id,custody_movement_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,posting_job_public_id),
  UNIQUE (tenant_id,outbox_event_public_id)
);
CREATE INDEX IF NOT EXISTS idx_canonical_accounting_posting_jobs_queue
  ON canonical_accounting_posting_jobs(tenant_id,status,next_attempt_at_utc,id);
CREATE INDEX IF NOT EXISTS idx_canonical_accounting_posting_jobs_event
  ON canonical_accounting_posting_jobs(tenant_id,source_event_type,status);

CREATE TABLE IF NOT EXISTS canonical_accounting_vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  voucher_public_id TEXT NOT NULL,
  voucher_number TEXT NOT NULL,
  voucher_type TEXT NOT NULL,
  outbox_event_public_id TEXT,
  source_event_type TEXT NOT NULL,
  source_aggregate_type TEXT,
  source_aggregate_public_id TEXT,
  currency_code TEXT NOT NULL,
  business_date TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  debit_total_minor INTEGER NOT NULL,
  credit_total_minor INTEGER NOT NULL,
  entry_count INTEGER NOT NULL,
  reversal_of_voucher_public_id TEXT,
  reversal_reason_code TEXT,
  idempotency_key TEXT,
  request_fingerprint TEXT,
  posting_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (voucher_type IN ('journal','receipt','payment','credit','reversal')),
  CHECK (length(currency_code)=3 AND currency_code=upper(currency_code)),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (substr(occurred_at_utc,-1)='Z'),
  CHECK (status='posted'),
  CHECK (debit_total_minor BETWEEN 1 AND 9007199254740991),
  CHECK (credit_total_minor BETWEEN 1 AND 9007199254740991),
  CHECK (entry_count BETWEEN 2 AND 10000),
  CONSTRAINT canonical_accounting_vouchers_posting_guard CHECK (
    posting_guard=1 AND debit_total_minor=credit_total_minor
  ),
  CHECK (
    (voucher_type='reversal' AND reversal_of_voucher_public_id IS NOT NULL
      AND reversal_reason_code IS NOT NULL AND outbox_event_public_id IS NULL
      AND idempotency_key IS NOT NULL AND request_fingerprint IS NOT NULL)
    OR (voucher_type<>'reversal' AND reversal_of_voucher_public_id IS NULL
      AND reversal_reason_code IS NULL AND outbox_event_public_id IS NOT NULL
      AND idempotency_key IS NULL AND request_fingerprint IS NULL)
  ),
  CHECK (request_fingerprint IS NULL OR length(request_fingerprint)=64),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,outbox_event_public_id)
    REFERENCES canonical_outbox_events(tenant_id,event_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,reversal_of_voucher_public_id)
    REFERENCES canonical_accounting_vouchers(tenant_id,voucher_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,voucher_public_id),
  UNIQUE (tenant_id,voucher_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_accounting_vouchers_outbox
  ON canonical_accounting_vouchers(tenant_id,outbox_event_public_id)
  WHERE outbox_event_public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_accounting_vouchers_reversal
  ON canonical_accounting_vouchers(tenant_id,reversal_of_voucher_public_id)
  WHERE reversal_of_voucher_public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_accounting_vouchers_reversal_idempotency
  ON canonical_accounting_vouchers(tenant_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_accounting_vouchers_date
  ON canonical_accounting_vouchers(tenant_id,business_date,voucher_type,id);

CREATE TABLE IF NOT EXISTS canonical_accounting_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  entry_public_id TEXT NOT NULL,
  voucher_public_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  account_public_id TEXT NOT NULL,
  debit_minor INTEGER NOT NULL DEFAULT 0,
  credit_minor INTEGER NOT NULL DEFAULT 0,
  memo_code TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (line_no BETWEEN 1 AND 10000),
  CHECK (debit_minor BETWEEN 0 AND 9007199254740991),
  CHECK (credit_minor BETWEEN 0 AND 9007199254740991),
  CHECK ((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0)),
  CHECK (length(trim(memo_code))>0),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,voucher_public_id)
    REFERENCES canonical_accounting_vouchers(tenant_id,voucher_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,account_public_id)
    REFERENCES canonical_accounting_accounts(tenant_id,account_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,entry_public_id),
  UNIQUE (tenant_id,voucher_public_id,line_no)
);
CREATE INDEX IF NOT EXISTS idx_canonical_accounting_entries_account
  ON canonical_accounting_entries(tenant_id,account_public_id,voucher_public_id);

CREATE TABLE IF NOT EXISTS canonical_cash_custody_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  custody_public_id TEXT NOT NULL,
  custody_type TEXT NOT NULL,
  legacy_counter_id INTEGER,
  legacy_counter_session_id INTEGER,
  balance_minor INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  projection_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (custody_type IN ('counter_session','user','safe','bank_transit','other')),
  CHECK (balance_minor BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (version>=0),
  CONSTRAINT canonical_cash_custody_balances_projection_guard CHECK (projection_guard=1),
  CHECK (length(source_evidence_sha256)=64),
  UNIQUE (tenant_id,custody_public_id)
);
CREATE INDEX IF NOT EXISTS idx_canonical_cash_custody_balances_session
  ON canonical_cash_custody_balances(tenant_id,legacy_counter_session_id,custody_type);

CREATE TABLE IF NOT EXISTS canonical_cash_custody_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  custody_movement_public_id TEXT NOT NULL,
  outbox_event_public_id TEXT NOT NULL,
  custody_public_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  signed_amount_minor INTEGER NOT NULL,
  balance_before_minor INTEGER NOT NULL,
  balance_after_minor INTEGER NOT NULL,
  legacy_counter_id INTEGER,
  legacy_counter_session_id INTEGER,
  occurred_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (movement_type IN ('collection','refund','expense','payroll','practitioner_payout','handover','adjustment','shadow')),
  CHECK (direction IN ('in','out','neutral')),
  CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  CHECK (signed_amount_minor=CASE WHEN direction='in' THEN amount_minor WHEN direction='out' THEN -amount_minor ELSE 0 END),
  CHECK (balance_before_minor BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (balance_after_minor BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (balance_after_minor=balance_before_minor+signed_amount_minor),
  CHECK (substr(occurred_at_utc,-1)='Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT canonical_cash_custody_movements_balance_guard CHECK (balance_guard=1),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,outbox_event_public_id)
    REFERENCES canonical_outbox_events(tenant_id,event_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,custody_public_id)
    REFERENCES canonical_cash_custody_balances(tenant_id,custody_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,custody_movement_public_id),
  UNIQUE (tenant_id,outbox_event_public_id)
);
CREATE INDEX IF NOT EXISTS idx_canonical_cash_custody_movements_balance
  ON canonical_cash_custody_movements(tenant_id,custody_public_id,occurred_at_utc,id);
