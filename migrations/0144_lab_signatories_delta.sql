-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0144: Lab Report Signatories + Report Enhancements
-- ═══════════════════════════════════════════════════════════════════════════════

-- Lab Report Signatories (who signs lab reports)
CREATE TABLE IF NOT EXISTS lab_report_signatories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signatory_name TEXT NOT NULL,
  designation TEXT NOT NULL,         -- 'Pathologist', 'Lab Technologist', 'Lab Director'
  qualification TEXT,                -- 'MBBS, FCPS (Pathology)', 'B.Sc MLT'
  registration_no TEXT,              -- BMDC registration number
  signature_image TEXT,              -- base64 or URL of signature image
  display_order INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_sig_tenant ON lab_report_signatories(tenant_id, is_active);

-- Add signatory references to lab_reports
ALTER TABLE lab_reports ADD COLUMN signatory_ids TEXT;        -- JSON array of signatory IDs
ALTER TABLE lab_reports ADD COLUMN printed_at DATETIME;
ALTER TABLE lab_reports ADD COLUMN print_count INTEGER DEFAULT 0;
ALTER TABLE lab_reports ADD COLUMN delivered_via TEXT;         -- 'print', 'email', 'sms', 'portal'
ALTER TABLE lab_reports ADD COLUMN delivered_at DATETIME;

-- Add delta check columns to lab_results for previous-result comparison
ALTER TABLE lab_results ADD COLUMN previous_value TEXT;
ALTER TABLE lab_results ADD COLUMN delta_flag TEXT;            -- 'increased', 'decreased', 'stable', 'new'
