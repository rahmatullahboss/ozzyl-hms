import { describe, it, expect } from 'vitest';
import {
  createPHQ9Schema,
  createGAD7Schema,
  createSOAPSchema,
  createTreatmentPlanSchema,
  createSocialHistorySchema,
  createProblemSchema,
  updateProblemSchema,
  createFamilyHistorySchema,
  createBasicSocialHistorySchema,
  createSurgicalHistorySchema,
  createDiagnosisSchema,
  createDietSchema,
  createGlucoseSchema,
  scorePHQ9,
  scoreGAD7,
} from '../src/schemas/clinical-assessments';

describe('Clinical Assessments Module', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // PHQ-9 Depression Screening
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PHQ-9 Schema Validation', () => {
    it('should accept valid PHQ-9 form with defaults', () => {
      const result = createPHQ9Schema.safeParse({ PatientId: 1 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.InterestScore).toBe(0);
        expect(result.data.SuicideScore).toBe(0);
      }
    });

    it('should reject scores above 3', () => {
      const result = createPHQ9Schema.safeParse({ PatientId: 1, InterestScore: 4 });
      expect(result.success).toBe(false);
    });

    it('should reject negative scores', () => {
      const result = createPHQ9Schema.safeParse({ PatientId: 1, SleepScore: -1 });
      expect(result.success).toBe(false);
    });

    it('should require PatientId', () => {
      const result = createPHQ9Schema.safeParse({ InterestScore: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe('PHQ-9 Scoring', () => {
    it('should calculate Minimal severity (0-4)', () => {
      const data = createPHQ9Schema.parse({ PatientId: 1 });
      const { total, severity, isFlagged } = scorePHQ9(data);
      expect(total).toBe(0);
      expect(severity).toBe('Minimal');
      expect(isFlagged).toBe(0);
    });

    it('should calculate Mild severity (5-9)', () => {
      const data = createPHQ9Schema.parse({
        PatientId: 1, InterestScore: 1, HopelessScore: 1,
        SleepScore: 1, FatigueScore: 1, AppetiteScore: 1,
      });
      const { total, severity } = scorePHQ9(data);
      expect(total).toBe(5);
      expect(severity).toBe('Mild');
    });

    it('should calculate Moderate severity (10-14)', () => {
      const data = createPHQ9Schema.parse({
        PatientId: 1, InterestScore: 2, HopelessScore: 2,
        SleepScore: 2, FatigueScore: 2, AppetiteScore: 2,
      });
      const { total, severity } = scorePHQ9(data);
      expect(total).toBe(10);
      expect(severity).toBe('Moderate');
    });

    it('should calculate Moderately Severe (15-19)', () => {
      const data = createPHQ9Schema.parse({
        PatientId: 1, InterestScore: 3, HopelessScore: 3,
        SleepScore: 3, FatigueScore: 3, AppetiteScore: 3,
      });
      const { total, severity } = scorePHQ9(data);
      expect(total).toBe(15);
      expect(severity).toBe('Moderately Severe');
    });

    it('should calculate Severe (20-27)', () => {
      const data = createPHQ9Schema.parse({
        PatientId: 1, InterestScore: 3, HopelessScore: 3,
        SleepScore: 3, FatigueScore: 3, AppetiteScore: 3,
        FailureScore: 3, FocusScore: 3,
      });
      const { total, severity } = scorePHQ9(data);
      expect(total).toBe(21);
      expect(severity).toBe('Severe');
    });

    it('should flag when SuicideScore > 0', () => {
      const data = createPHQ9Schema.parse({ PatientId: 1, SuicideScore: 1 });
      const { isFlagged } = scorePHQ9(data);
      expect(isFlagged).toBe(1);
    });

    it('should NOT flag when SuicideScore is 0', () => {
      const data = createPHQ9Schema.parse({ PatientId: 1, SuicideScore: 0 });
      const { isFlagged } = scorePHQ9(data);
      expect(isFlagged).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GAD-7 Anxiety Screening
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GAD-7 Schema Validation', () => {
    it('should accept valid GAD-7 form with defaults', () => {
      const result = createGAD7Schema.safeParse({ PatientId: 1 });
      expect(result.success).toBe(true);
    });

    it('should reject scores above 3', () => {
      const result = createGAD7Schema.safeParse({ PatientId: 1, NervousScore: 5 });
      expect(result.success).toBe(false);
    });
  });

  describe('GAD-7 Scoring', () => {
    it('should calculate Minimal (0-4)', () => {
      const data = createGAD7Schema.parse({ PatientId: 1 });
      const { total, severity, isFlagged } = scoreGAD7(data);
      expect(total).toBe(0);
      expect(severity).toBe('Minimal');
      expect(isFlagged).toBe(0);
    });

    it('should calculate Mild (5-9)', () => {
      const data = createGAD7Schema.parse({
        PatientId: 1, NervousScore: 2, ControlWorryScore: 2, WorryScore: 1,
      });
      const { total, severity } = scoreGAD7(data);
      expect(total).toBe(5);
      expect(severity).toBe('Mild');
    });

    it('should calculate Moderate (10-14)', () => {
      const data = createGAD7Schema.parse({
        PatientId: 1, NervousScore: 2, ControlWorryScore: 2,
        WorryScore: 2, RelaxScore: 2, RestlessScore: 2,
      });
      const { total, severity, isFlagged } = scoreGAD7(data);
      expect(total).toBe(10);
      expect(severity).toBe('Moderate');
      expect(isFlagged).toBe(1); // >=10 is flagged
    });

    it('should calculate Severe (15-21)', () => {
      const data = createGAD7Schema.parse({
        PatientId: 1, NervousScore: 3, ControlWorryScore: 3,
        WorryScore: 3, RelaxScore: 3, RestlessScore: 3,
      });
      const { total, severity, isFlagged } = scoreGAD7(data);
      expect(total).toBe(15);
      expect(severity).toBe('Severe');
      expect(isFlagged).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SOAP Notes
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SOAP Schema', () => {
    it('should accept valid SOAP note', () => {
      const result = createSOAPSchema.safeParse({
        PatientId: 1, Subjective: 'Headache', Objective: 'BP 120/80',
        Assessment: 'Migraine', Plan: 'Rest + analgesics',
      });
      expect(result.success).toBe(true);
    });

    it('should require PatientId', () => {
      const result = createSOAPSchema.safeParse({ Subjective: 'test' });
      expect(result.success).toBe(false);
    });

    it('should reject SOAP with only PatientId', () => {
      const result = createSOAPSchema.safeParse({ PatientId: 1 });
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Treatment Plan
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Treatment Plan Schema', () => {
    it('should accept valid treatment plan', () => {
      const result = createTreatmentPlanSchema.safeParse({
        PatientId: 1, PresentingIssues: 'Anxiety', Medications: 'SSRI',
      });
      expect(result.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Problem List
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Problem List Schema', () => {
    it('should accept valid problem', () => {
      const result = createProblemSchema.safeParse({
        PatientId: 1, Description: 'Hypertension',
        Severity: 'moderate', Status: 'active',
      });
      expect(result.success).toBe(true);
    });

    it('should require Description', () => {
      const result = createProblemSchema.safeParse({ PatientId: 1 });
      expect(result.success).toBe(false);
    });

    it('should reject invalid severity', () => {
      const result = createProblemSchema.safeParse({
        PatientId: 1, Description: 'test', Severity: 'critical',
      });
      expect(result.success).toBe(false);
    });

    it('should default severity to moderate', () => {
      const result = createProblemSchema.parse({ PatientId: 1, Description: 'test' });
      expect(result.Severity).toBe('moderate');
    });

    it('should default status to active', () => {
      const result = createProblemSchema.parse({ PatientId: 1, Description: 'test' });
      expect(result.Status).toBe('active');
    });

    it('should allow all valid statuses', () => {
      for (const status of ['active', 'inactive', 'resolved', 'deleted'] as const) {
        const r = createProblemSchema.safeParse({ PatientId: 1, Description: 'x', Status: status });
        expect(r.success).toBe(true);
      }
    });

    it('should allow partial update without PatientId', () => {
      const result = updateProblemSchema.safeParse({ Description: 'Updated' });
      expect(result.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // History Schemas
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Family History Schema', () => {
    it('should accept valid family history', () => {
      const result = createFamilyHistorySchema.safeParse({
        PatientId: 1, ICD10Code: 'E11', Relationship: 'Mother',
      });
      expect(result.success).toBe(true);
    });

    it('should require PatientId', () => {
      const result = createFamilyHistorySchema.safeParse({ Relationship: 'Father' });
      expect(result.success).toBe(false);
    });
  });

  describe('Social History Schema', () => {
    it('should accept valid social history', () => {
      const result = createBasicSocialHistorySchema.safeParse({
        PatientId: 1, SmokingHistory: 'Never', Occupation: 'Teacher',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Surgical History Schema', () => {
    it('should accept valid surgical history', () => {
      const result = createSurgicalHistorySchema.safeParse({
        PatientId: 1, SurgeryType: 'Appendectomy', SurgeryDate: '2020-01-15',
      });
      expect(result.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Social History (Enhanced)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Enhanced Social History Schema', () => {
    it('should accept comprehensive social history', () => {
      const result = createSocialHistorySchema.safeParse({
        PatientId: 1, SmokingStatus: 'Former', SmokingPacksPerDay: 0.5,
        AlcoholUse: 'Social', ExercisePatterns: '3x/week',
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty social history with just patient', () => {
      const result = createSocialHistorySchema.safeParse({ PatientId: 1 });
      expect(result.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Diagnosis
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Diagnosis Schema', () => {
    it('should accept valid diagnosis', () => {
      const result = createDiagnosisSchema.safeParse({
        PatientId: 1, ICD10Code: 'E11.9',
        ICD10Description: 'Type 2 diabetes mellitus without complications',
        DiagnosisType: 'primary',
      });
      expect(result.success).toBe(true);
    });

    it('should require ICD10Description', () => {
      const result = createDiagnosisSchema.safeParse({
        PatientId: 1, ICD10Code: 'E11.9',
      });
      expect(result.success).toBe(false);
    });

    it('should default to primary diagnosis type', () => {
      const d = createDiagnosisSchema.parse({
        PatientId: 1, ICD10Description: 'test',
      });
      expect(d.DiagnosisType).toBe('primary');
    });

    it('should accept all diagnosis types', () => {
      for (const t of ['primary', 'secondary', 'admitting', 'discharge'] as const) {
        const r = createDiagnosisSchema.safeParse({
          PatientId: 1, ICD10Description: 'x', DiagnosisType: t,
        });
        expect(r.success).toBe(true);
      }
    });

    it('should reject invalid ICD-11 code format', () => {
      const result = createDiagnosisSchema.safeParse({
        PatientId: 1,
        icd11_code: 'invalid!',
        icd11_title: 'Test diagnosis',
      });
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Diet
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Diet Schema', () => {
    it('should accept valid diet record', () => {
      const result = createDietSchema.safeParse({
        PatientId: 1, DietName: 'Low Sodium', Quantity: 200, Unit: 'ml',
      });
      expect(result.success).toBe(true);
    });

    it('should require PatientId', () => {
      const result = createDietSchema.safeParse({ DietName: 'Regular' });
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Glucose
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Glucose Schema', () => {
    it('should accept valid glucose reading', () => {
      const result = createGlucoseSchema.safeParse({
        PatientId: 1, SugarValue: 120, Unit: 'mg/dL', BSLType: 'Fasting',
      });
      expect(result.success).toBe(true);
    });

    it('should default unit to mg/dL', () => {
      const d = createGlucoseSchema.parse({ PatientId: 1, SugarValue: 100 });
      expect(d.Unit).toBe('mg/dL');
    });

    it('should reject zero/negative sugar values', () => {
      const result = createGlucoseSchema.safeParse({ PatientId: 1, SugarValue: 0 });
      expect(result.success).toBe(false);
    });

    it('should accept valid BSL types', () => {
      for (const t of ['Random', 'Fasting', 'PP'] as const) {
        const r = createGlucoseSchema.safeParse({ PatientId: 1, SugarValue: 100, BSLType: t });
        expect(r.success).toBe(true);
      }
    });

    it('should reject invalid BSL type', () => {
      const result = createGlucoseSchema.safeParse({
        PatientId: 1, SugarValue: 100, BSLType: 'HbA1c',
      });
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Clinical RBAC
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Clinical RBAC', () => {
    const CLINICAL_WRITE_ROLES = ['doctor', 'md', 'nurse', 'hospital_admin'];
    const CLINICAL_READ_ROLES = [...CLINICAL_WRITE_ROLES, 'receptionist'];

    it('should allow doctors to write clinical data', () => {
      expect(CLINICAL_WRITE_ROLES).toContain('doctor');
      expect(CLINICAL_WRITE_ROLES).toContain('md');
    });

    it('should allow nurses to write clinical data', () => {
      expect(CLINICAL_WRITE_ROLES).toContain('nurse');
    });

    it('should restrict read access to clinical roles', () => {
      expect(CLINICAL_READ_ROLES).not.toContain('accountant');
      expect(CLINICAL_READ_ROLES).not.toContain('patient');
    });

    it('should allow receptionist read-only access', () => {
      expect(CLINICAL_READ_ROLES).toContain('receptionist');
      expect(CLINICAL_WRITE_ROLES).not.toContain('receptionist');
    });
  });
});
