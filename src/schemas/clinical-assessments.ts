import { z } from 'zod';

const icd11Pattern = /^[A-Z0-9]{2,6}(\.[A-Z0-9]{1,4})?$/;

// ─── PHQ-9 ─────────────────────────────────────────────────────────────────
const phq9ItemScore = z.number().int().min(0).max(3);

export const createPHQ9Schema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  InterestScore: phq9ItemScore.default(0),
  HopelessScore: phq9ItemScore.default(0),
  SleepScore: phq9ItemScore.default(0),
  FatigueScore: phq9ItemScore.default(0),
  AppetiteScore: phq9ItemScore.default(0),
  FailureScore: phq9ItemScore.default(0),
  FocusScore: phq9ItemScore.default(0),
  PsychomotorScore: phq9ItemScore.default(0),
  SuicideScore: phq9ItemScore.default(0),
  Difficulty: z.string().optional(),
});

// ─── GAD-7 ─────────────────────────────────────────────────────────────────
const gad7ItemScore = z.number().int().min(0).max(3);

export const createGAD7Schema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  NervousScore: gad7ItemScore.default(0),
  ControlWorryScore: gad7ItemScore.default(0),
  WorryScore: gad7ItemScore.default(0),
  RelaxScore: gad7ItemScore.default(0),
  RestlessScore: gad7ItemScore.default(0),
  IrritableScore: gad7ItemScore.default(0),
  FearScore: gad7ItemScore.default(0),
  Difficulty: z.string().optional(),
});

// ─── SOAP Notes ────────────────────────────────────────────────────────────
export const createSOAPSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  ChiefComplaint: z.string().optional(),
  Subjective: z.string().optional(),
  Objective: z.string().optional(),
  Assessment: z.string().optional(),
  Plan: z.string().optional(),
}).refine(
  (data) => {
    return !!(
      (data.Subjective && data.Subjective.trim()) ||
      (data.Objective && data.Objective.trim()) ||
      (data.Assessment && data.Assessment.trim()) ||
      (data.Plan && data.Plan.trim())
    );
  },
  {
    message: 'At least one of Subjective, Objective, Assessment, or Plan must be non-empty',
    path: ['Subjective'],
  }
);

// ─── Treatment Plan ────────────────────────────────────────────────────────
export const createTreatmentPlanSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  ClientName: z.string().optional(),
  ClientNumber: z.number().int().optional(),
  Provider: z.string().optional(),
  AdmitDate: z.string().optional(),
  PresentingIssues: z.string().optional(),
  PatientHistory: z.string().optional(),
  Medications: z.string().optional(),
  AnyOtherRelevantInformation: z.string().optional(),
  Diagnosis: z.string().optional(),
  TreatmentReceived: z.string().optional(),
  RecommendationForFollowUp: z.string().optional(),
});

// ─── Social History (Enhanced) ─────────────────────────────────────────────
export const createSocialHistorySchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  SmokingStatus: z.string().optional(),
  SmokingPacksPerDay: z.number().optional(),
  SmokingQuitDate: z.string().optional(),
  TobaccoType: z.string().optional(),
  AlcoholUse: z.string().optional(),
  AlcoholUnitsPerWeek: z.number().optional(),
  RecreationalDrugs: z.string().optional(),
  DrugTypes: z.string().optional(),
  ExercisePatterns: z.string().optional(),
  SleepPatterns: z.string().optional(),
  CaffeineUse: z.string().optional(),
  SeatbeltUse: z.string().optional(),
  HazardousActivities: z.string().optional(),
  FamilyHistoryMother: z.string().optional(),
  FamilyHistoryFather: z.string().optional(),
  FamilyHistorySiblings: z.string().optional(),
  FamilyHistoryOffspring: z.string().optional(),
  Notes: z.string().optional(),
});

// ─── Problem List ──────────────────────────────────────────────────────────
export const createProblemSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  ICD10Code: z.string().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, 'Invalid ICD-10 code').optional(),
  Description: z.string().min(1),
  Subtype: z.string().optional(),
  BegDate: z.string().optional(),
  EndDate: z.string().optional(),
  Severity: z.enum(['mild', 'moderate', 'severe']).default('moderate'),
  Comments: z.string().optional(),
  Status: z.enum(['active', 'inactive', 'resolved', 'deleted']).default('active'),
});

