-- =============================================================================
-- Bangladesh Master Drug Database — Schema
-- Source: WSAyan/medicinedb (MedEx.com.bd)
-- 17,589 brands | 1,435 generics | 645 companies
-- =============================================================================

-- Master Companies (shared, no tenant_id)
CREATE TABLE IF NOT EXISTS master_companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Master Generics (shared)
CREATE TABLE IF NOT EXISTS master_generics (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  indication TEXT,
  precaution TEXT,
  contra_indication TEXT,
  side_effect TEXT,
  dose TEXT,
  pregnancy_category TEXT,
  mode_of_action TEXT,
  interaction TEXT
);

-- Master Drugs / Brands (shared, no FK constraints for flexibility)
CREATE TABLE IF NOT EXISTS master_drugs (
  id INTEGER PRIMARY KEY,
  brand_name TEXT NOT NULL,
  generic_id INTEGER,
  company_id INTEGER,
  form TEXT,
  strength TEXT,
  price TEXT,
  pack_size TEXT
);

-- Performance indexes for prefix search
CREATE INDEX IF NOT EXISTS idx_master_drugs_brand ON master_drugs(brand_name);
CREATE INDEX IF NOT EXISTS idx_master_drugs_generic ON master_drugs(generic_id);
CREATE INDEX IF NOT EXISTS idx_master_drugs_company ON master_drugs(company_id);
CREATE INDEX IF NOT EXISTS idx_master_generics_name ON master_generics(name);
CREATE INDEX IF NOT EXISTS idx_master_companies_name ON master_companies(name);
