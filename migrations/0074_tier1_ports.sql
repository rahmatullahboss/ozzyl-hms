-- ════════════════════════════════════════════════════════════════
-- Migration 0074: Tier 1 Ports from DanpheEMR
-- Features: Appointment Reminders, Procedure Orders, Eye Exam, Queue
-- Ported with tenant_id added for multi-tenancy
-- ════════════════════════════════════════════════════════════════

-- ─── 1. Appointment Reminders ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ReminderSettings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  smsEnabled INTEGER DEFAULT 0,
  emailEnabled INTEGER DEFAULT 0,
  defaultDaysBefore INTEGER DEFAULT 1,
  clinicName TEXT,
  smsTemplate TEXT,
  emailTemplate TEXT,
  twilioSid TEXT,
  twilioToken TEXT,
  twilioPhone TEXT,
  emailFrom TEXT,
  emailFromName TEXT,
  smtpHost TEXT,
  smtpPort INTEGER,
  smtpUsername TEXT,
  smtpPassword TEXT,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_settings_tenant ON ReminderSettings(tenant_id);

CREATE TABLE IF NOT EXISTS AppointmentReminders (
  ReminderId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  AppointmentId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  Method TEXT NOT NULL,          -- 'sms', 'email'
  Status TEXT DEFAULT 'sent',    -- 'sent', 'failed', 'pending'
  Message TEXT,
  SentAt TEXT,
  ErrorMessage TEXT
);