export const updateProblemSchema = createProblemSchema.partial().omit({ PatientId: true });

// ─── Family History ────────────────────────────────────────────────────────
export const createFamilyHistorySchema = z.object({
  PatientId: z.number().int().positive(),
  ICD10Code: z.string().optional(),
  ICD10Description: z.string().optional(),
  Relationship: z.string().optional(),
  Note: z.string().optional(),
});

// ─── Social History (Basic) ───────────────────────────────────────────────
export const createBasicSocialHistorySchema = z.object({
  PatientId: z.number().int().positive(),
  SmokingHistory: z.string().optional(),
  AlcoholHistory: z.string().optional(),
  DrugHistory: z.string().optional(),
  Occupation: z.string().optional(),
  FamilySupport: z.string().optional(),
  Note: z.string().optional(),
});

// ─── Surgical History ──────────────────────────────────────────────────────
export const createSurgicalHistorySchema = z.object({
  PatientId: z.number().int().positive(),
  ICD10Code: z.string().optional(),
  ICD10Description: z.string().optional(),
  SurgeryType: z.string().optional(),
  Note: z.string().optional(),
  SurgeryDate: z.string().optional(),
});

// ─── Diagnosis ─────────────────────────────────────────────────────────────
export const createDiagnosisSchema = z.object({
  PatientId: z.number().int().positive(),
  PatientVisitId: z.number().int().positive().optional(),
  ICD10ID: z.number().int().positive().optional(),
  ICD10Code: z.string().regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, 'Invalid ICD-10 code (e.g. J06, A09.0)').optional(),
  ICD10Description: z.string().optional(),
  icd11_code: z.string().regex(icd11Pattern, 'Invalid ICD-11 code (e.g. BA00, CA40.Z)').optional(),
  icd11_title: z.string().optional(),
  DiagnosisType: z.enum(['primary', 'secondary', 'admitting', 'discharge']).default('primary'),
  Notes: z.string().optional(),
}).refine(data => !!(data.ICD10Description || data.icd11_title), {
  message: 'Either ICD-10 or ICD-11 diagnosis must be provided',
  path: ['icd11_title'],
});

// ─── Diet ──────────────────────────────────────────────────────────────────
export const createDietSchema = z.object({
  PatientId: z.number().int().positive(),
  PatientVisitId: z.number().int().positive().optional(),
  DietTypeId: z.number().int().optional(),
  DietTypeName: z.string().optional(),
  DietName: z.string().optional(),
  Quantity: z.number().optional(),
  Unit: z.string().optional(),
  FeedingTime: z.string().optional(),
  Remarks: z.string().optional(),
});

export const updateDietSchema = createDietSchema.partial().omit({ PatientId: true });

// ─── Glucose ───────────────────────────────────────────────────────────────
export const createGlucoseSchema = z.object({
  PatientId: z.number().int().positive(),
  PatientVisitId: z.number().int().positive().optional(),
  SugarValue: z.number().positive(),
  Unit: z.string().default('mg/dL'),
  BSLType: z.enum(['Random', 'Fasting', 'PP']).optional(),
  MeasurementTime: z.string().optional(),
  Remarks: z.string().optional(),
});

export const updateGlucoseSchema = createGlucoseSchema.partial().omit({ PatientId: true });

// ─── SOAP Note Templates ──────────────────────────────────────────────────
export const soapTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(200),
  name_bn: z.string().max(200).optional().nullable(),
  chief_complaint: z.string().min(1, 'Chief complaint is required').max(500),
  subjective: z.string().max(5000).optional().nullable(),
  objective: z.string().max(5000).optional().nullable(),
  assessment: z.string().max(5000).optional().nullable(),
  plan: z.string().max(5000).optional().nullable(),
  specialty: z.string().max(100).optional().nullable(),
  is_global: z.number().int().min(0).max(1).optional().default(0),
});

export const updateSoapTemplateSchema = soapTemplateSchema.partial();

// ─── Scoring Helpers ────────────────────────────────────────────────────────

