-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION: Dental Module Phase 1+2 Enhancement
-- Description: Surface charting, expanded conditions, treatment status,
--              multi-visit tracking, dental notation support
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. PatientDentalChart: Add surface-level charting ─────────────
ALTER TABLE PatientDentalChart ADD COLUMN ConditionStatus TEXT DEFAULT 'existing';
ALTER TABLE PatientDentalChart ADD COLUMN SurfaceMesial TEXT;
ALTER TABLE PatientDentalChart ADD COLUMN SurfaceDistal TEXT;
ALTER TABLE PatientDentalChart ADD COLUMN SurfaceBuccal TEXT;
ALTER TABLE PatientDentalChart ADD COLUMN SurfaceLingual TEXT;
ALTER TABLE PatientDentalChart ADD COLUMN SurfaceOcclusal TEXT;
ALTER TABLE PatientDentalChart ADD COLUMN ConditionSecondary TEXT;
ALTER TABLE PatientDentalChart ADD COLUMN NotationSystem TEXT DEFAULT 'universal';

-- ─── 2. DentalTreatment: Add multi-visit tracking fields ───────────
ALTER TABLE DentalTreatment ADD COLUMN VisitNumber INTEGER DEFAULT 1;
ALTER TABLE DentalTreatment ADD COLUMN TotalPlannedVisits INTEGER DEFAULT 1;
ALTER TABLE DentalTreatment ADD COLUMN NextVisitDate TEXT;
ALTER TABLE DentalTreatment ADD COLUMN NextVisitNotes TEXT;
ALTER TABLE DentalTreatment ADD COLUMN ParentTreatmentId INTEGER;
ALTER TABLE DentalTreatment ADD COLUMN IsMultiVisit INTEGER DEFAULT 0;

-- ─── 3. DentalTreatmentPlanItem: Add status tracking ───────────────
ALTER TABLE DentalTreatmentPlanItem ADD COLUMN ActualFee REAL;
ALTER TABLE DentalTreatmentPlanItem ADD COLUMN CompletedDate TEXT;
ALTER TABLE DentalTreatmentPlanItem ADD COLUMN CompletedById INTEGER;

-- ─── 4. DentalXray: Add image viewer fields ────────────────────────
ALTER TABLE DentalXray ADD COLUMN FileName TEXT;
ALTER TABLE DentalXray ADD COLUMN FileSize INTEGER;
ALTER TABLE DentalXray ADD COLUMN MimeType TEXT;
ALTER TABLE DentalXray ADD COLUMN AnnotationData TEXT;

