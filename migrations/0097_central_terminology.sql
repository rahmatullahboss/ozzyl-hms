-- Migration 0097: Central Terminology Service
-- Creates global (no tenant_id) terminology master tables
-- catalog_icd11_mms is the ICD-11 table matching the Drizzle schema

-- ============================================================
-- 1. ICD-11 MMS Catalog (WHO ICD-11 Mortality & Morbidity Statistics)
-- System URI: http://id.who.int/icd/release/11/mms
-- Global shared table — no tenant_id
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog_icd11_mms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  icd11_uri TEXT,
  is_bd_subset INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_icd11_mms_code ON catalog_icd11_mms(code);
CREATE INDEX IF NOT EXISTS idx_catalog_icd11_mms_title ON catalog_icd11_mms(title COLLATE NOCASE);

-- ============================================================
-- 2. LOINC Master Table (Logical Observation Identifiers Names and Codes)
-- System URI: http://loinc.org
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog_loinc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loinc_num TEXT NOT NULL UNIQUE,
  component TEXT NOT NULL,
  long_common_name TEXT NOT NULL,
  short_name TEXT,
  class TEXT,
  property TEXT,
  time_aspect TEXT,
  system_type TEXT,
  scale_type TEXT,
  units TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_loinc_class ON catalog_loinc(class);
CREATE INDEX IF NOT EXISTS idx_catalog_loinc_component ON catalog_loinc(component COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_catalog_loinc_name ON catalog_loinc(long_common_name COLLATE NOCASE);

-- ============================================================
-- 3. SNOMED CT Subset (Phase 1: common findings/disorders)
-- System URI: http://snomed.info/sct
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog_snomed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sctid TEXT NOT NULL UNIQUE,
  term TEXT NOT NULL,
  semantic_tag TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_snomed_tag ON catalog_snomed(semantic_tag);
CREATE INDEX IF NOT EXISTS idx_catalog_snomed_term ON catalog_snomed(term COLLATE NOCASE);

-- ============================================================
-- 4. Terminology Version Tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_system TEXT NOT NULL,
  version TEXT NOT NULL,
  loaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  record_count INTEGER,
  notes TEXT,
  UNIQUE(code_system, version)
);

-- ============================================================
-- 5. Link lab_test_catalog to LOINC
-- ============================================================
ALTER TABLE lab_test_catalog ADD COLUMN loinc_code TEXT;
CREATE INDEX IF NOT EXISTS idx_lab_test_loinc ON lab_test_catalog(loinc_code) WHERE loinc_code IS NOT NULL;

-- ============================================================
-- 6. Link master_drugs to ATC classification
-- ============================================================
ALTER TABLE master_drugs ADD COLUMN atc_code TEXT;
CREATE INDEX IF NOT EXISTS idx_master_drugs_atc ON master_drugs(atc_code) WHERE atc_code IS NOT NULL;