export function scorePHQ9(data: z.infer<typeof createPHQ9Schema>) {
  const total =
    data.InterestScore + data.HopelessScore + data.SleepScore +
    data.FatigueScore + data.AppetiteScore + data.FailureScore +
    data.FocusScore + data.PsychomotorScore + data.SuicideScore;

  let severity: string;
  if (total <= 4) severity = 'Minimal';
  else if (total <= 9) severity = 'Mild';
  else if (total <= 14) severity = 'Moderate';
  else if (total <= 19) severity = 'Moderately Severe';
  else severity = 'Severe';

  const isFlagged = data.SuicideScore > 0 ? 1 : 0;

  return { total, severity, isFlagged };
}

export function scoreGAD7(data: z.infer<typeof createGAD7Schema>) {
  const total =
    data.NervousScore + data.ControlWorryScore + data.WorryScore +
    data.RelaxScore + data.RestlessScore + data.IrritableScore +
    data.FearScore;

  let severity: string;
  if (total <= 4) severity = 'Minimal';
  else if (total <= 9) severity = 'Mild';
  else if (total <= 14) severity = 'Moderate';
  else severity = 'Severe';

  const isFlagged = total >= 10 ? 1 : 0;

  return { total, severity, isFlagged };
}

// ─── SDOH (Social Determinants of Health) ─────────────────────────────────
const intDefault0 = z.number().int().default(0);

export const createSDOHSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),

  // Demographics
  Education: z.string().optional(),
  Disability: z.string().optional(),
  Housing: z.string().optional(),
  HousingOtherInput: z.string().optional(),

  // Work
  WorkTemporary: intDefault0,
  WorkSeasonal: intDefault0,
  WorkLooking: intDefault0,
  WorkRetired: intDefault0,
  WorkDisabled: intDefault0,
  WorkHours: z.number().optional(),

  // Household
  HHSize: z.number().optional(),
  HHIncome: z.number().optional(),

  // Caregiving
  CareUnder5: intDefault0,
  CareOver65: intDefault0,
  CareChronicallyIll: intDefault0,
  CareDisabled: intDefault0,
  CareOther: intDefault0,
  CareOtherInput: z.string().optional(),

  // Debt
  DebtMedical: intDefault0,
  DebtCreditCard: intDefault0,
  DebtStudentLoan: intDefault0,
  DebtMortgage: intDefault0,
  DebtRent: intDefault0,
  DebtUtilities: intDefault0,
  DebtOther: intDefault0,
  DebtOtherInput: z.string().optional(),

  // Money struggles
  MoneyFood: intDefault0,
  MoneyHousing: intDefault0,
  MoneyUtilities: intDefault0,
  MoneyClothing: intDefault0,
  MoneyChildcare: intDefault0,
  MoneyMedical: intDefault0,
  MoneyOther: intDefault0,
  MoneyOtherInput: z.string().optional(),

  // Transport barriers
  TransportMedical: intDefault0,
  TransportWork: intDefault0,
  TransportSchool: intDefault0,
  TransportFood: intDefault0,
  TransportOther: intDefault0,
  TransportOtherInput: z.string().optional(),

  // Medical barriers
  MedicalNoInsurance: intDefault0,
  MedicalCostMedication: intDefault0,
  MedicalCostVisit: intDefault0,
  MedicalNoProvider: intDefault0,
  MedicalLanguageBarrier: intDefault0,
  MedicalOther: intDefault0,
  MedicalOtherInput: z.string().optional(),

  // Contextual
  Dentist: z.string().optional(),
  DentistOtherInput: z.string().optional(),
  Social: z.string().optional(),
  Stress: z.string().optional(),
  Safety: z.string().optional(),
  PartnerSafety: z.string().optional(),
  Female: z.string().optional(),
  Addiction: z.string().optional(),
  ArmedServices: z.string().optional(),
  Refugee: z.string().optional(),

  // Stress events
  StressDeath: intDefault0,
  StressDivorce: intDefault0,
  StressJobLoss: intDefault0,
  StressMoving: intDefault0,
  StressIllness: intDefault0,
  StressViolence: intDefault0,
  StressDisaster: intDefault0,
  StressOther: intDefault0,
  StressOtherInput: z.string().optional(),

  // Extra: Discrimination
  DiscrimRace: intDefault0,
  DiscrimGender: intDefault0,
  DiscrimSexuality: intDefault0,
  DiscrimReligion: intDefault0,
  DiscrimAge: intDefault0,
  DiscrimDisability: intDefault0,
  DiscrimOther: intDefault0,
  DiscrimOtherInput: z.string().optional(),

  // Extra: Displacement
  DisplaceWork: intDefault0,
  DisplaceHome: intDefault0,
  DisplaceSchool: intDefault0,
  DisplaceOther: intDefault0,
  DisplaceOtherInput: z.string().optional(),

  // Extra: Contact
  Contact: z.string().optional(),
  ContactOtherInput: z.string().optional(),
});