-- ─── 5. New: DentalChartHistory ────────────────────────────────────
-- Tracks all changes to dental chart for audit/history view
CREATE TABLE IF NOT EXISTS DentalChartHistory (
  HistoryId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  ToothNumber TEXT NOT NULL,
  ChangedById INTEGER,
  ChangeType TEXT NOT NULL, -- 'condition', 'status', 'surface', 'notes'
  OldValue TEXT,
  NewValue TEXT,
  ChangedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dch_patient ON DentalChartHistory(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_dch_tooth ON DentalChartHistory(tenant_id, PatientId, ToothNumber);

-- ─── 6. New: DentalPrescription ────────────────────────────────────
-- Dental-specific prescriptions linked to treatments
CREATE TABLE IF NOT EXISTS DentalPrescription (
  PrescriptionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  TreatmentId INTEGER,
  EncounterId INTEGER,
  DrugName TEXT NOT NULL,
  Dosage TEXT,
  Frequency TEXT,
  Duration TEXT,
  Instructions TEXT,
  PrescribedById INTEGER,
  PrescribedDate TEXT DEFAULT (datetime('now')),
  Status TEXT DEFAULT 'active' -- active, completed, cancelled
);
CREATE INDEX IF NOT EXISTS idx_dp_tenant ON DentalPrescription(tenant_id, PatientId);

-- ─── 7. Update DentalToothMaster with notation mappings ────────────
ALTER TABLE DentalToothMaster ADD COLUMN FdiNumber TEXT;
ALTER TABLE DentalToothMaster ADD COLUMN PalmerNotation TEXT;
ALTER TABLE DentalToothMaster ADD COLUMN UniversalNumber TEXT;

-- Seed FDI notation data for permanent teeth
UPDATE DentalToothMaster SET 
  FdiNumber = CASE ToothNumber
    WHEN '1' THEN '18' WHEN '2' THEN '17' WHEN '3' THEN '16' WHEN '4' THEN '15' WHEN '5' THEN '14'
    WHEN '6' THEN '13' WHEN '7' THEN '12' WHEN '8' THEN '11' WHEN '9' THEN '21' WHEN '10' THEN '22'
    WHEN '11' THEN '23' WHEN '12' THEN '24' WHEN '13' THEN '25' WHEN '14' THEN '26' WHEN '15' THEN '27'
    WHEN '16' THEN '28' WHEN '17' THEN '48' WHEN '18' THEN '47' WHEN '19' THEN '46' WHEN '20' THEN '45'
    WHEN '21' THEN '44' WHEN '22' THEN '43' WHEN '23' THEN '42' WHEN '24' THEN '41' WHEN '25' THEN '31'
    WHEN '26' THEN '32' WHEN '27' THEN '33' WHEN '28' THEN '34' WHEN '29' THEN '35' WHEN '30' THEN '36'
    WHEN '31' THEN '37' WHEN '32' THEN '38'
  END,
  UniversalNumber = ToothNumber;

-- ─── 8. Seed expanded condition types into a reference table ───────
CREATE TABLE IF NOT EXISTS DentalConditionType (
  ConditionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT '_global_',
  ConditionKey TEXT NOT NULL UNIQUE,
  ConditionName TEXT NOT NULL,
  ConditionNameBn TEXT,
  ColorHex TEXT DEFAULT '#94a3b8',
  Category TEXT DEFAULT 'general', -- general, restorative, prosthodontic, endodontic, perio, orthodontic
  IsActive INTEGER DEFAULT 1
);

-- Insert standard dental conditions
INSERT OR IGNORE INTO DentalConditionType (ConditionKey, ConditionName, ConditionNameBn, ColorHex, Category) VALUES
  ('decay', 'Decay / Caries', 'ক্ষয় / ক্যারিস', '#f87171', 'restorative'),
  ('missing', 'Missing / Extracted', 'অনুপস্থিত / তোলা', '#9ca3af', 'general'),
  ('crown', 'Crown', 'ক্রাউন', '#fbbf24', 'prosthodontic'),
  ('filling', 'Filling', 'ফিলিং', '#60a5fa', 'restorative'),
  ('extraction', 'Extraction Required', 'তোলা প্রয়োজন', '#dc2626', 'general'),
  ('bridge', 'Bridge', 'ব্রিজ', '#c084fc', 'prosthodontic'),
  ('implant', 'Implant', 'ইমপ্লান্ট', '#2dd4bf', 'prosthodontic'),
  ('fracture', 'Fracture', 'ফাটল', '#f97316', 'general'),
  ('abrasion', 'Abrasion', 'ঘর্ষণ', '#f472b6', 'general'),
  ('erosion', 'Erosion', 'ক্ষয়', '#a78bfa', 'general'),
  ('abscess', 'Abscess', 'ফোড়া', '#ef4444', 'endodontic'),
  ('impacted', 'Impacted', 'ইমপ্যাক্টেড', '#64748b', 'general'),
  ('rct', 'Root Canal Treated', 'রুট ক্যানাল চিকিৎসিত', '#34d399', 'endodontic'),
  ('post', 'Post & Core', 'পোস্ট অ্যান্ড কোর', '#fb923c', 'endodontic'),
  ('veneer', 'Veneer', 'ভিনিয়ার', '#e879f9', 'prosthodontic'),
  ('inlay', 'Inlay', 'ইনলে', '#818cf8', 'restorative'),
  ('onlay', 'Onlay', 'অনলে', '#6366f1', 'restorative'),
  ('sealant', 'Sealant', 'সিল্যান্ট', '#22d3ee', 'preventive'),
  ('ortho_bracket', 'Orthodontic Bracket', 'অর্থোডন্টিক ব্র্যাকেট', '#a3e635', 'orthodontic'),
  ('calculus', 'Calculus', 'পাথর', '#94a3b8', 'perio'),
  ('gingivitis', 'Gingivitis', 'জিঞ্জিভাইটিস', '#f87171', 'perio'),
  ('recession', 'Gum Recession', 'মাঢ়ি পিছনে যাওয়া', '#fcd34d', 'perio'),
  ('mobility', 'Mobility Grade 2+', 'নড়াচড়া গ্রেড ২+', '#fca5a5', 'perio'),
  ('wear', 'Attrition / Wear', 'ঘষা / ক্ষয়', '#d1d5db', 'general');

-- ─── 9. Add indexes for performance ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pdc_status ON PatientDentalChart(tenant_id, PatientId, ConditionStatus);
CREATE INDEX IF NOT EXISTS idx_dt_parent ON DentalTreatment(tenant_id, ParentTreatmentId);
CREATE INDEX IF NOT EXISTS idx_dt_multivisit ON DentalTreatment(tenant_id, PatientId, IsMultiVisit);
