-- ============================================================================
-- 0042 Billing Master Data Tables
-- Adds billing configuration tables: schemes, price categories, service items,
-- counters, fiscal years, credit orgs, packages, deposits heads, memberships,
-- provisional items, and reporting items.
-- ============================================================================

-- Billing Schemes (insurance, government, general)
CREATE TABLE IF NOT EXISTS billing_schemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_name TEXT NOT NULL,
  scheme_code TEXT,
  scheme_type TEXT DEFAULT 'general', -- general | insurance | government | corporate
  description TEXT,
  default_discount_percent REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_schemes_tenant ON billing_schemes(tenant_id, is_active);

-- Billing Sub Schemes (child of scheme)
CREATE TABLE IF NOT EXISTS billing_sub_schemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id INTEGER NOT NULL REFERENCES billing_schemes(id),
  sub_scheme_name TEXT NOT NULL,
  sub_scheme_code TEXT,
  discount_percent REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Price Categories (different pricing tiers)
CREATE TABLE IF NOT EXISTS billing_price_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_name TEXT NOT NULL,
  category_code TEXT,
  description TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_price_cat_tenant ON billing_price_categories(tenant_id, is_active);

-- Scheme ↔ Price Category mapping
CREATE TABLE IF NOT EXISTS billing_scheme_price_category_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id INTEGER NOT NULL REFERENCES billing_schemes(id),
  price_category_id INTEGER NOT NULL REFERENCES billing_price_categories(id),
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Service Departments
CREATE TABLE IF NOT EXISTS billing_service_departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_name TEXT NOT NULL,
  department_code TEXT,
  parent_id INTEGER,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_svc_dept_tenant ON billing_service_departments(tenant_id, is_active);

-- Service Items (individual billable items)
CREATE TABLE IF NOT EXISTS billing_service_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT NOT NULL,
  item_code TEXT,
  service_department_id INTEGER REFERENCES billing_service_departments(id),
  price REAL NOT NULL DEFAULT 0,
  tax_applicable INTEGER DEFAULT 0,
  tax_percent REAL DEFAULT 0,
  allow_discount INTEGER DEFAULT 1,
  allow_multiple_qty INTEGER DEFAULT 1,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_svc_items_tenant ON billing_service_items(tenant_id, service_department_id, is_active);
CREATE INDEX IF NOT EXISTS idx_billing_svc_items_code ON billing_service_items(tenant_id, item_code);

-- Item ↔ Price Category mapping (different prices per category)
CREATE TABLE IF NOT EXISTS billing_item_price_category_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_item_id INTEGER NOT NULL REFERENCES billing_service_items(id),
  price_category_id INTEGER NOT NULL REFERENCES billing_price_categories(id),
  price REAL NOT NULL DEFAULT 0,
  discount_percent REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Billing Counters
CREATE TABLE IF NOT EXISTS billing_counters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  counter_name TEXT NOT NULL,
  counter_code TEXT,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fiscal Years
CREATE TABLE IF NOT EXISTS billing_fiscal_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_fy_tenant ON billing_fiscal_years(tenant_id, is_current);

-- Credit Organizations (corporate accounts)
CREATE TABLE IF NOT EXISTS billing_credit_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_name TEXT NOT NULL,
  organization_code TEXT,
  contact_person TEXT,
  contact_no TEXT,
  email TEXT,
  address TEXT,
  credit_limit REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_credit_org_tenant ON billing_credit_organizations(tenant_id, is_active);

-- Billing Packages (bundled services)
CREATE TABLE IF NOT EXISTS billing_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_name TEXT NOT NULL,
  package_code TEXT,
  description TEXT,
  total_price REAL NOT NULL DEFAULT 0,
  discount_percent REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Package Items (items inside a package)
CREATE TABLE IF NOT EXISTS billing_package_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER NOT NULL REFERENCES billing_packages(id),
  service_item_id INTEGER REFERENCES billing_service_items(id),
  item_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  price REAL NOT NULL DEFAULT 0,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Deposit Heads (classification for deposits)
CREATE TABLE IF NOT EXISTS billing_deposit_heads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  head_name TEXT NOT NULL,
  head_code TEXT,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Membership Types (patient discount tiers)
CREATE TABLE IF NOT EXISTS billing_membership_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_name TEXT NOT NULL,
  membership_code TEXT,
  discount_percent REAL DEFAULT 0,
  description TEXT,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_membership_tenant ON billing_membership_types(tenant_id, is_active);

-- Patient Memberships (linking patients to membership types)
CREATE TABLE IF NOT EXISTS patient_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  membership_type_id INTEGER NOT NULL REFERENCES billing_membership_types(id),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_patient_memberships_tenant ON patient_memberships(tenant_id, patient_id, is_active);

-- NOTE: billing_provisional_items already exists from init.ts (with bill_status column).
-- No need to recreate here.

-- Reporting Items (for report generation)
CREATE TABLE IF NOT EXISTS billing_reporting_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporting_item_name TEXT NOT NULL,
  reporting_item_code TEXT,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Reporting Item Mapping (service item → reporting item)
CREATE TABLE IF NOT EXISTS billing_reporting_item_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_item_id INTEGER NOT NULL REFERENCES billing_service_items(id),
  reporting_item_id INTEGER NOT NULL REFERENCES billing_reporting_items(id),
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