// ─── SDOH Scoring ─────────────────────────────────────────────────────────
export function computeSdohScore(data: z.infer<typeof createSDOHSchema>) {
  let score = 0;

  // Housing insecurity: +5
  const stableHousing = ['', 'own', 'rent_stable'];
  if (data.Housing && !stableHousing.includes(data.Housing)) {
    score += 5;
  }

  // Work issues: +3 per active flag
  const workFlags = [
    data.WorkTemporary, data.WorkSeasonal, data.WorkLooking,
    data.WorkRetired, data.WorkDisabled,
  ];
  for (const f of workFlags) { if (f) score += 3; }

  // Debt: +2 per active flag
  const debtFlags = [
    data.DebtMedical, data.DebtCreditCard, data.DebtStudentLoan,
    data.DebtMortgage, data.DebtRent, data.DebtUtilities, data.DebtOther,
  ];
  for (const f of debtFlags) { if (f) score += 2; }

  // Money struggles: +2 per flag
  const moneyFlags = [
    data.MoneyFood, data.MoneyHousing, data.MoneyUtilities,
    data.MoneyClothing, data.MoneyChildcare, data.MoneyMedical,
    data.MoneyOther,
  ];
  for (const f of moneyFlags) { if (f) score += 2; }

  // Transport barriers: +3 per flag
  const transportFlags = [
    data.TransportMedical, data.TransportWork, data.TransportSchool,
    data.TransportFood, data.TransportOther,
  ];
  for (const f of transportFlags) { if (f) score += 3; }

  // Medical barriers: +3 per flag
  const medicalFlags = [
    data.MedicalNoInsurance, data.MedicalCostMedication,
    data.MedicalCostVisit, data.MedicalNoProvider,
    data.MedicalLanguageBarrier, data.MedicalOther,
  ];
  for (const f of medicalFlags) { if (f) score += 3; }

  // Stress events: +2 per flag
  const stressFlags = [
    data.StressDeath, data.StressDivorce, data.StressJobLoss,
    data.StressMoving, data.StressIllness, data.StressViolence,
    data.StressDisaster, data.StressOther,
  ];
  for (const f of stressFlags) { if (f) score += 2; }

  // Safety concerns: +5
  const unsafeValues = ['yes', 'unsafe'];
  if (data.Safety && unsafeValues.includes(data.Safety)) score += 5;
  if (data.PartnerSafety && unsafeValues.includes(data.PartnerSafety)) score += 5;

  // Discrimination: +1 per flag
  const discrimFlags = [
    data.DiscrimRace, data.DiscrimGender, data.DiscrimSexuality,
    data.DiscrimReligion, data.DiscrimAge, data.DiscrimDisability,
    data.DiscrimOther,
  ];
  for (const f of discrimFlags) { if (f) score += 1; }

  // Displacement: +1 per flag
  const displaceFlags = [
    data.DisplaceWork, data.DisplaceHome, data.DisplaceSchool,
    data.DisplaceOther,
  ];
  for (const f of displaceFlags) { if (f) score += 1; }

  let riskLevel: string;
  if (score <= 5) riskLevel = 'Low';
  else if (score <= 15) riskLevel = 'Moderate';
  else if (score <= 30) riskLevel = 'High';
  else riskLevel = 'Critical';

  return { score, riskLevel };
}

// ─── ROS (Review of Systems) ──────────────────────────────────────────────
const rosField = z.string().default('N/A').optional();

