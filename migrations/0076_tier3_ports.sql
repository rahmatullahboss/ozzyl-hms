-- Migration: 0076_tier3_ports.sql
-- Description: Tier 3 EHR ports from danphe-next-cloudflare
-- Features: Physical Exam, Fee Sheet, Dental, Psychiatry, Dictation, Requisitions, Group Attendance, CAMOS
-- Created: 2026-04-06

-- ═══════════════════════════════════════════════════════════════════
-- 1. PHYSICAL EXAM
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS PhysicalExamTemplate (
  TemplateId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  TemplateName TEXT NOT NULL,
  Description TEXT,
  Specialty TEXT,
  ExamLines TEXT, -- JSON array of line IDs
  IsDefault INTEGER DEFAULT 0,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now')),
  CreatedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pe_template_tenant ON PhysicalExamTemplate(tenant_id);

-- Physical exam lines: reference data (TEXT PK like 'GENWELL')
CREATE TABLE IF NOT EXISTS PhysicalExamLine (
  LineCode TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  Category TEXT NOT NULL,
  Title TEXT NOT NULL,
  WnlText TEXT DEFAULT 'Normal',
  AbnText TEXT DEFAULT '',
  DisplayOrder INTEGER DEFAULT 0,
  IsActive INTEGER DEFAULT 1,
  PRIMARY KEY (LineCode, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_pe_line_tenant ON PhysicalExamLine(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pe_line_cat ON PhysicalExamLine(tenant_id, Category);

CREATE TABLE IF NOT EXISTS FormPhysicalExam (
  ExamId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  TemplateId INTEGER,
  ExamDate TEXT NOT NULL,
  Findings TEXT NOT NULL, -- JSON: [{lineCode, status:'wnl'|'abn', notes}]
  OverallStatus TEXT DEFAULT 'normal',
  GeneralNotes TEXT,
  PerformedById INTEGER NOT NULL,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_form_pe_tenant ON FormPhysicalExam(tenant_id);
CREATE INDEX IF NOT EXISTS idx_form_pe_patient ON FormPhysicalExam(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS PhysicalExamComments (
  CommentId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ExamId INTEGER NOT NULL,
  LineCode TEXT NOT NULL,
  Status TEXT NOT NULL CHECK(Status IN ('wnl','abn')),
  Notes TEXT,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pe_comments_exam ON PhysicalExamComments(tenant_id, ExamId);

-- ═══════════════════════════════════════════════════════════════════
-- 2. FEE SHEET / BILLING
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS FeeSheetTransaction (
  TransactionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  VisitDate TEXT NOT NULL,
  ProviderId INTEGER NOT NULL,
  PlaceOfService TEXT DEFAULT '11',
  VisitType TEXT,
  DiagnosisCodes TEXT, -- JSON array
  PrimaryDiagnosis TEXT,
  TotalCharges REAL DEFAULT 0,
  TotalPaid REAL DEFAULT 0,
  BillingStatus TEXT DEFAULT 'pending' CHECK(BillingStatus IN ('pending','billed','paid','adjusted','cancelled')),
  BillingDate TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedById INTEGER NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT,
  DeletedAt TEXT,
  DeletedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fst_tenant ON FeeSheetTransaction(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fst_patient ON FeeSheetTransaction(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_fst_status ON FeeSheetTransaction(tenant_id, BillingStatus);

CREATE TABLE IF NOT EXISTS FeeSheetLineItem (
  LineItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  TransactionId INTEGER NOT NULL,
  LineSequence INTEGER NOT NULL,
  ServiceCode TEXT NOT NULL,
  ServiceName TEXT NOT NULL,
  ServiceModifier1 TEXT,
  ServiceModifier2 TEXT,
  Units REAL DEFAULT 1,
  UnitPrice REAL NOT NULL,
  TotalPrice REAL NOT NULL,
  DiagnosisPointers TEXT,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fsli_tx ON FeeSheetLineItem(tenant_id, TransactionId);

CREATE TABLE IF NOT EXISTS BillingCodeSet (
  CodeId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  Code TEXT NOT NULL,
  CodeType TEXT NOT NULL, -- 'CPT', 'HCPCS', 'ICD10'
  Description TEXT NOT NULL,
  DefaultFee REAL,
  Category TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bcs_tenant ON BillingCodeSet(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bcs_code ON BillingCodeSet(tenant_id, Code);

CREATE TABLE IF NOT EXISTS ContraceptionProduct (
  ProductId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ProductName TEXT NOT NULL,
  ProductType TEXT,
  NDCCode TEXT,
  Manufacturer TEXT,
  StockQuantity INTEGER DEFAULT 0,
  UnitCost REAL,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cp_tenant ON ContraceptionProduct(tenant_id);

CREATE TABLE IF NOT EXISTS ContraceptionAdministration (
  AdministrationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  ProductId INTEGER NOT NULL,
  AdministrationDate TEXT NOT NULL,
  LotNumber TEXT,
  AdministeredById INTEGER NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ca_tenant ON ContraceptionAdministration(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ca_patient ON ContraceptionAdministration(tenant_id, PatientId);

-- ═══════════════════════════════════════════════════════════════════
-- 3. DENTAL RECORDS
-- ═══════════════════════════════════════════════════════════════════

-- Universal tooth reference (no tenant_id — standard numbering)
CREATE TABLE IF NOT EXISTS DentalToothMaster (
  ToothId INTEGER PRIMARY KEY AUTOINCREMENT,
  ToothNumber TEXT NOT NULL UNIQUE,
  ToothSymbol TEXT,
  ToothName TEXT NOT NULL,
  ToothType TEXT NOT NULL,
  ToothClass TEXT,
  Arch TEXT,
  Quadrant INTEGER,
  Position INTEGER,
  Roots INTEGER DEFAULT 1,
  DisplayOrder INTEGER,
  IsActive INTEGER DEFAULT 1
);

-- Seed permanent teeth (Universal numbering 1-32)
INSERT OR IGNORE INTO DentalToothMaster (ToothNumber, ToothSymbol, ToothName, ToothType, ToothClass, Arch, Quadrant, Position, Roots, DisplayOrder) VALUES
('1','18','Third Molar','permanent','molar','maxillary',1,8,3,1),
('2','17','Second Molar','permanent','molar','maxillary',1,7,3,2),
('3','16','First Molar','permanent','molar','maxillary',1,6,3,3),
('4','15','Second Premolar','permanent','premolar','maxillary',1,5,2,4),
('5','14','First Premolar','permanent','premolar','maxillary',1,4,2,5),
('6','13','Cuspid (Canine)','permanent','cuspid','maxillary',1,3,1,6),
('7','12','Lateral Incisor','permanent','incisor','maxillary',1,2,1,7),
('8','11','Central Incisor','permanent','incisor','maxillary',1,1,1,8),
('9','21','Central Incisor','permanent','incisor','maxillary',2,1,1,9),
('10','22','Lateral Incisor','permanent','incisor','maxillary',2,2,1,10),
('11','23','Cuspid (Canine)','permanent','cuspid','maxillary',2,3,1,11),
('12','24','First Premolar','permanent','premolar','maxillary',2,4,2,12),
('13','25','Second Premolar','permanent','premolar','maxillary',2,5,2,13),
('14','26','First Molar','permanent','molar','maxillary',2,6,3,14),
('15','27','Second Molar','permanent','molar','maxillary',2,7,3,15),
('16','28','Third Molar','permanent','molar','maxillary',2,8,3,16),
('17','38','Third Molar','permanent','molar','mandibular',3,8,2,17),
('18','37','Second Molar','permanent','molar','mandibular',3,7,2,18),
('19','36','First Molar','permanent','molar','mandibular',3,6,2,19),
('20','35','Second Premolar','permanent','premolar','mandibular',3,5,2,20),
('21','34','First Premolar','permanent','premolar','mandibular',3,4,2,21),
('22','33','Cuspid (Canine)','permanent','cuspid','mandibular',3,3,1,22),
('23','32','Lateral Incisor','permanent','incisor','mandibular',3,2,1,23),
('24','31','Central Incisor','permanent','incisor','mandibular',3,1,1,24),
('25','41','Central Incisor','permanent','incisor','mandibular',4,1,1,25),
('26','42','Lateral Incisor','permanent','incisor','mandibular',4,2,1,26),
('27','43','Cuspid (Canine)','permanent','cuspid','mandibular',4,3,1,27),
('28','44','First Premolar','permanent','premolar','mandibular',4,4,2,28),
('29','45','Second Premolar','permanent','premolar','mandibular',4,5,2,29),
('30','46','First Molar','permanent','molar','mandibular',4,6,2,30),
('31','47','Second Molar','permanent','molar','mandibular',4,7,2,31),
('32','48','Third Molar','permanent','molar','mandibular',4,8,2,32);

-- Primary (baby) teeth (A-T)
INSERT OR IGNORE INTO DentalToothMaster (ToothNumber, ToothSymbol, ToothName, ToothType, ToothClass, Arch, Quadrant, Position, Roots, DisplayOrder) VALUES
('A','51','Central Incisor','primary','incisor','maxillary',1,1,1,51),
('B','52','Lateral Incisor','primary','incisor','maxillary',1,2,1,52),
('C','53','Cuspid (Canine)','primary','cuspid','maxillary',1,3,1,53),
('D','54','First Molar','primary','molar','maxillary',1,4,2,54),
('E','55','Second Molar','primary','molar','maxillary',1,5,2,55),
('F','61','Central Incisor','primary','incisor','maxillary',2,1,1,56),
('G','62','Lateral Incisor','primary','incisor','maxillary',2,2,1,57),
('H','63','Cuspid (Canine)','primary','cuspid','maxillary',2,3,1,58),
('I','64','First Molar','primary','molar','maxillary',2,4,2,59),
('J','65','Second Molar','primary','molar','maxillary',2,5,2,60),
('K','71','Central Incisor','primary','incisor','mandibular',3,1,1,61),
('L','72','Lateral Incisor','primary','incisor','mandibular',3,2,1,62),
('M','73','Cuspid (Canine)','primary','cuspid','mandibular',3,3,1,63),
('N','74','First Molar','primary','molar','mandibular',3,4,2,64),
('O','75','Second Molar','primary','molar','mandibular',3,5,2,65),
('P','81','Central Incisor','primary','incisor','mandibular',4,1,1,66),
('Q','82','Lateral Incisor','primary','incisor','mandibular',4,2,1,67),
('R','83','Cuspid (Canine)','primary','cuspid','mandibular',4,3,1,68),
('S','84','First Molar','primary','molar','mandibular',4,4,2,69),
('T','85','Second Molar','primary','molar','mandibular',4,5,2,70);

CREATE TABLE IF NOT EXISTS DentalProcedureCode (
  ProcedureCodeId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  CdtCode TEXT NOT NULL,
  ProcedureName TEXT NOT NULL,
  Category TEXT,
  SubCategory TEXT,
  Description TEXT,
  DefaultFee REAL,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, CdtCode)
);
CREATE INDEX IF NOT EXISTS idx_dpc_tenant ON DentalProcedureCode(tenant_id);

CREATE TABLE IF NOT EXISTS PatientDentalChart (
  ChartId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  ToothNumber TEXT NOT NULL,
  ToothStatus TEXT DEFAULT 'present',
  ToothCondition TEXT,
  ExistingRestoration TEXT,
  ExistingRestorationDate TEXT,
  PocketDepthMesial INTEGER,
  PocketDepthDistal INTEGER,
  PocketDepthBuccal INTEGER,
  PocketDepthLingual INTEGER,
  Mobility INTEGER DEFAULT 0,
  Furcation INTEGER DEFAULT 0,
  Recession INTEGER DEFAULT 0,
  RootCanalDone INTEGER DEFAULT 0,
  RootCanalDate TEXT,
  IsAbutment INTEGER DEFAULT 0,
  IsPontic INTEGER DEFAULT 0,
  IsImplant INTEGER DEFAULT 0,
  ImplantDate TEXT,
  ClinicalNotes TEXT,
  ChartedById INTEGER,
  ChartedDate TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT,
  UNIQUE(tenant_id, PatientId, ToothNumber)
);
CREATE INDEX IF NOT EXISTS idx_pdc_tenant ON PatientDentalChart(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS DentalTreatment (
  TreatmentId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  ProcedureCodeId INTEGER,
  CdtCode TEXT NOT NULL,
  ProcedureName TEXT NOT NULL,
  ToothNumber TEXT,
  ToothSurface TEXT,
  Quadrant INTEGER,
  AnesthesiaUsed TEXT,
  Complications TEXT,
  Narrative TEXT,
  PerformedById INTEGER NOT NULL,
  PerformedDate TEXT NOT NULL,
  Status TEXT DEFAULT 'completed',
  Fee REAL,
  LabRequired INTEGER DEFAULT 0,
  LabType TEXT,
  LabShade TEXT,
  LabStatus TEXT,
  FollowupRequired INTEGER DEFAULT 0,
  FollowupDate TEXT,
  FollowupNotes TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now')),
  DeletedAt TEXT,
  DeletedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dt_tenant ON DentalTreatment(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_dt_code ON DentalTreatment(tenant_id, CdtCode);

CREATE TABLE IF NOT EXISTS DentalTreatmentPlan (
  PlanId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  PlanName TEXT,
  PlanPhase INTEGER DEFAULT 1,
  Priority TEXT DEFAULT 'routine',
  EstimatedTotal REAL,
  Status TEXT DEFAULT 'active',
  CreatedById INTEGER NOT NULL,
  ApprovedById INTEGER,
  ApprovedDate TEXT,
  PatientConsent INTEGER DEFAULT 0,
  ClinicalNotes TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dtp_tenant ON DentalTreatmentPlan(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS DentalTreatmentPlanItem (
  PlanItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PlanId INTEGER NOT NULL,
  ProcedureCodeId INTEGER,
  CdtCode TEXT,
  ToothNumber TEXT,
  ToothSurface TEXT,
  Quadrant INTEGER,
  EstimatedFee REAL,
  Priority INTEGER DEFAULT 2,
  Status TEXT DEFAULT 'planned',
  LinkedTreatmentId INTEGER,
  Notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_dtpi_plan ON DentalTreatmentPlanItem(tenant_id, PlanId);

CREATE TABLE IF NOT EXISTS DentalXray (
  XrayId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  XrayType TEXT NOT NULL,
  XraySeries TEXT,
  TeethImaged TEXT,
  ImageCount INTEGER,
  R2Key TEXT,
  ThumbnailR2Key TEXT,
  Reason TEXT,
  Findings TEXT,
  TakenById INTEGER,
  InterpretedById INTEGER,
  InterpretationNotes TEXT,
  RadiationDose REAL,
  TakenDate TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dx_tenant ON DentalXray(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS PeriodontalCharting (
  ChartingId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  ToothNumber TEXT NOT NULL,
  PocketDepthMB INTEGER, PocketDepthB INTEGER, PocketDepthDB INTEGER,
  PocketDepthDL INTEGER, PocketDepthL INTEGER, PocketDepthML INTEGER,
  RecessionMB INTEGER, RecessionB INTEGER, RecessionDB INTEGER,
  RecessionDL INTEGER, RecessionL INTEGER, RecessionML INTEGER,
  BleedingMB INTEGER DEFAULT 0, BleedingB INTEGER DEFAULT 0, BleedingDB INTEGER DEFAULT 0,
  BleedingDL INTEGER DEFAULT 0, BleedingL INTEGER DEFAULT 0, BleedingML INTEGER DEFAULT 0,
  Mobility INTEGER DEFAULT 0,
  Furcation INTEGER DEFAULT 0,
  PlaqueIndex INTEGER DEFAULT 0,
  ClinicalNotes TEXT,
  ChartedById INTEGER,
  ChartedDate TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_perio_tenant ON PeriodontalCharting(tenant_id, PatientId);

-- ═══════════════════════════════════════════════════════════════════
-- 4. PSYCHIATRY
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS MentalStatusExam (
  ExamId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  ExamDate TEXT NOT NULL,
  Appearance TEXT, Behavior TEXT, PsychomotorActivity TEXT,
  SpeechRate TEXT, SpeechVolume TEXT, SpeechQuantity TEXT,
  Mood TEXT, MoodDescription TEXT,
  Affect TEXT, AffectNotes TEXT,
  ThoughtProcess TEXT, ThoughtProcessNotes TEXT,
  SuicidalIdeation INTEGER DEFAULT 0, SuicidalPlan INTEGER DEFAULT 0,
  SuicidalIntent INTEGER DEFAULT 0, HomicidalIdeation INTEGER DEFAULT 0,
  Delusions INTEGER DEFAULT 0, DelusionsType TEXT,
  Hallucinations INTEGER DEFAULT 0, HallucinationsType TEXT,
  Alertness TEXT, Orientation TEXT, OrientationDetails TEXT,
  Memory TEXT, Attention TEXT, Concentration TEXT,
  Insight TEXT, Judgment TEXT,
  SuicideRisk TEXT, ViolenceRisk TEXT, SelfHarmRisk TEXT,
  RiskFactors TEXT, ProtectiveFactors TEXT,
  ClinicalNotes TEXT,
  PerformedById INTEGER NOT NULL,
  PerformedDate TEXT NOT NULL,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mse_tenant ON MentalStatusExam(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_mse_risk ON MentalStatusExam(tenant_id, SuicideRisk);

CREATE TABLE IF NOT EXISTS SuicideRiskAssessment (
  AssessmentId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  AssessmentDate TEXT NOT NULL,
  WishToBeDead INTEGER DEFAULT 0,
  ActiveSuicidalIdeation INTEGER DEFAULT 0,
  ActiveIdeationWithPlan INTEGER DEFAULT 0,
  ActiveIdeationWithIntent INTEGER DEFAULT 0,
  ActualAttempt INTEGER DEFAULT 0,
  ActualAttemptCount INTEGER DEFAULT 0,
  RecentIdeation INTEGER DEFAULT 0,
  RecentAttempt INTEGER DEFAULT 0,
  OverallRisk TEXT,
  RiskLevel INTEGER DEFAULT 0,
  SafetyPlanCreated INTEGER DEFAULT 0,
  Disposition TEXT,
  DispositionNotes TEXT,
  AssessedById INTEGER NOT NULL,
  AssessedDate TEXT NOT NULL,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sra_tenant ON SuicideRiskAssessment(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS TherapySessionNote (
  NoteId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  SessionDate TEXT NOT NULL,
  SessionType TEXT,
  SessionNumber INTEGER,
  Duration INTEGER,
  Modality TEXT,
  ChiefComplaint TEXT,
  SubjectiveNotes TEXT,
  ObjectiveNotes TEXT,
  AssessmentNotes TEXT,
  PlanNotes TEXT,
  PatientEngagement TEXT,
  ProgressTowardsGoals TEXT,
  SessionSuicideRisk TEXT,
  HomeworkAssigned TEXT,
  NextSessionDate TEXT,
  TherapistId INTEGER NOT NULL,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tsn_tenant ON TherapySessionNote(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS PsychiatricEvaluation (
  EvaluationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  EvaluationDate TEXT NOT NULL,
  EvaluationType TEXT,
  ReferralSource TEXT,
  HPI TEXT,
  PsychiatricHistory TEXT,
  MedicalHistory TEXT,
  FamilyPsychiatricHistory TEXT,
  SocialHistory TEXT,
  PrimaryDiagnosis TEXT,
  PrimaryDiagnosisName TEXT,
  SecondaryDiagnoses TEXT,
  GAFScore INTEGER,
  MedicationRecommendations TEXT,
  TherapyRecommendations TEXT,
  FollowupPlan TEXT,
  EvaluatorId INTEGER NOT NULL,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pe_eval_tenant ON PsychiatricEvaluation(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS PsychiatricMedication (
  MedicationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  MedicationName TEXT NOT NULL,
  MedicationClass TEXT,
  Dose TEXT NOT NULL,
  Frequency TEXT NOT NULL,
  Route TEXT DEFAULT 'oral',
  Indication TEXT,
  TargetSymptoms TEXT,
  SideEffects TEXT,
  ResponseStatus TEXT,
  IsControlled INTEGER DEFAULT 0,
  ControlledSchedule TEXT,
  PrescribedById INTEGER NOT NULL,
  PrescribedDate TEXT NOT NULL,
  StartDate TEXT,
  StopDate TEXT,
  StopReason TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pm_tenant ON PsychiatricMedication(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS SafetyPlan (
  PlanId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  AssessmentId INTEGER,
  WarningSigns TEXT,
  CopingStrategies TEXT,
  SocialContacts TEXT,
  FamilySupport TEXT,
  FriendsSupport TEXT,
  TherapistName TEXT, TherapistPhone TEXT,
  CrisisLine TEXT DEFAULT '988',
  EmergencyContact TEXT, EmergencyContactPhone TEXT,
  MeansRestrictionPlan TEXT,
  PatientCommitment TEXT,
  ReviewDate TEXT,
  CreatedById INTEGER NOT NULL,
  CreatedDate TEXT NOT NULL,
  IsActive INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sp_tenant ON SafetyPlan(tenant_id, PatientId);

-- ═══════════════════════════════════════════════════════════════════
-- 5. DICTATION
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS Dictation (
  DictationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  AudioFileName TEXT,
  AudioFileSize INTEGER,
  AudioMimeType TEXT DEFAULT 'audio/mp3',
  AudioDurationSeconds INTEGER,
  R2StorageKey TEXT,
  DictationText TEXT,
  AdditionalNotes TEXT,
  Status TEXT DEFAULT 'pending' CHECK(Status IN ('pending','in-progress','transcribing','completed','cancelled')),
  Priority TEXT DEFAULT 'normal' CHECK(Priority IN ('normal','urgent','stat')),
  AssignedToTranscriberId INTEGER,
  AssignedById INTEGER,
  AssignedAt TEXT,
  StartedAt TEXT,
  CompletedAt TEXT,
  TurnaroundTimeMinutes INTEGER,
  IsSpeechToTextEnabled INTEGER DEFAULT 0,
  CreatedById INTEGER NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  IsActive INTEGER DEFAULT 1,
  DeletedAt TEXT,
  DeletedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dict_tenant ON Dictation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dict_patient ON Dictation(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_dict_status ON Dictation(tenant_id, Status);

CREATE TABLE IF NOT EXISTS DictationTranscription (
  TranscriptionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  DictationId INTEGER NOT NULL,
  TranscriptionText TEXT NOT NULL,
  TranscriptionNotes TEXT,
  Version INTEGER DEFAULT 1,
  IsCurrentVersion INTEGER DEFAULT 1,
  AccuracyScore REAL,
  QualityFlags TEXT,
  TranscriberId INTEGER NOT NULL,
  TranscriberName TEXT,
  CompletedAt TEXT,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dt_tx ON DictationTranscription(tenant_id, DictationId, IsCurrentVersion);

CREATE TABLE IF NOT EXISTS DictationAssignment (
  AssignmentId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  DictationId INTEGER NOT NULL,
  FromTranscriberId INTEGER,
  ToTranscriberId INTEGER NOT NULL,
  AssignedById INTEGER NOT NULL,
  Priority TEXT DEFAULT 'normal',
  DueDate TEXT,
  Status TEXT DEFAULT 'pending',
  Notes TEXT,
  AssignedAt TEXT DEFAULT (datetime('now')),
  CompletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_da_dict ON DictationAssignment(tenant_id, DictationId);

-- ═══════════════════════════════════════════════════════════════════
-- 6. REQUISITIONS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS Requisition (
  RequisitionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  RequisitionNumber TEXT,
  BarcodeNumber TEXT,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  OrderedById INTEGER NOT NULL,
  RecipientType TEXT DEFAULT 'laboratory',
  RecipientId INTEGER,
  RecipientName TEXT,
  Priority TEXT DEFAULT 'routine' CHECK(Priority IN ('routine','urgent','stat','asap')),
  CollectionDate TEXT,
  OrderDate TEXT NOT NULL DEFAULT (date('now')),
  ClinicalIndications TEXT,
  ClinicalNotes TEXT,
  DiagnosisCodes TEXT,
  PrimaryDiagnosisCode TEXT,
  SpecimenType TEXT,
  SpecimenSource TEXT,
  SpecimenContainer TEXT,
  Status TEXT DEFAULT 'draft' CHECK(Status IN ('draft','pending','sample-collected','in-transit','received-by-lab','in-progress','preliminary','completed','verified','cancelled','rejected')),
  TransmissionMethod TEXT DEFAULT 'electronic',
  TransmissionStatus TEXT DEFAULT 'pending',
  BillingStatus TEXT DEFAULT 'pending',
  IsActive INTEGER DEFAULT 1,
  CreatedById INTEGER NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  CancelledAt TEXT,
  CancelledById INTEGER,
  CancelReason TEXT,
  UNIQUE(tenant_id, RequisitionNumber)
);
CREATE INDEX IF NOT EXISTS idx_req_tenant ON Requisition(tenant_id);
CREATE INDEX IF NOT EXISTS idx_req_patient ON Requisition(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_req_status ON Requisition(tenant_id, Status);

CREATE TABLE IF NOT EXISTS RequisitionItem (
  RequisitionItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  RequisitionId INTEGER NOT NULL,
  ItemSequence INTEGER NOT NULL,
  TestCode TEXT NOT NULL,
  TestName TEXT NOT NULL,
  TestType TEXT DEFAULT 'lab_test',
  TestCategory TEXT,
  SpecimenType TEXT,
  ContainerType TEXT,
  DiagnosisCodes TEXT,
  OrderComments TEXT,
  ItemStatus TEXT DEFAULT 'pending',
  ResultValue TEXT,
  ResultAbnormalFlag TEXT,
  CompletedAt TEXT,
  CreatedById INTEGER NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ri_req ON RequisitionItem(tenant_id, RequisitionId);

CREATE TABLE IF NOT EXISTS RequisitionRecipient (
  RecipientId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  RecipientCode TEXT,
  RecipientType TEXT NOT NULL,
  RecipientName TEXT NOT NULL,
  ContactPerson TEXT,
  Phone TEXT, Fax TEXT, Email TEXT,
  AddressLine1 TEXT, City TEXT, State TEXT, ZipCode TEXT,
  TransmissionMethod TEXT DEFAULT 'electronic',
  TurnaroundTimeHours INTEGER,
  IsDefault INTEGER DEFAULT 0,
  IsActive INTEGER DEFAULT 1,
  CreatedById INTEGER NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rr_tenant ON RequisitionRecipient(tenant_id);

CREATE TABLE IF NOT EXISTS RequisitionSpecimen (
  SpecimenId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  RequisitionId INTEGER NOT NULL,
  RequisitionItemId INTEGER,
  SpecimenCode TEXT NOT NULL,
  BarcodeNumber TEXT,
  SpecimenType TEXT NOT NULL,
  CollectionDate TEXT NOT NULL,
  CollectionTime TEXT,
  CollectorId INTEGER,
  CollectorName TEXT,
  Volume TEXT,
  Quality TEXT,
  RejectionReason TEXT,
  ContainerType TEXT,
  TransportCondition TEXT,
  ProcessingStatus TEXT DEFAULT 'pending',
  CreatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, SpecimenCode)
);
CREATE INDEX IF NOT EXISTS idx_rs_req ON RequisitionSpecimen(tenant_id, RequisitionId);

-- ═══════════════════════════════════════════════════════════════════
-- 7. GROUP ATTENDANCE
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS GroupSession (
  SessionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  SessionName TEXT NOT NULL,
  SessionType TEXT DEFAULT 'therapy',
  Description TEXT,
  FacilitatorId INTEGER,
  CoFacilitatorId INTEGER,
  DepartmentId INTEGER,
  LocationName TEXT,
  MaxMembers INTEGER DEFAULT 20,
  RecurrencePattern TEXT,
  ScheduledDate TEXT,
  ScheduledTime TEXT,
  Duration INTEGER DEFAULT 60,
  Status TEXT DEFAULT 'scheduled' CHECK(Status IN ('scheduled','in-progress','completed','cancelled')),
  IsActive INTEGER DEFAULT 1,
  CreatedById INTEGER NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gs_tenant ON GroupSession(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gs_date ON GroupSession(tenant_id, ScheduledDate);

CREATE TABLE IF NOT EXISTS GroupSessionMember (
  MemberId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  SessionId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  EnrollmentDate TEXT NOT NULL,
  Status TEXT DEFAULT 'active' CHECK(Status IN ('active','inactive','completed','withdrawn')),
  Notes TEXT,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, SessionId, PatientId)
);
CREATE INDEX IF NOT EXISTS idx_gsm_session ON GroupSessionMember(tenant_id, SessionId);

CREATE TABLE IF NOT EXISTS GroupSessionAttendance (
  AttendanceId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  SessionId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  AttendanceDate TEXT NOT NULL,
  Status TEXT DEFAULT 'present' CHECK(Status IN ('present','absent','late','excused','cancelled')),
  MoodRating INTEGER,
  ParticipationLevel TEXT,
  ClinicalNotes TEXT,
  MarkedById INTEGER,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gsa_session ON GroupSessionAttendance(tenant_id, SessionId);
CREATE INDEX IF NOT EXISTS idx_gsa_patient ON GroupSessionAttendance(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS GroupSessionNote (
  NoteId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  SessionId INTEGER NOT NULL,
  AttendanceDate TEXT NOT NULL,
  NoteType TEXT DEFAULT 'session',
  SessionTheme TEXT,
  TopicsDiscussed TEXT,
  GroupDynamics TEXT,
  ClinicalObservations TEXT,
  PlanForNextSession TEXT,
  CreatedById INTEGER NOT NULL,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now')),
  DeletedAt TEXT,
  DeletedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gsn_session ON GroupSessionNote(tenant_id, SessionId);

-- ═══════════════════════════════════════════════════════════════════
-- 8. CAMOS (Computer-Assisted Medical Order System)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS CamosCategory (
  CategoryId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  CategoryName TEXT NOT NULL,
  Description TEXT,
  CategoryType TEXT DEFAULT 'clinical',
  DisplayOrder INTEGER DEFAULT 0,
  Icon TEXT,
  Color TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now')),
  DeletedAt TEXT,
  DeletedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cc_tenant ON CamosCategory(tenant_id);

CREATE TABLE IF NOT EXISTS CamosSubcategory (
  SubcategoryId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  CategoryId INTEGER NOT NULL,
  SubcategoryName TEXT NOT NULL,
  Description TEXT,
  DisplayOrder INTEGER DEFAULT 0,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cs_tenant ON CamosSubcategory(tenant_id, CategoryId);

CREATE TABLE IF NOT EXISTS CamosItem (
  ItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  SubcategoryId INTEGER NOT NULL,
  ItemName TEXT NOT NULL,
  ItemCode TEXT,
  ItemContent TEXT NOT NULL,
  ItemTemplate TEXT,
  DefaultContent TEXT,
  ItemType TEXT DEFAULT 'text',
  ScoreWeight REAL DEFAULT 0,
  ScoreMapping TEXT,
  DisplayOrder INTEGER DEFAULT 0,
  IsLocked INTEGER DEFAULT 0,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now')),
  DeletedAt TEXT,
  DeletedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ci_tenant ON CamosItem(tenant_id, SubcategoryId);

CREATE TABLE IF NOT EXISTS CamosAssessment (
  AssessmentId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  AssessmentTitle TEXT,
  AssessmentType TEXT DEFAULT 'standard',
  AssessmentDate TEXT DEFAULT (datetime('now')),
  TemplateId INTEGER,
  ProviderId INTEGER,
  DepartmentId INTEGER,
  Status TEXT DEFAULT 'in_progress' CHECK(Status IN ('draft','in_progress','completed','signed','cancelled')),
  CompletionDate TEXT,
  TotalScore REAL,
  MaxPossibleScore REAL,
  ScorePercentage REAL,
  RiskLevel TEXT,
  Interpretation TEXT,
  ClinicalNotes TEXT,
  FollowupRequired INTEGER DEFAULT 0,
  FollowupNotes TEXT,
  FollowupDate TEXT,
  BillingCodes TEXT,
  DiagnosisCodes TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedById INTEGER NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  DeletedAt TEXT,
  DeletedById INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ca_tenant ON CamosAssessment(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_ca_status ON CamosAssessment(tenant_id, Status);

CREATE TABLE IF NOT EXISTS CamosAssessmentResponse (
  ResponseId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  AssessmentId INTEGER NOT NULL,
  CategoryId INTEGER,
  SubcategoryId INTEGER,
  ItemId INTEGER,
  CategoryName TEXT,
  SubcategoryName TEXT,
  ItemName TEXT,
  ItemCode TEXT,
  ResponseValue TEXT,
  ResponseText TEXT,
  ItemScore REAL DEFAULT 0,
  ScoreNotes TEXT,
  ResponseOrder INTEGER DEFAULT 0,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_car_assess ON CamosAssessmentResponse(tenant_id, AssessmentId);

CREATE TABLE IF NOT EXISTS CamosTemplate (
  TemplateId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  TemplateName TEXT NOT NULL,
  TemplateType TEXT DEFAULT 'standard',
  Specialty TEXT,
  Description TEXT,
  TemplateContent TEXT,
  DisplayOrder INTEGER DEFAULT 0,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ct_tenant ON CamosTemplate(tenant_id);
