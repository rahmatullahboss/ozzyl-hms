CREATE TABLE IF NOT EXISTS billing_credit_bill_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  bill_id INTEGER NOT NULL,
  fiscal_year_id INTEGER,
  invoice_no TEXT,
  invoice_date TEXT,
  patient_id INTEGER NOT NULL,
  credit_organization_id INTEGER,
  liable_party TEXT NOT NULL DEFAULT 'SELF',
  sales_total_bill_amount REAL NOT NULL DEFAULT 0,
  return_total_bill_amount REAL NOT NULL DEFAULT 0,
  co_pay_received_amount REAL NOT NULL DEFAULT 0,
  co_pay_return_amount REAL NOT NULL DEFAULT 0,
  net_receivable_amount REAL NOT NULL DEFAULT 0,
  non_claimable_amount REAL NOT NULL DEFAULT 0,
  is_claimable INTEGER NOT NULL DEFAULT 1,
  claim_code TEXT,
  settlement_id INTEGER,
  settlement_status TEXT NOT NULL DEFAULT 'Pending',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT,
  FOREIGN KEY (bill_id) REFERENCES bills(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (settlement_id) REFERENCES billing_settlements(id)
);

CREATE INDEX idx_credit_bill_status_tenant ON billing_credit_bill_status(tenant_id);
CREATE INDEX idx_credit_bill_status_patient ON billing_credit_bill_status(tenant_id, patient_id);
CREATE INDEX idx_credit_bill_status_settlement ON billing_credit_bill_status(tenant_id, settlement_status);
CREATE INDEX idx_credit_bill_status_bill ON billing_credit_bill_status(tenant_id, bill_id);