export const createROSSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  Activity: z.number().int().default(1),

  // Constitutional
  WeightChange: rosField,
  Weakness: rosField,
  Fatigue: rosField,
  Anorexia: rosField,
  Fever: rosField,
  Chills: rosField,
  NightSweats: rosField,
  Insomnia: rosField,
  Irritability: rosField,

  // Eyes
  EyePain: rosField,
  Blindness: rosField,
  Blurring: rosField,
  Tearing: rosField,
  EyeInfection: rosField,
  DoubleVision: rosField,
  EyeCataracts: rosField,
  EyeGlaucoma: rosField,
  EyeExtraOcularMovements: rosField,

  // ENT (Ears/Nose/Throat)
  EarDeafness: rosField,
  EarDischarge: rosField,
  EarPain: rosField,
  EarRinging: rosField,
  NoseBleedingNose: rosField,
  NoseFrequentColds: rosField,
  NoseStuffyNose: rosField,
  NoseSinusTrouble: rosField,
  ThroatSoreThroat: rosField,
  ThroatHoarseness: rosField,
  ThroatThirst: rosField,
  ThroatDifficultySwallowing: rosField,

  // Cardiovascular
  ChestPain: rosField,
  Palpitations: rosField,
  ShortOfBreath: rosField,
  Edema: rosField,
  Orthopnea: rosField,
  PND: rosField,
  Claudication: rosField,
  LegCramps: rosField,
  Varicosities: rosField,

  // Respiratory
  Cough: rosField,
  Sputum: rosField,
  Hemoptysis: rosField,
  Wheezing: rosField,
  Asthma: rosField,
  Dyspnea: rosField,
  Pneumonia: rosField,
  Pleurisy: rosField,
  TB: rosField,

  // GI (Gastrointestinal)
  NauseaVomiting: rosField,
  Diarrhea: rosField,
  Constipation: rosField,
  Heartburn: rosField,
  BelchingBloating: rosField,
  AbdominalPain: rosField,
  Hematemesis: rosField,
  ChangeBowelHabits: rosField,
  Melena: rosField,
  Rectal: rosField,
  Jaundice: rosField,
  Hepatitis: rosField,

  // GU (Genitourinary)
  Frequency: rosField,
  Urgency: rosField,
  Hesitancy: rosField,
  Dysuria: rosField,
  Hematuria: rosField,
  Polyuria: rosField,
  Nocturia: rosField,
  Incontinence: rosField,
  STD: rosField,

  // Musculoskeletal
  JointPain: rosField,
  Swelling: rosField,
  Stiffness: rosField,
  MusclePain: rosField,
  BackPain: rosField,
  LimitedRangeOfMotion: rosField,
  Fractures: rosField,

  // Skin / Integumentary
  Rash: rosField,
  Itching: rosField,
  SkinDryness: rosField,
  SkinColorChange: rosField,
  HairChange: rosField,
  NailChange: rosField,
  Lumps: rosField,
  Sores: rosField,
  Bruising: rosField,

  // Neurological
  Headache: rosField,
  Seizures: rosField,
  Dizziness: rosField,
  Syncope: rosField,
  Numbness: rosField,
  Tingling: rosField,
  Tremors: rosField,
  Paralysis: rosField,
  MemoryLoss: rosField,
  MentalDisturbance: rosField,
  Depression: rosField,

  // Psychiatric
  PsychSleep: rosField,
  PsychAnxiety: rosField,
  PsychDepression: rosField,
  PsychMemory: rosField,
  PsychSubstanceAbuse: rosField,
  PsychSuicidalIdeation: rosField,

  // Endocrine
  HeatIntolerance: rosField,
  ColdIntolerance: rosField,
  ExcessiveThirst: rosField,
  ExcessiveHunger: rosField,
  ExcessiveSweating: rosField,
  Polyuria2: rosField,

  // Hematologic / Lymphatic
  AbnormalBleeding: rosField,
  EasyBruising: rosField,
  SwollenGlands: rosField,
  BloodTransfusion: rosField,

  // Allergic / Immunologic
  Allergies: rosField,
  HIVExposure: rosField,
  Autoimmune: rosField,

  // Additional notes
  Notes: rosField,
});

