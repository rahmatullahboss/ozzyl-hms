-- Migration: Clinical Assessments & Problem List Module
-- Ported from danphe-next-cloudflare clinical module

-- ─── Problem List ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_ProblemList (
    ProblemId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER,
    ICD10Code TEXT,
    Description TEXT NOT NULL,
    Subtype TEXT,
    BegDate TEXT,
    EndDate TEXT,
    Severity TEXT DEFAULT 'moderate' CHECK (Severity IN ('mild', 'moderate', 'severe')),
    Comments TEXT,
    Status TEXT DEFAULT 'active' CHECK (Status IN ('active', 'inactive', 'resolved', 'deleted')),
    Activity INTEGER DEFAULT 1,
    CreatedBy TEXT,
    CreatedAt TEXT DEFAULT (datetime('now')),
    ModifiedBy TEXT,
    ModifiedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_cln_problemlist_patient ON CLN_ProblemList(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_cln_problemlist_status ON CLN_ProblemList(tenant_id, PatientId, Status);

-- ─── Problem-Encounter Link ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ProblemEncounterLink (
    LinkId INTEGER PRIMARY KEY AUTOINCREMENT,
    ProblemId INTEGER NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER NOT NULL,
    CreatedBy TEXT,
    CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_problem_encounter_link ON ProblemEncounterLink(ProblemId, EncounterId);

-- ─── Family History ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_FamilyHistory (
    FamilyProblemId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    ICD10Code TEXT,
    ICD10Description TEXT,
    Relationship TEXT,
    Note TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy TEXT,
    CreatedOn TEXT DEFAULT (datetime('now')),
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_cln_familyhistory_patient ON CLN_FamilyHistory(tenant_id, PatientId);

-- ─── Social History ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_SocialHistory (
    SocialHistoryId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    SmokingHistory TEXT,
    AlcoholHistory TEXT,
    DrugHistory TEXT,
    Occupation TEXT,
    FamilySupport TEXT,
    Note TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy TEXT,
    CreatedOn TEXT DEFAULT (datetime('now')),
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_cln_socialhistory_patient ON CLN_SocialHistory(tenant_id, PatientId);

-- ─── Surgical History ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_SurgicalHistory (
    SurgicalHistoryId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    ICD10Code TEXT,
    ICD10Description TEXT,
    SurgeryType TEXT,
    Note TEXT,
    SurgeryDate TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy TEXT,
    CreatedOn TEXT DEFAULT (datetime('now')),
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_cln_surgicalhistory_patient ON CLN_SurgicalHistory(tenant_id, PatientId);

-- ─── Referral Source ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_ReferralSource (
    ReferralSourceId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    ReferralSource TEXT,
    ReferralDetails TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedOn TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cln_referralsource_patient ON CLN_ReferralSource(tenant_id, PatientId);

-- ─── Patient Diet ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_PatientDiet (
    PatientDietId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    PatientVisitId INTEGER,
    DietTypeId INTEGER,
    DietTypeName TEXT,
    DietName TEXT,
    Quantity REAL,
    Unit TEXT,
    FeedingTime TEXT,
    Remarks TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy TEXT,
    CreatedOn TEXT DEFAULT (datetime('now')),
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_cln_patientdiet_patient ON CLN_PatientDiet(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_cln_patientdiet_visit ON CLN_PatientDiet(tenant_id, PatientVisitId);

-- ─── Blood Glucose ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_Glucose (
    GlucoseId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    PatientVisitId INTEGER,
    SugarValue REAL NOT NULL,
    Unit TEXT DEFAULT 'mg/dL',
    BSLType TEXT CHECK (BSLType IN ('Random', 'Fasting', 'PP')),
    MeasurementTime TEXT,
    Remarks TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy TEXT,
    CreatedOn TEXT DEFAULT (datetime('now')),
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_cln_glucose_patient ON CLN_Glucose(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_cln_glucose_visit ON CLN_Glucose(tenant_id, PatientVisitId);

-- ─── Clinical Diagnosis (per-visit) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ClinicalDiagnosis (
    DiagnosisId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    PatientVisitId INTEGER,
    ICD10ID INTEGER,
    ICD10Code TEXT,
    ICD10Description TEXT NOT NULL,
    DiagnosisType TEXT DEFAULT 'primary' CHECK (DiagnosisType IN ('primary', 'secondary', 'admitting', 'discharge')),
    Notes TEXT,
    IsActive INTEGER DEFAULT 1,
    CreatedBy TEXT,
    CreatedOn TEXT DEFAULT (datetime('now')),
    ModifiedBy TEXT,
    ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_clinicaldiagnosis_patient ON ClinicalDiagnosis(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_clinicaldiagnosis_visit ON ClinicalDiagnosis(tenant_id, PatientVisitId);

-- ─── ICD-10 Disease Master (if not exists) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS ICD10Diseases (
    ICD10ID INTEGER PRIMARY KEY AUTOINCREMENT,
    ICD10Code TEXT NOT NULL,
    DiseaseName TEXT NOT NULL,
    IsActive INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_icd10_code ON ICD10Diseases(ICD10Code);
CREATE INDEX IF NOT EXISTS idx_icd10_name ON ICD10Diseases(DiseaseName);

-- ─── PHQ-9 Depression Screening ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormPHQ9 (
    PHQ9Id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER,
    InterestScore INTEGER DEFAULT 0,
    HopelessScore INTEGER DEFAULT 0,
    SleepScore INTEGER DEFAULT 0,
    FatigueScore INTEGER DEFAULT 0,
    AppetiteScore INTEGER DEFAULT 0,
    FailureScore INTEGER DEFAULT 0,
    FocusScore INTEGER DEFAULT 0,
    PsychomotorScore INTEGER DEFAULT 0,
    SuicideScore INTEGER DEFAULT 0,
    TotalScore INTEGER DEFAULT 0,
    SeverityLevel TEXT,
    IsFlagged INTEGER DEFAULT 0,
    Difficulty TEXT,
    CreatedById TEXT,
    CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_formphq9_patient ON FormPHQ9(tenant_id, PatientId);

-- ─── GAD-7 Anxiety Screening ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormGAD7 (
    GAD7Id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER,
    NervousScore INTEGER DEFAULT 0,
    ControlWorryScore INTEGER DEFAULT 0,
    WorryScore INTEGER DEFAULT 0,
    RelaxScore INTEGER DEFAULT 0,
    RestlessScore INTEGER DEFAULT 0,
    IrritableScore INTEGER DEFAULT 0,
    FearScore INTEGER DEFAULT 0,
    TotalScore INTEGER DEFAULT 0,
    SeverityLevel TEXT,
    IsFlagged INTEGER DEFAULT 0,
    Difficulty TEXT,
    CreatedById TEXT,
    CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_formgad7_patient ON FormGAD7(tenant_id, PatientId);

-- ─── SOAP Notes ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormSOAP (
    SOAPId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER,
    ChiefComplaint TEXT,
    Subjective TEXT,
    Objective TEXT,
    Assessment TEXT,
    Plan TEXT,
    CreatedById TEXT,
    CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_formsoap_patient ON FormSOAP(tenant_id, PatientId);

-- ─── Treatment Plan ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormTreatmentPlan (
    TreatmentPlanId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER,
    ClientName TEXT,
    ClientNumber INTEGER,
    Provider TEXT,
    AdmitDate TEXT,
    PresentingIssues TEXT,
    PatientHistory TEXT,
    Medications TEXT,
    AnyOtherRelevantInformation TEXT,
    Diagnosis TEXT,
    TreatmentReceived TEXT,
    RecommendationForFollowUp TEXT,
    CreatedById TEXT,
    CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_formtreatmentplan_patient ON FormTreatmentPlan(tenant_id, PatientId);

-- ─── Enhanced Social History ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_SocialHistoryEnhanced (
    SocialHistoryId INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    PatientId INTEGER NOT NULL,
    EncounterId INTEGER,
    SmokingStatus TEXT,
    SmokingPacksPerDay REAL,
    SmokingQuitDate TEXT,
    TobaccoType TEXT,
    AlcoholUse TEXT,
    AlcoholUnitsPerWeek REAL,
    RecreationalDrugs TEXT,
    DrugTypes TEXT,
    ExercisePatterns TEXT,
    SleepPatterns TEXT,
    CaffeineUse TEXT,
    SeatbeltUse TEXT,
    HazardousActivities TEXT,
    FamilyHistoryMother TEXT,
    FamilyHistoryFather TEXT,
    FamilyHistorySiblings TEXT,
    FamilyHistoryOffspring TEXT,
    Notes TEXT,
    CreatedById TEXT,
    CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cln_socialhistory_enhanced_patient ON CLN_SocialHistoryEnhanced(tenant_id, PatientId);

-- ─── Seed some common ICD-10 codes ──────────────────────────────────────────

INSERT OR IGNORE INTO ICD10Diseases (ICD10Code, DiseaseName) VALUES
    ('A09', 'Infectious gastroenteritis and colitis'),
    ('A15.0', 'Tuberculosis of lung'),
    ('B20', 'HIV disease'),
    ('D50.9', 'Iron deficiency anaemia'),
    ('E11.9', 'Type 2 diabetes mellitus without complications'),
    ('E78.5', 'Dyslipidaemia'),
    ('F32.9', 'Major depressive disorder, single episode'),
    ('F41.1', 'Generalized anxiety disorder'),
    ('G43.909', 'Migraine, unspecified'),
    ('I10', 'Essential hypertension'),
    ('I25.10', 'Atherosclerotic heart disease'),
    ('I50.9', 'Heart failure, unspecified'),
    ('J06.9', 'Acute upper respiratory infection'),
    ('J18.9', 'Pneumonia, unspecified'),
    ('J44.1', 'Chronic obstructive pulmonary disease with acute exacerbation'),
    ('J45.909', 'Unspecified asthma'),
    ('K21.0', 'Gastro-esophageal reflux disease with esophagitis'),
    ('K29.70', 'Gastritis, unspecified'),
    ('L30.9', 'Dermatitis, unspecified'),
    ('M54.5', 'Low back pain'),
    ('M79.3', 'Panniculitis, unspecified'),
    ('N18.9', 'Chronic kidney disease, unspecified'),
    ('N39.0', 'Urinary tract infection'),
    ('R05.9', 'Cough, unspecified'),
    ('R10.9', 'Unspecified abdominal pain'),
    ('R50.9', 'Fever, unspecified'),
    ('R51.9', 'Headache'),
    ('R53.83', 'Fatigue'),
    ('Z00.00', 'General adult medical examination'),
    ('Z23', 'Encounter for immunization');
