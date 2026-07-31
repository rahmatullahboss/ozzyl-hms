-- ════════════════════════════════════════════════════════════════
-- Migration 0073: Clinical Forms (EHR Gap Closure)
-- Ported from danphe-next-cloudflare with tenant_id added
-- Tables: SDOH, ROS, Pain Map, Physical Exam, Care Plans,
--         Aftercare, Transfer, Instructions, Observation,
--         Dictation, Clinic Note, Functional/Cognitive Status
-- ════════════════════════════════════════════════════════════════

-- ─── 1. SDOH (Social Determinants of Health) ─────────────────────────────────
-- Split into 2 tables due to D1/SQLite 100-column limit

CREATE TABLE IF NOT EXISTS FormSDOH (
  SDOHId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  Education TEXT,
  Disability TEXT,
  Housing TEXT,
  HousingOtherInput TEXT,
  WorkTemporary INTEGER DEFAULT 0,
  WorkSeasonal INTEGER DEFAULT 0,
  WorkLooking INTEGER DEFAULT 0,
  WorkRetired INTEGER DEFAULT 0,
  WorkDisabled INTEGER DEFAULT 0,
  WorkHours REAL,
  HHSize INTEGER,
  HHIncome REAL,
  CareUnder5 INTEGER DEFAULT 0,
  Care5To12 INTEGER DEFAULT 0,
  CareOver12 INTEGER DEFAULT 0,
  CareSpecNeeds INTEGER DEFAULT 0,
  CareDisabled INTEGER DEFAULT 0,
  CareElderly INTEGER DEFAULT 0,
  CareOther INTEGER DEFAULT 0,
  CareOtherInput TEXT,
  DebtMedical INTEGER DEFAULT 0,
  DebtCreditCards INTEGER DEFAULT 0,
  DebtRent INTEGER DEFAULT 0,
  DebtStudentLoans INTEGER DEFAULT 0,
  DebtTaxes INTEGER DEFAULT 0,
  DebtLegal INTEGER DEFAULT 0,
  DebtCar INTEGER DEFAULT 0,
  DebtUtilities INTEGER DEFAULT 0,
  DebtOther INTEGER DEFAULT 0,
  DebtOtherInput TEXT,
  MoneyFood INTEGER DEFAULT 0,
  MoneyMedical INTEGER DEFAULT 0,
  MoneyChildcare INTEGER DEFAULT 0,
  MoneyUtilities INTEGER DEFAULT 0,
  MoneyPhone INTEGER DEFAULT 0,
  MoneyRent INTEGER DEFAULT 0,
  MoneyTransportation INTEGER DEFAULT 0,
  MoneyClothing INTEGER DEFAULT 0,
  MoneyEducation INTEGER DEFAULT 0,
  MoneyOther INTEGER DEFAULT 0,
  MoneyOtherInput TEXT,
  TransportMedical INTEGER DEFAULT 0,
  TransportFood INTEGER DEFAULT 0,
  TransportWork INTEGER DEFAULT 0,
  TransportSchool INTEGER DEFAULT 0,
  TransportFamily INTEGER DEFAULT 0,
  TransportOther INTEGER DEFAULT 0,
  TransportOtherInput TEXT,
  MedicalNoInsurance INTEGER DEFAULT 0,
  MedicalCopay INTEGER DEFAULT 0,
  MedicalNotCovered INTEGER DEFAULT 0,
  MedicalWork INTEGER DEFAULT 0,
  MedicalNoProvider INTEGER DEFAULT 0,
  MedicalUnderstand INTEGER DEFAULT 0,
  MedicalTrust INTEGER DEFAULT 0,
  MedicalChildcare INTEGER DEFAULT 0,
  MedicalOther INTEGER DEFAULT 0,
  MedicalOtherInput TEXT,
  Dentist TEXT,
  DentistOtherInput TEXT,
  Social TEXT,
  Stress TEXT,
  StressDeath INTEGER DEFAULT 0,
  StressDivorce INTEGER DEFAULT 0,
  StressJob INTEGER DEFAULT 0,
  StressMoved INTEGER DEFAULT 0,
  StressIllness INTEGER DEFAULT 0,
  StressVictim INTEGER DEFAULT 0,
  StressWitness INTEGER DEFAULT 0,
  StressLegal INTEGER DEFAULT 0,
  StressHomeless INTEGER DEFAULT 0,
  StressIncarcerated INTEGER DEFAULT 0,
  StressBankruptcy INTEGER DEFAULT 0,
  StressMarriage INTEGER DEFAULT 0,
  StressBirth INTEGER DEFAULT 0,
  StressAdultChild INTEGER DEFAULT 0,
  StressOther INTEGER DEFAULT 0,
  StressOtherInput TEXT,
  Safety TEXT,
  PartnerSafety TEXT,
  Female TEXT,
  Addiction TEXT,
  ArmedServices TEXT,
  Refugee TEXT,
  TotalScore INTEGER DEFAULT 0,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sdoh_tenant_patient ON FormSDOH(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_sdoh_patient_date ON FormSDOH(tenant_id, PatientId, CreatedAt);

CREATE TABLE IF NOT EXISTS FormSDOH_Extra (
  ExtraId INTEGER PRIMARY KEY AUTOINCREMENT,
  SDOHId INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  DiscrimRace INTEGER DEFAULT 0,
  DiscrimGender INTEGER DEFAULT 0,
  DiscrimSexPref INTEGER DEFAULT 0,
  DiscrimGenExp INTEGER DEFAULT 0,
  DiscrimReligion INTEGER DEFAULT 0,
  DiscrimDisability INTEGER DEFAULT 0,
  DiscrimAge INTEGER DEFAULT 0,
  DiscrimWeight INTEGER DEFAULT 0,
  DiscrimSES INTEGER DEFAULT 0,
  DiscrimEdu INTEGER DEFAULT 0,
  DiscrimMarital INTEGER DEFAULT 0,
  DiscrimCitizen INTEGER DEFAULT 0,
  DiscrimAccent INTEGER DEFAULT 0,
  DiscrimCriminalHist INTEGER DEFAULT 0,
  DiscrimOther INTEGER DEFAULT 0,
  DiscrimOtherInput TEXT,
  DisplaceWork INTEGER DEFAULT 0,
  DisplaceHousing INTEGER DEFAULT 0,
  DisplaceHealth INTEGER DEFAULT 0,
  DisplaceLaw INTEGER DEFAULT 0,
  DisplaceEdu INTEGER DEFAULT 0,
  DisplacePublic INTEGER DEFAULT 0,
  DisplaceClubs INTEGER DEFAULT 0,
  DisplaceGovt INTEGER DEFAULT 0,
  DisplaceFinance INTEGER DEFAULT 0,
  DisplaceOther INTEGER DEFAULT 0,
  DisplaceOtherInput TEXT,
  Contact TEXT,
  ContactOtherInput TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sdoh_extra ON FormSDOH_Extra(SDOHId);
CREATE INDEX IF NOT EXISTS idx_sdoh_extra_patient ON FormSDOH_Extra(tenant_id, PatientId);

-- ─── 2. Review of Systems (ROS) ─────────────────────────────────────────────
-- Split into 2 tables due to D1/SQLite 100-column limit

CREATE TABLE IF NOT EXISTS FormROS (
  ROSId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  Activity INTEGER NOT NULL DEFAULT 1,
  -- Constitutional
  WeightChange TEXT DEFAULT 'N/A',
  Weakness TEXT DEFAULT 'N/A',
  Fatigue TEXT DEFAULT 'N/A',
  Anorexia TEXT DEFAULT 'N/A',
  Fever TEXT DEFAULT 'N/A',
  Chills TEXT DEFAULT 'N/A',
  NightSweats TEXT DEFAULT 'N/A',
  Insomnia TEXT DEFAULT 'N/A',
  Irritability TEXT DEFAULT 'N/A',
  HeatOrCold TEXT DEFAULT 'N/A',
  Intolerance TEXT DEFAULT 'N/A',
  -- Eyes
  ChangeInVision TEXT DEFAULT 'N/A',
  GlaucomaHistory TEXT DEFAULT 'N/A',
  EyePain TEXT DEFAULT 'N/A',
  Irritation TEXT DEFAULT 'N/A',
  Redness TEXT DEFAULT 'N/A',
  ExcessiveTearing TEXT DEFAULT 'N/A',
  DoubleVision TEXT DEFAULT 'N/A',
  BlindSpots TEXT DEFAULT 'N/A',
  Photophobia TEXT DEFAULT 'N/A',
  -- Ears/Nose/Throat
  HearingLoss TEXT DEFAULT 'N/A',
  Discharge TEXT DEFAULT 'N/A',
  Pain TEXT DEFAULT 'N/A',
  Vertigo TEXT DEFAULT 'N/A',
  Tinnitus TEXT DEFAULT 'N/A',
  FrequentColds TEXT DEFAULT 'N/A',
  SoreThroat TEXT DEFAULT 'N/A',
  SinusProblems TEXT DEFAULT 'N/A',
  PostNasalDrip TEXT DEFAULT 'N/A',
  Nosebleed TEXT DEFAULT 'N/A',
  Snoring TEXT DEFAULT 'N/A',
  Apnea TEXT DEFAULT 'N/A',
  -- Breast
  BreastMass TEXT DEFAULT 'N/A',
  BreastDischarge TEXT DEFAULT 'N/A',
  Biopsy TEXT DEFAULT 'N/A',
  AbnormalMammogram TEXT DEFAULT 'N/A',
  -- Respiratory
  Cough TEXT DEFAULT 'N/A',
  Sputum TEXT DEFAULT 'N/A',
  ShortnessOfBreath TEXT DEFAULT 'N/A',
  Wheezing TEXT DEFAULT 'N/A',
  Hemoptsyis TEXT DEFAULT 'N/A',
  Asthma TEXT DEFAULT 'N/A',
  COPD TEXT DEFAULT 'N/A',
  -- Cardiovascular
  ChestPain TEXT DEFAULT 'N/A',
  Palpitation TEXT DEFAULT 'N/A',
  Syncope TEXT DEFAULT 'N/A',
  PND TEXT DEFAULT 'N/A',
  DOE TEXT DEFAULT 'N/A',
  Orthopnea TEXT DEFAULT 'N/A',
  Peripheal TEXT DEFAULT 'N/A',
  Edema TEXT DEFAULT 'N/A',
  LegPainCramping TEXT DEFAULT 'N/A',
  HistoryMurmur TEXT DEFAULT 'N/A',
  Arrythmia TEXT DEFAULT 'N/A',
  HeartProblem TEXT DEFAULT 'N/A',
  -- Gastrointestinal
  Dysphagia TEXT DEFAULT 'N/A',
  Heartburn TEXT DEFAULT 'N/A',
  Bloating TEXT DEFAULT 'N/A',
  Belching TEXT DEFAULT 'N/A',
  Flatulence TEXT DEFAULT 'N/A',
  Nausea TEXT DEFAULT 'N/A',
  Vomiting TEXT DEFAULT 'N/A',
  Hematemesis TEXT DEFAULT 'N/A',
  GastroPain TEXT DEFAULT 'N/A',
  FoodIntolerance TEXT DEFAULT 'N/A',
  Hepatitis TEXT DEFAULT 'N/A',
  Jaundice TEXT DEFAULT 'N/A',
  Hematochezia TEXT DEFAULT 'N/A',
  ChangedBowel TEXT DEFAULT 'N/A',
  Diarrhea TEXT DEFAULT 'N/A',
  Constipation TEXT DEFAULT 'N/A',
  -- Genitourinary
  Polyuria TEXT DEFAULT 'N/A',
  Polydypsia TEXT DEFAULT 'N/A',
  Dysuria TEXT DEFAULT 'N/A',
  Hematuria TEXT DEFAULT 'N/A',
  Frequency TEXT DEFAULT 'N/A',
  Urgency TEXT DEFAULT 'N/A',
  Incontinence TEXT DEFAULT 'N/A',
  RenalStones TEXT DEFAULT 'N/A',
  UTIs TEXT DEFAULT 'N/A',
  Hesitancy TEXT DEFAULT 'N/A',
  Dribbling TEXT DEFAULT 'N/A',
  Stream TEXT DEFAULT 'N/A',
  Nocturia TEXT DEFAULT 'N/A',
  Erections TEXT DEFAULT 'N/A',
  Ejaculations TEXT DEFAULT 'N/A',
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ros_tenant_patient ON FormROS(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS FormROS_Extra (
  ExtraId INTEGER PRIMARY KEY AUTOINCREMENT,
  ROSId INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  -- Reproductive (Female)
  FemaleG TEXT DEFAULT 'N/A',
  FemaleP TEXT DEFAULT 'N/A',
  FemaleAP TEXT DEFAULT 'N/A',
  FemaleLC TEXT DEFAULT 'N/A',
  Menarche TEXT DEFAULT 'N/A',
  Menopause TEXT DEFAULT 'N/A',
  LMP TEXT DEFAULT 'N/A',
  MenstrualFrequency TEXT DEFAULT 'N/A',
  MenstrualFlow TEXT DEFAULT 'N/A',
  FemaleSymptoms TEXT DEFAULT 'N/A',
  AbnormalHairGrowth TEXT DEFAULT 'N/A',
  FHirsutism TEXT DEFAULT 'N/A',
  -- Musculoskeletal
  JointPain TEXT DEFAULT 'N/A',
  Swelling TEXT DEFAULT 'N/A',
  MuscRedness TEXT DEFAULT 'N/A',
  MuscWarm TEXT DEFAULT 'N/A',
  MuscStiffness TEXT DEFAULT 'N/A',
  Muscle TEXT DEFAULT 'N/A',
  MuscAches TEXT DEFAULT 'N/A',
  FMS TEXT DEFAULT 'N/A',
  Arthritis TEXT DEFAULT 'N/A',
  -- Neurological
  LOC TEXT DEFAULT 'N/A',
  Seizures TEXT DEFAULT 'N/A',
  Stroke TEXT DEFAULT 'N/A',
  TIA TEXT DEFAULT 'N/A',
  NeuroNumbness TEXT DEFAULT 'N/A',
  NeuroWeakness TEXT DEFAULT 'N/A',
  Paralysis TEXT DEFAULT 'N/A',
  IntellectualDecline TEXT DEFAULT 'N/A',
  MemoryProblems TEXT DEFAULT 'N/A',
  Dementia TEXT DEFAULT 'N/A',
  Headache TEXT DEFAULT 'N/A',
  -- Skin
  SkinCancer TEXT DEFAULT 'N/A',
  Psoriasis TEXT DEFAULT 'N/A',
  Acne TEXT DEFAULT 'N/A',
  SkinOther TEXT DEFAULT 'N/A',
  SkinDisease TEXT DEFAULT 'N/A',
  -- Psychiatric
  PsychDiagnosis TEXT DEFAULT 'N/A',
  PsychMedication TEXT DEFAULT 'N/A',
  Depression TEXT DEFAULT 'N/A',
  Anxiety TEXT DEFAULT 'N/A',
  SocialDifficulties TEXT DEFAULT 'N/A',
  -- Endocrine
  ThyroidProblems TEXT DEFAULT 'N/A',
  Diabetes TEXT DEFAULT 'N/A',
  -- Hematologic/Immunologic
  AbnormalBlood TEXT DEFAULT 'N/A',
  Anemia TEXT DEFAULT 'N/A',
  FHBloodProblems TEXT DEFAULT 'N/A',
  BleedingProblems TEXT DEFAULT 'N/A',
  Allergies TEXT DEFAULT 'N/A',
  FrequentIllness TEXT DEFAULT 'N/A',
  HIV TEXT DEFAULT 'N/A',
  HAIStatus TEXT DEFAULT 'N/A'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ros_extra ON FormROS_Extra(ROSId);
CREATE INDEX IF NOT EXISTS idx_ros_extra_patient ON FormROS_Extra(tenant_id, PatientId);

-- ─── 3. Pain Map ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormPainMap (
  PainMapId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  PainData TEXT NOT NULL,  -- JSON: [{x, y, painLevel, notes, bodyPart}]
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_painmap_tenant_patient ON FormPainMap(tenant_id, PatientId);

-- ─── 4. Physical Exam ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS PhysicalExamTemplate (
  TemplateId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  TemplateName TEXT NOT NULL,
  TemplateCode TEXT NOT NULL,
  Description TEXT,
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_template_code ON PhysicalExamTemplate(tenant_id, TemplateCode);

CREATE TABLE IF NOT EXISTS PhysicalExamLine (
  LineId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  Category TEXT NOT NULL,
  LineName TEXT NOT NULL,
  DefaultFinding TEXT DEFAULT 'Within Normal Limits',
  SortOrder INTEGER DEFAULT 0,
  IsActive INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pe_line_tenant ON PhysicalExamLine(tenant_id, Category);

CREATE TABLE IF NOT EXISTS FormPhysicalExam (
  ExamId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  TemplateId INTEGER,
  ExamFindings TEXT NOT NULL,          -- JSON: {category: {line: {status, finding, notes}}}
  AbnormalFindings TEXT,               -- JSON: [{category, line, finding}]
  DiagnosisCodes TEXT,                 -- JSON: ["ICD10-CODE"]
  GeneralNotes TEXT,
  IsDeleted INTEGER DEFAULT 0,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_pe_form_tenant_patient ON FormPhysicalExam(tenant_id, PatientId);

CREATE TABLE IF NOT EXISTS PhysicalExamComments (
  CommentId INTEGER PRIMARY KEY AUTOINCREMENT,
  ExamId INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  Category TEXT NOT NULL,
  LineName TEXT NOT NULL,
  Finding TEXT,
  ICD10Code TEXT,
  Comment TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pe_comments_exam ON PhysicalExamComments(ExamId);

-- Seed standard physical exam lines (global template, tenant_id = '0' for system-wide)
INSERT OR IGNORE INTO PhysicalExamLine (tenant_id, Category, LineName, DefaultFinding, SortOrder) VALUES
  ('0', 'GEN', 'General Appearance', 'Within Normal Limits', 1),
  ('0', 'GEN', 'Nutrition/Hydration', 'Within Normal Limits', 2),
  ('0', 'GEN', 'Development', 'Within Normal Limits', 3),
  ('0', 'EYE', 'Conjunctiva/Sclera', 'Within Normal Limits', 4),
  ('0', 'EYE', 'Pupils (PERRLA)', 'Within Normal Limits', 5),
  ('0', 'EYE', 'Extraocular Movements', 'Within Normal Limits', 6),
  ('0', 'ENT', 'External Ear/Canal', 'Within Normal Limits', 7),
  ('0', 'ENT', 'Tympanic Membranes', 'Within Normal Limits', 8),
  ('0', 'ENT', 'Nasal Mucosa/Septum', 'Within Normal Limits', 9),
  ('0', 'ENT', 'Oropharynx', 'Within Normal Limits', 10),
  ('0', 'HEART', 'Heart Rate/Rhythm', 'Within Normal Limits', 11),
  ('0', 'HEART', 'Heart Sounds', 'Within Normal Limits', 12),
  ('0', 'HEART', 'Murmurs', 'Within Normal Limits', 13),
  ('0', 'LUNG', 'Breath Sounds', 'Within Normal Limits', 14),
  ('0', 'LUNG', 'Respiratory Effort', 'Within Normal Limits', 15),
  ('0', 'LUNG', 'Percussion', 'Within Normal Limits', 16),
  ('0', 'GI', 'Abdomen Inspection', 'Within Normal Limits', 17),
  ('0', 'GI', 'Bowel Sounds', 'Within Normal Limits', 18),
  ('0', 'GI', 'Palpation/Tenderness', 'Within Normal Limits', 19),
  ('0', 'GI', 'Organomegaly', 'Within Normal Limits', 20),
  ('0', 'GU', 'External Genitalia', 'Within Normal Limits', 21),
  ('0', 'GU', 'Bladder', 'Within Normal Limits', 22),
  ('0', 'NEURO', 'Cranial Nerves', 'Within Normal Limits', 23),
  ('0', 'NEURO', 'Motor Strength', 'Within Normal Limits', 24),
  ('0', 'NEURO', 'Sensory', 'Within Normal Limits', 25),
  ('0', 'NEURO', 'Reflexes', 'Within Normal Limits', 26),
  ('0', 'MSK', 'Gait/Station', 'Within Normal Limits', 27),
  ('0', 'MSK', 'Range of Motion', 'Within Normal Limits', 28),
  ('0', 'SKIN', 'Skin Inspection', 'Within Normal Limits', 29),
  ('0', 'PSY', 'Mood/Affect', 'Within Normal Limits', 30);

-- Seed standard exam templates
INSERT OR IGNORE INTO PhysicalExamTemplate (tenant_id, TemplateName, TemplateCode, Description) VALUES
  ('0', 'Annual Physical Exam', 'ANNUAL', 'Comprehensive annual physical examination'),
  ('0', 'Sports Physical', 'SPORTS', 'Pre-participation sports physical'),
  ('0', 'Pre-Employment Physical', 'PRE_EMP', 'Pre-employment examination'),
  ('0', 'Focused Exam', 'FOCUSED', 'Problem-focused physical examination');

-- ─── 5. Care Plans ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS CLN_CarePlan (
  CarePlanId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  Title TEXT NOT NULL,
  CarePlanType TEXT DEFAULT 'treatment' CHECK(CarePlanType IN ('treatment','preventive','follow_up','chronic_management','palliative','rehabilitation','wellness')),
  Status TEXT DEFAULT 'active' CHECK(Status IN ('draft','active','on_hold','completed','cancelled','entered_in_error')),
  Reason TEXT,
  StartDate TEXT,
  EndDate TEXT,
  ReviewDate TEXT,
  IsDeleted INTEGER DEFAULT 0,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_careplan_tenant_patient ON CLN_CarePlan(tenant_id, PatientId);
CREATE INDEX IF NOT EXISTS idx_careplan_status ON CLN_CarePlan(tenant_id, PatientId, Status);

CREATE TABLE IF NOT EXISTS CLN_CarePlanGoal (
  GoalId INTEGER PRIMARY KEY AUTOINCREMENT,
  CarePlanId INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  GoalType TEXT DEFAULT 'outcome' CHECK(GoalType IN ('outcome','process','patient','clinical')),
  Description TEXT NOT NULL,
  TargetDate TEXT,
  Priority INTEGER DEFAULT 3 CHECK(Priority BETWEEN 1 AND 5),
  Status TEXT DEFAULT 'in_progress' CHECK(Status IN ('proposed','planned','accepted','in_progress','achieved','sustaining','on_hold','cancelled','not_achieved')),
  MeasurementCriteria TEXT,
  BaselineValue TEXT,
  TargetValue TEXT,
  CurrentValue TEXT,
  ProgressPercentage INTEGER DEFAULT 0,
  Notes TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_cpgoal_careplan ON CLN_CarePlanGoal(CarePlanId);

CREATE TABLE IF NOT EXISTS CLN_CarePlanIntervention (
  InterventionId INTEGER PRIMARY KEY AUTOINCREMENT,
  CarePlanId INTEGER NOT NULL,
  GoalId INTEGER,
  tenant_id TEXT NOT NULL,
  InterventionType TEXT DEFAULT 'therapy' CHECK(InterventionType IN ('medication','therapy','education','lifestyle','referral','monitoring','procedure','dietary','exercise','counseling')),
  Description TEXT NOT NULL,
  Frequency TEXT,
  Duration TEXT,
  Status TEXT DEFAULT 'active' CHECK(Status IN ('planned','active','completed','cancelled','on_hold')),
  Instructions TEXT,
  AssignedToId TEXT,
  AssignedToName TEXT,
  StartDate TEXT,
  EndDate TEXT,
  Notes TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_cpintervention_careplan ON CLN_CarePlanIntervention(CarePlanId);

CREATE TABLE IF NOT EXISTS CLN_CarePlanTask (
  TaskId INTEGER PRIMARY KEY AUTOINCREMENT,
  CarePlanId INTEGER NOT NULL,
  InterventionId INTEGER,
  tenant_id TEXT NOT NULL,
  TaskType TEXT DEFAULT 'clinical' CHECK(TaskType IN ('clinical','administrative','patient','follow_up','referral','documentation')),
  Description TEXT NOT NULL,
  DueDate TEXT,
  Priority TEXT DEFAULT 'medium' CHECK(Priority IN ('low','medium','high','urgent')),
  Status TEXT DEFAULT 'pending' CHECK(Status IN ('pending','in_progress','completed','cancelled','overdue')),
  AssignedToId TEXT,
  AssignedToName TEXT,
  CompletedAt TEXT,
  CompletedById TEXT,
  ReminderDate TEXT,
  Notes TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now')),
  UpdatedAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_cptask_careplan ON CLN_CarePlanTask(CarePlanId);
CREATE INDEX IF NOT EXISTS idx_cptask_status ON CLN_CarePlanTask(tenant_id, Status);

CREATE TABLE IF NOT EXISTS CLN_CarePlanTeamMember (
  MemberId INTEGER PRIMARY KEY AUTOINCREMENT,
  CarePlanId INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  MemberType TEXT DEFAULT 'internal' CHECK(MemberType IN ('internal','external')),
  MemberName TEXT NOT NULL,
  MemberRole TEXT,
  StaffId TEXT,
  ExternalProvider TEXT,
  ContactInfo TEXT,
  InvolvementLevel TEXT DEFAULT 'primary' CHECK(InvolvementLevel IN ('primary','secondary','consulting','referred')),
  IsActive INTEGER DEFAULT 1,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cpteam_careplan ON CLN_CarePlanTeamMember(CarePlanId);

CREATE TABLE IF NOT EXISTS CLN_CarePlanProgressNote (
  NoteId INTEGER PRIMARY KEY AUTOINCREMENT,
  CarePlanId INTEGER NOT NULL,
  GoalId INTEGER,
  tenant_id TEXT NOT NULL,
  NoteType TEXT DEFAULT 'progress' CHECK(NoteType IN ('progress','barrier','achievement','modification','review','discharge')),
  NoteText TEXT NOT NULL,
  CreatedById TEXT NOT NULL,
  CreatedByName TEXT,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cpprogress_careplan ON CLN_CarePlanProgressNote(CarePlanId);

-- ─── 6. Aftercare Plan ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormAftercarePlan (
  AftercarePlanId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  ClientName TEXT,
  Provider TEXT,
  AdmitDate TEXT,
  DischargedDate TEXT,
  GoalAAcuteIntoxication TEXT,
  GoalAAcuteIntoxicationI TEXT,
  GoalAAcuteIntoxicationII TEXT,
  GoalBEmotionalBehavioralConditions TEXT,
  GoalBEmotionalBehavioralConditionsI TEXT,
  GoalCRelapsePotential TEXT,
  GoalCRelapsePotentialI TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aftercare_tenant_patient ON FormAftercarePlan(tenant_id, PatientId);

-- ─── 7. Transfer Summary ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormTransferSummary (
  TransferSummaryId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  ClientName TEXT,
  Provider TEXT,
  TransferTo TEXT,
  TransferDate TEXT,
  StatusOfAdmission TEXT,
  Diagnosis TEXT,
  InterventionProvided TEXT,
  OverallStatusOfDischarge TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transfer_tenant_patient ON FormTransferSummary(tenant_id, PatientId);

-- ─── 8. Clinical Instructions ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormClinicalInstructions (
  InstructionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  Instruction TEXT NOT NULL,
  Activity INTEGER DEFAULT 1,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_instructions_tenant_patient ON FormClinicalInstructions(tenant_id, PatientId);

-- ─── 9. Observation ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormObservation (
  ObservationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  ObservationDate TEXT,
  Code TEXT,
  Observation TEXT,
  ObValue TEXT,
  ObUnit TEXT,
  Description TEXT,
  CodeType TEXT,
  TableCode TEXT,
  ObCode TEXT,
  ObType TEXT,
  ObStatus TEXT,
  ResultStatus TEXT,
  ObReasonStatus TEXT,
  ObReasonCode TEXT,
  ObReasonText TEXT,
  ObDocumentationOfTable TEXT,
  ObDocumentationOfTableId INTEGER,
  DateEnd TEXT,
  ParentObservationId INTEGER,
  Category TEXT,
  QuestionnaireResponseId INTEGER,
  Activity INTEGER DEFAULT 1,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observation_tenant_patient ON FormObservation(tenant_id, PatientId);

-- ─── 10. Dictation ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormDictation (
  DictationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  Dictation TEXT,
  AdditionalNotes TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dictation_tenant_patient ON FormDictation(tenant_id, PatientId);

-- ─── 11. Clinic Note ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormClinicNote (
  ClinicNoteId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  History TEXT,
  Examination TEXT,
  Plan TEXT,
  FollowupRequired INTEGER DEFAULT 0,
  FollowupTiming TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clinicnote_tenant_patient ON FormClinicNote(tenant_id, PatientId);

-- ─── 12. Functional/Cognitive Status ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS FormFunctionalCognitiveStatus (
  StatusId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  PatientId INTEGER NOT NULL,
  EncounterId INTEGER,
  Code TEXT,
  CodeText TEXT,
  StatusDate TEXT,
  IsCognitive INTEGER DEFAULT 0,
  Description TEXT,
  CreatedById TEXT NOT NULL,
  CreatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_funcstatus_tenant_patient ON FormFunctionalCognitiveStatus(tenant_id, PatientId);
