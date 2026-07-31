-- ============================================================================
-- 0043 Lab Settings Tables
-- Adds lab configuration tables: categories, report templates, vendors,
-- and run number settings.
-- ============================================================================

-- Lab Test Categories (grouping lab tests)
CREATE TABLE IF NOT EXISTS lab_test_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_cat_tenant ON lab_test_categories(tenant_id, is_active);

-- Lab Report Templates (report layout configuration)
CREATE TABLE IF NOT EXISTS lab_report_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_name TEXT NOT NULL,
  template_short_name TEXT,
  template_type TEXT DEFAULT 'normal', -- normal | culture | html
  template_html TEXT,
  header_text TEXT,
  footer_text TEXT,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_tmpl_tenant ON lab_report_templates(tenant_id, is_active);

-- Lab Vendors (outsource/external labs)
CREATE TABLE IF NOT EXISTS lab_vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_code TEXT,
  vendor_name TEXT NOT NULL,
  is_external INTEGER DEFAULT 0,
  contact_address TEXT,
  contact_no TEXT,
  email TEXT,
  remarks TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lab_vendor_tenant ON lab_vendors(tenant_id, is_active);

-- Lab Run Number Settings (number formatting config)
CREATE TABLE IF NOT EXISTS lab_run_number_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  format_name TEXT NOT NULL,
  grouping_index INTEGER,
  visit_type TEXT,
  run_number_type TEXT,
  reset_daily INTEGER DEFAULT 0,
  reset_monthly INTEGER DEFAULT 0,
  reset_yearly INTEGER DEFAULT 0,
  starting_letter TEXT,
  format_initial_part TEXT,
  format_separator TEXT DEFAULT '-',
  format_last_part TEXT,
  under_insurance INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add category_id to existing lab_test_catalog if not present
-- (allows linking catalog tests to categories)
ALTER TABLE lab_test_catalog ADD COLUMN category_id INTEGER REFERENCES lab_test_categories(id);
ALTER TABLE lab_test_catalog ADD COLUMN template_id INTEGER REFERENCES lab_report_templates(id);
ALTER TABLE lab_test_catalog ADD COLUMN vendor_id INTEGER REFERENCES lab_vendors(id);
