-- Performance indexes specifically for case-insensitive LIKE and exact matches
CREATE INDEX IF NOT EXISTS idx_master_drugs_brand_nocase ON master_drugs(brand_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_master_drugs_brand_form_nocase ON master_drugs(brand_name COLLATE NOCASE, form COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_master_generics_name_nocase ON master_generics(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_master_companies_name_nocase ON master_companies(name COLLATE NOCASE);