// ─── Pain Map ─────────────────────────────────────────────────────────────
export const createPainMapSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  PainData: z.string().min(1, 'Pain data JSON is required'),
});

// ─── Physical Exam ────────────────────────────────────────────────────────
export const createPhysicalExamSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  TemplateId: z.number().int().optional(),
  ExamFindings: z.string().min(1, 'Exam findings JSON is required'),
  AbnormalFindings: z.string().optional(),
  DiagnosisCodes: z.string().optional(),
  GeneralNotes: z.string().optional(),
});

// ─── Aftercare Plan ───────────────────────────────────────────────────────
export const createAftercarePlanSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  ClientName: z.string().optional(),
  Provider: z.string().optional(),
  AdmitDate: z.string().optional(),
  DischargedDate: z.string().optional(),
  GoalAAcuteIntoxication: z.string().optional(),
  GoalAAcuteIntoxicationI: z.string().optional(),
  GoalAAcuteIntoxicationII: z.string().optional(),
  GoalBEmotionalBehavioralConditions: z.string().optional(),
  GoalBEmotionalBehavioralConditionsI: z.string().optional(),
  GoalCRelapsePotential: z.string().optional(),
  GoalCRelapsePotentialI: z.string().optional(),
});

// ─── Transfer Summary ─────────────────────────────────────────────────────
export const createTransferSummarySchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  ClientName: z.string().optional(),
  Provider: z.string().optional(),
  TransferTo: z.string().optional(),
  TransferDate: z.string().optional(),
  StatusOfAdmission: z.string().optional(),
  Diagnosis: z.string().optional(),
  InterventionProvided: z.string().optional(),
  OverallStatusOfDischarge: z.string().optional(),
});

// ─── Clinical Instructions ────────────────────────────────────────────────
export const createClinicalInstructionsSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  Instruction: z.string().min(1, 'Instruction is required'),
  Activity: z.number().int().default(1),
});

// ─── Observation ──────────────────────────────────────────────────────────
export const createObservationSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  ObservationDate: z.string().optional(),
  Code: z.string().optional(),
  Observation: z.string().optional(),
  ObValue: z.string().optional(),
  ObUnit: z.string().optional(),
  Description: z.string().optional(),
  CodeType: z.string().optional(),
  TableCode: z.string().optional(),
  ObCode: z.string().optional(),
  ObType: z.string().optional(),
  ObStatus: z.string().optional(),
  ResultStatus: z.string().optional(),
  ObReasonStatus: z.string().optional(),
  ObReasonCode: z.string().optional(),
  ObReasonText: z.string().optional(),
  ObDocumentationOfTable: z.string().optional(),
  ObDocumentationOfTableId: z.number().int().optional(),
  ParentObservationId: z.number().int().optional(),
  QuestionnaireResponseId: z.number().int().optional(),
  Category: z.string().optional(),
  DateEnd: z.string().optional(),
  Activity: z.number().int().default(1),
});

// ─── Dictation ────────────────────────────────────────────────────────────
export const createDictationSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  Dictation: z.string().optional(),
  AdditionalNotes: z.string().optional(),
});

export const updateDictationSchema = createDictationSchema.partial().omit({ PatientId: true });

// ─── Clinic Note ──────────────────────────────────────────────────────────
export const createClinicNoteSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  History: z.string().optional(),
  Examination: z.string().optional(),
  Plan: z.string().optional(),
  FollowupRequired: z.number().int().default(0),
  FollowupTiming: z.string().optional(),
});

export const updateClinicNoteSchema = createClinicNoteSchema.partial().omit({ PatientId: true });

// ─── Functional / Cognitive Status ────────────────────────────────────────
export const createFunctionalCognitiveSchema = z.object({
  PatientId: z.number().int().positive(),
  EncounterId: z.number().int().positive().optional(),
  Code: z.string().optional(),
  CodeText: z.string().optional(),
  StatusDate: z.string().optional(),
  IsCognitive: z.number().int().default(0),
  Description: z.string().optional(),
});

export const updateFunctionalCognitiveSchema = createFunctionalCognitiveSchema.partial().omit({ PatientId: true });
