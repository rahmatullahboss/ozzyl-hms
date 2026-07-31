-- Migration: 0077_final_ports.sql
-- Description: Final EHR gap closure — Clinical Images, I/O Charting, Marketing Referral
-- Created: 2026-04-06

-- ═══════════════════════════════════════════════════════════════════
-- 1. CLINICAL SCANNED IMAGES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS CLN_ScannedImages (
  ScannedImageId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  PatientVisitId INTEGER,
  EncounterId INTEGER,
  ImageName TEXT NOT NULL,
  ImagePath TEXT NOT NULL,
  ImageType TEXT,
  UploadedOn TEXT DEFAULT (datetime('now')),
  UploadedBy INTEGER,
  Notes TEXT,
  IsActive INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cln_images_tenant ON CLN_ScannedImages(tenant_id, PatientId);

-- ═══════════════════════════════════════════════════════════════════
-- 2. CLINICAL INPUT/OUTPUT (INTAKE/OUTPUT CHARTING)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS CLN_InputOutput (
  InputOutputId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  PatientVisitId INTEGER,
  EncounterId INTEGER,
  ParameterName TEXT NOT NULL,
  ParameterCategory TEXT,
  IntakeOutputValue REAL NOT NULL,
  Unit TEXT,
  IntakeOutputType TEXT CHECK(IntakeOutputType IN ('intake','output')),
  Contents TEXT,
  Remarks TEXT,
  RecordedAt TEXT DEFAULT (datetime('now')),
  CreatedBy INTEGER,
  CreatedOn TEXT DEFAULT (datetime('now')),
  ModifiedBy INTEGER,
  ModifiedOn TEXT,
  IsActive INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cln_io_tenant ON CLN_InputOutput(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_cln_io_visit ON CLN_InputOutput(tenant_id, PatientVisitId);

-- ═══════════════════════════════════════════════════════════════════
-- 3. MARKETING / REFERRAL
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ReferralScheme (
  SchemeId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  SchemeName TEXT NOT NULL,
  CommissionPercent REAL NOT NULL DEFAULT 0,
  Description TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedBy INTEGER,
  CreatedOn TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_scheme_tenant ON ReferralScheme(tenant_id);

CREATE TABLE IF NOT EXISTS ReferringOrganization (
  OrganizationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  OrganizationName TEXT NOT NULL,
  ContactPerson TEXT,
  Phone TEXT,
  Email TEXT,
  Address TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedBy INTEGER,
  CreatedOn TEXT DEFAULT (datetime('now')),
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);
CREATE INDEX IF NOT EXISTS idx_ref_org_tenant ON ReferringOrganization(tenant_id);

CREATE TABLE IF NOT EXISTS ReferringPartyGroup (
  GroupId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  GroupName TEXT NOT NULL,
  Description TEXT,
  CreatedOn TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_group_tenant ON ReferringPartyGroup(tenant_id);

CREATE TABLE IF NOT EXISTS ReferringParty (
  PartyId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PartyName TEXT NOT NULL,
  GroupId INTEGER,
  OrganizationId INTEGER,
  ContactNo TEXT,
  Email TEXT,
  Address TEXT,
  DefaultCommissionPercent REAL DEFAULT 0,
  IsActive INTEGER DEFAULT 1,
  CreatedBy INTEGER,
  CreatedOn TEXT DEFAULT (datetime('now')),
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);
CREATE INDEX IF NOT EXISTS idx_ref_party_tenant ON ReferringParty(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ref_party_org ON ReferringParty(tenant_id, OrganizationId);

CREATE TABLE IF NOT EXISTS ReferralCommission (
  CommissionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  BillingTransactionId INTEGER NOT NULL,
  PartyId INTEGER,
  OrganizationId INTEGER,
  SchemeId INTEGER,
  CommissionAmount REAL NOT NULL DEFAULT 0,
  Percentage REAL,
  BillAmount REAL,
  CreatedBy INTEGER,
  CreatedOn TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_comm_tenant ON ReferralCommission(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ref_comm_billing ON ReferralCommission(tenant_id, BillingTransactionId);
CREATE INDEX IF NOT EXISTS idx_ref_comm_party ON ReferralCommission(tenant_id, PartyId);