CREATE INDEX IF NOT EXISTS idx_appt_reminders_tenant ON AppointmentReminders(tenant_id, AppointmentId);
CREATE INDEX IF NOT EXISTS idx_appt_reminders_patient ON AppointmentReminders(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS ScheduledReminders (
  ReminderId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  AppointmentId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  Method TEXT NOT NULL,           -- 'sms', 'email', 'both'
  ScheduledFor TEXT NOT NULL,
  DaysBefore INTEGER NOT NULL,
  Message TEXT,
  Status TEXT DEFAULT 'pending',  -- 'pending', 'sent', 'failed', 'cancelled'
  SentAt TEXT,
  ErrorMessage TEXT,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sched_reminders_status ON ScheduledReminders(tenant_id, Status, ScheduledFor);
CREATE INDEX IF NOT EXISTS idx_sched_reminders_appt ON ScheduledReminders(tenant_id, AppointmentId);

-- ─── 2. Procedure Orders ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ProcedureOrder (
  ProcedureOrderId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER NOT NULL,
  ProviderId INTEGER NOT NULL,
  LabId INTEGER,
  DateOrdered TEXT NOT NULL,
  DateCollected TEXT,
  DateTransmitted TEXT,
  OrderPriority TEXT DEFAULT 'routine',
  OrderStatus TEXT DEFAULT 'pending',
  ControlId TEXT,
  ExternalId TEXT,
  SpecimenType TEXT,
  SpecimenLocation TEXT,
  SpecimenVolume TEXT,
  SpecimenFasting TEXT,
  PatientInstructions TEXT,
  ClinicalHx TEXT,
  OrderDiagnosis TEXT,
  BillingType TEXT,
  OrderAbn TEXT DEFAULT 'not_required',
  CollectorId INTEGER,
  ProviderNumber TEXT,
  ProcedureOrderType TEXT DEFAULT 'laboratory_test',
  IsActive INTEGER DEFAULT 1,
  DeletedAt TEXT,
  DeletedById TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_proc_order_tenant_patient ON ProcedureOrder(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_proc_order_encounter ON ProcedureOrder(tenant_id, EncounterId);
CREATE INDEX IF NOT EXISTS idx_proc_order_status ON ProcedureOrder(tenant_id, OrderStatus);
CREATE INDEX IF NOT EXISTS idx_proc_order_date ON ProcedureOrder(tenant_id, DateOrdered);

CREATE TABLE IF NOT EXISTS ProcedureOrderCode (
  ProcedureOrderId INTEGER NOT NULL,
  ProcedureOrderSeq INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  ProcedureCode TEXT NOT NULL,
  ProcedureName TEXT NOT NULL,
  ProcedureSource TEXT DEFAULT '1',
  Diagnoses TEXT,
  DoNotSend INTEGER DEFAULT 0,
  ProcedureOrderTitle TEXT,
  ProcedureType TEXT,
  Transport TEXT,
  DateEnd TEXT,
  ReasonCode TEXT,
  ReasonDescription TEXT,
  ReasonDateLow TEXT,
  ReasonDateHigh TEXT,
  ReasonStatus TEXT,
  PRIMARY KEY (ProcedureOrderId, ProcedureOrderSeq)
);

CREATE INDEX IF NOT EXISTS idx_proc_code_tenant ON ProcedureOrderCode(tenant_id, ProcedureOrderId);

CREATE TABLE IF NOT EXISTS ProcedureResult (
  ProcedureResultId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ProcedureOrderId INTEGER NOT NULL,
  ProcedureOrderSeq INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER NOT NULL,
  ProcedureCode TEXT NOT NULL,
  ProcedureName TEXT,
  ResultDate TEXT NOT NULL,
  ResultStatus TEXT DEFAULT 'final',
  ResultValue TEXT,
  ResultUnits TEXT,
  ResultRange TEXT,
  ResultAbnormalFlag TEXT,
  ResultComments TEXT,
  ResultSource TEXT,
  LabId INTEGER,
  SpecimenId TEXT,
  CollectorId INTEGER,
  VerifiedBy TEXT,
  VerifiedDate TEXT,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_proc_result_tenant_order ON ProcedureResult(tenant_id, ProcedureOrderId);
CREATE INDEX IF NOT EXISTS idx_proc_result_tenant_patient ON ProcedureResult(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_proc_result_date ON ProcedureResult(tenant_id, ResultDate);
CREATE INDEX IF NOT EXISTS idx_proc_result_abnormal ON ProcedureResult(tenant_id, ResultAbnormalFlag);

CREATE TABLE IF NOT EXISTS ProcedureProvider (
  ProviderId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ProviderName TEXT NOT NULL,
  ProviderType TEXT,
  LabDirector TEXT,
  Phone TEXT,
  Fax TEXT,
  Email TEXT,
  Website TEXT,
  AddressLine1 TEXT,
  AddressLine2 TEXT,
  City TEXT,
  State TEXT,
  ZipCode TEXT,
  Country TEXT DEFAULT 'BD',
  NpiNumber TEXT,
  CliaNumber TEXT,
  LicenseNumber TEXT,
  LabType TEXT DEFAULT 'local',
  TransmissionMethod TEXT,
  DirectAddress TEXT,
  Hl7Endpoint TEXT,
  AccountNumber TEXT,
  DefaultBillingType TEXT,
  IsActive INTEGER DEFAULT 1,
  IsDefault INTEGER DEFAULT 0,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_proc_provider_tenant ON ProcedureProvider(tenant_id, ProviderType);
CREATE INDEX IF NOT EXISTS idx_proc_provider_active ON ProcedureProvider(tenant_id, IsActive);

CREATE TABLE IF NOT EXISTS ProcedureOrderRelationships (
  RelationshipId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ProcedureOrderId INTEGER NOT NULL,
  RelatedType TEXT NOT NULL,
  RelatedOrderId INTEGER,
  RelatedEncounterId INTEGER,
  RelatedDocumentId INTEGER,
  RelationshipComment TEXT,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proc_rel_tenant ON ProcedureOrderRelationships(tenant_id, ProcedureOrderId);

CREATE TABLE IF NOT EXISTS ProcedureResultNotes (
  NoteId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ProcedureResultId INTEGER NOT NULL,
  NoteType TEXT DEFAULT 'general',
  NoteText TEXT NOT NULL,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proc_result_note_tenant ON ProcedureResultNotes(tenant_id, ProcedureResultId);

-- ─── 3. Eye Exam ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormEyeExam (
  EyeExamId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  ExamDate TEXT NOT NULL,
  ChiefComplaint TEXT,
  HPI TEXT,
  ReviewOfSystems TEXT,
  IsActive INTEGER DEFAULT 1,
  DeletedAt TEXT,
  DeletedById TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_eye_exam_tenant_patient ON FormEyeExam(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_eye_exam_date ON FormEyeExam(tenant_id, ExamDate);

CREATE TABLE IF NOT EXISTS FormEyeExamAcuity (
  AcuityId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EyeExamId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  SCODVA TEXT, SCOSVA TEXT,
  PHODVA TEXT, PHOSVA TEXT,
  CTLODVA TEXT, CTLOSVA TEXT,
  SCNEARODVA TEXT, SCNEAROSVA TEXT,
  MRNEARODVA TEXT, MRNEAROSVA TEXT,
  GLAREODVA TEXT, GLAREOSVA TEXT, GLARECOMMENTS TEXT,
  RecordedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eye_acuity_tenant ON FormEyeExamAcuity(tenant_id, EyeExamId);

CREATE TABLE IF NOT EXISTS FormEyeExamRefraction (
  RefractionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EyeExamId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  MRODSPH TEXT, MRODCYL TEXT, MRODAXIS TEXT, MRODPRISM TEXT, MRODBASE TEXT, MRODADD TEXT,
  MROSSPH TEXT, MROSCYL TEXT, MROSAXIS TEXT, MROSPRISM TEXT, MROSBASE TEXT, MROSADD TEXT,
  MRODNEARSPHERE TEXT, MRODNEARCYL TEXT, MRODNEARAXIS TEXT,
  MROSNEARSPHERE TEXT, MROSNEARCYL TEXT, MROSNEARAXIS TEXT,
  VertexDistanceOD TEXT, VertexDistanceOS TEXT,
  RecordedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eye_refraction_tenant ON FormEyeExamRefraction(tenant_id, EyeExamId);

CREATE TABLE IF NOT EXISTS FormEyeExamBiometrics (
  BiometricsId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EyeExamId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  ODK1 TEXT, ODK2 TEXT, ODK2AXIS TEXT,
  OSK1 TEXT, OSK2 TEXT, OSK2AXIS TEXT,
  ODAXIALLENGTH TEXT, OSAXIALLENGTH TEXT,
  ODPDMeasured TEXT, OSPDMeasured TEXT,
  ODACD TEXT, OSACD TEXT,
  ODW2W TEXT, OSW2W TEXT,
  ODLT TEXT, OSLT TEXT,
  IOLFormula TEXT,
  IOLPowerOD TEXT, IOLPowerOS TEXT,
  TargetRefraction TEXT,
  IOLManufacturer TEXT, IOLModel TEXT, IOLConstant TEXT, SurgeonFactor TEXT,
  LotNumberOD TEXT, LotNumberOS TEXT,
  SerialNumberOD TEXT, SerialNumberOS TEXT,
  MeasurementQuality TEXT, QualityFlags TEXT,
  DeviceUsed TEXT, TechnicianName TEXT,
  RepeatMeasurement INTEGER DEFAULT 0, RepeatReason TEXT,
  OutlierDetected INTEGER DEFAULT 0, OutlierDetails TEXT,
  RecordedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eye_biometrics_tenant ON FormEyeExamBiometrics(tenant_id, EyeExamId);

CREATE TABLE IF NOT EXISTS FormEyeExamExternal (
  ExternalId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EyeExamId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  RUL TEXT, LUL TEXT, RLL TEXT, LLL TEXT, RBROW TEXT, LBROW TEXT,
  RMCT TEXT, LMCT TEXT, RADNEXA TEXT, LADNEXA TEXT,
  RMRD TEXT, LMRD TEXT, RLF TEXT, LLF TEXT,
  RVFISSURE TEXT, LVFISSURE TEXT,
  ODHERTEL TEXT, OSHERTEL TEXT,
  Comments TEXT,
  RecordedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eye_external_tenant ON FormEyeExamExternal(tenant_id, EyeExamId);

CREATE TABLE IF NOT EXISTS FormEyeExamAntSeg (
  AntSegId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EyeExamId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  ODSCHIRMER1 TEXT, OSSCHIRMER1 TEXT,
  ODSCHIRMER2 TEXT, OSSCHIRMER2 TEXT,
  ODTBUT TEXT, OSTBUT TEXT,
  OSCONJ TEXT, ODCONJ TEXT,
  ODCORNEA TEXT, OSCORNEA TEXT,
  ODAC TEXT, OSAC TEXT,
  ODLENS TEXT, OSLENS TEXT,
  ODIRIS TEXT, OSIRIS TEXT,
  PUPIL_NORMAL INTEGER DEFAULT 1,
  ODPUPILSIZE1 TEXT, OSPUPILSIZE1 TEXT,
  ODPUPILREACT TEXT, OSPUPILREACT TEXT,
  ODIOPAP TEXT, OSIOPAP TEXT,
  ODIOPNCT TEXT, OSIOPNCT TEXT,
  IOPTIME TEXT,
  Comments TEXT,
  RecordedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eye_antseg_tenant ON FormEyeExamAntSeg(tenant_id, EyeExamId);

CREATE TABLE IF NOT EXISTS FormEyeExamFundus (
  FundusId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EyeExamId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  ODVITREOUS TEXT, OSVITREOUS TEXT,
  ODDISC TEXT, OSDISC TEXT,
  ODMACULA TEXT, OSMACULA TEXT,
  ODVESSELS TEXT, OSVESSELS TEXT,
  ODPERIPHERY TEXT, OSPERIPHERY TEXT,
  ODCDRatio TEXT, OSCDRatio TEXT,
  Comments TEXT,
  RecordedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eye_fundus_tenant ON FormEyeExamFundus(tenant_id, EyeExamId);

CREATE TABLE IF NOT EXISTS FormEyeExamAssessment (
  AssessmentId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EyeExamId INTEGER NOT NULL,
  PatientId INTEGER NOT NULL,
  DiagnosisOD TEXT, DiagnosisOS TEXT,
  DiagnosisCodeOD TEXT, DiagnosisCodeOS TEXT,
  Assessment TEXT,
  Plan TEXT,
  FollowupDays INTEGER, FollowupInstructions TEXT,
  SpectacleRxOD TEXT, SpectacleRxOS TEXT, SpectacleComments TEXT,
  ContactLensOD TEXT, ContactLensOS TEXT, ContactLensComments TEXT,
  SurgeryRecommended INTEGER DEFAULT 0,
  SurgeryType TEXT, SurgeryEye TEXT, SurgeryDate TEXT,
  ImagingData TEXT, OctImages TEXT, FundusPhotos TEXT,
  VisualFieldData TEXT, CornealTopographyData TEXT, OtherImaging TEXT,
  IsActive INTEGER DEFAULT 1,
  DeletedAt TEXT, DeletedById TEXT,
  RecordedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eye_assessment_tenant ON FormEyeExamAssessment(tenant_id, EyeExamId);

CREATE TABLE IF NOT EXISTS FormEyeExamPrefs (
  PrefsId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  ProviderId TEXT NOT NULL,
  DefaultAcuityMethod TEXT DEFAULT 'SNELLEN',
  DefaultIOLFormula TEXT DEFAULT 'SRK/T',
  ShowBiometrics INTEGER DEFAULT 1,
  ShowRefraction INTEGER DEFAULT 1,
  ShowFundus INTEGER DEFAULT 1,
  DefaultAssessmentTemplate TEXT,
  DefaultPlanTemplate TEXT,
  UpdatedAt TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eye_prefs_tenant_provider ON FormEyeExamPrefs(tenant_id, ProviderId);

-- ─── 4. Queue Management (uses existing visits table) ──────────────────────
-- No new tables needed — queue works off existing visits + appointments.
-- Adding queue_no column to visits if not present.

-- Note: HMS `visits` table already exists. Queue management reads from it.
-- If queue_no column doesn't exist, you may need:
-- ALTER TABLE visits ADD COLUMN queue_no INTEGER;
-- (Skipped here since it may already exist — run manually if needed)
