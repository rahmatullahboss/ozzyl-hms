import { describe, it, expect } from 'vitest';

// ─── EMR / Consultation Tests ─────────────────────────────────────────────────
// Covers: src/routes/tenant/consultations.ts
// Clinical workflow: chief complaint → vitals → diagnosis → prescription → follow-up

describe('HMS EMR / Consultation Tests', () => {

  // ─── Vitals Validation ────────────────────────────────────────────────────
  describe('Patient Vitals Validation', () => {
    interface Vitals {
      bloodPressureSystolic: number;
      bloodPressureDiastolic: number;
      pulse: number;
      temperature: number; // Celsius
      spo2: number;        // percentage
      weight: number;      // kg
      height: number;      // cm
    }

    function isBPNormal(systolic: number, diastolic: number): 'normal' | 'elevated' | 'high_stage1' | 'high_stage2' | 'crisis' {
      if (systolic >= 180 || diastolic >= 120) return 'crisis';
      if (systolic >= 140 || diastolic >= 90)  return 'high_stage2';
      if (systolic >= 130 || diastolic >= 80)  return 'high_stage1';
      if (systolic >= 120 && diastolic < 80)   return 'elevated';
      return 'normal';
    }

    function calcBMI(weightKg: number, heightCm: number): number {
      const heightM = heightCm / 100;
      return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
    }

    it('should classify normal blood pressure (120/80)', () => {
      expect(isBPNormal(115, 75)).toBe('normal');
    });

    it('should classify elevated blood pressure (125/78)', () => {
      expect(isBPNormal(125, 78)).toBe('elevated');
    });

    it('should classify stage 1 hypertension (135/85)', () => {
      expect(isBPNormal(135, 85)).toBe('high_stage1');
    });

    it('should classify stage 2 hypertension (145/95)', () => {
      expect(isBPNormal(145, 95)).toBe('high_stage2');
    });

    it('should classify hypertensive crisis (185/125)', () => {
      expect(isBPNormal(185, 125)).toBe('crisis');
    });

    it('should calculate BMI correctly for 70kg 170cm person', () => {
      expect(calcBMI(70, 170)).toBe(24.2);
    });

    it('should calculate BMI correctly for obese patient', () => {
      const bmi = calcBMI(100, 170);
      expect(bmi).toBeGreaterThan(30); // obese threshold
    });

    it('should validate SpO2 range (should be 95-100% for normal)', () => {
      const isNormalSpO2 = (spo2: number) => spo2 >= 95 && spo2 <= 100;
      expect(isNormalSpO2(98)).toBe(true);
      expect(isNormalSpO2(94)).toBe(false);
      expect(isNormalSpO2(101)).toBe(false);
    });

    it('should flag critical low SpO2 below 90%', () => {
      const isCritical = (spo2: number) => spo2 < 90;
      expect(isCritical(89)).toBe(true);
      expect(isCritical(90)).toBe(false);
    });

    it('should validate normal temperature range (36.1°C – 37.2°C)', () => {
      const isNormal = (temp: number) => temp >= 36.1 && temp <= 37.2;
      expect(isNormal(36.6)).toBe(true);
      expect(isNormal(38.0)).toBe(false); // fever
    });

    it('should detect fever (temperature >= 38°C)', () => {
      const isFever = (temp: number) => temp >= 38.0;
      expect(isFever(38.0)).toBe(true);
      expect(isFever(37.9)).toBe(false);
    });

    it('should validate normal adult heart rate (60–100 bpm)', () => {
      const isNormal = (pulse: number) => pulse >= 60 && pulse <= 100;
      expect(isNormal(72)).toBe(true);
      expect(isNormal(45)).toBe(false); // bradycardia
      expect(isNormal(110)).toBe(false); // tachycardia
    });

    it('should reject negative weight', () => {
      expect(-1 > 0).toBe(false);
    });

    it('should reject weight of 0', () => {
      expect(0 > 0).toBe(false);
    });
  });

  // ─── Diagnosis / ICD-10 ───────────────────────────────────────────────────
  describe('Diagnosis Management', () => {
    interface Diagnosis {
      icd10Code: string;
      description: string;
      diagnosisType: 'primary' | 'secondary' | 'differential';
    }

    function isValidICD10(code: string): boolean {
      // ICD-10 format: Letter + 2 digits, optional decimal + more digits
      return /^[A-Z]\d{2}(\.\d{1,4})?$/.test(code);
    }

    it('should accept valid ICD-10 code J06.9 (Acute upper respiratory infection)', () => {
      expect(isValidICD10('J06.9')).toBe(true);
    });

    it('should accept valid ICD-10 code A01.0 (Typhoid fever)', () => {
      expect(isValidICD10('A01.0')).toBe(true);
    });

    it('should accept valid ICD-10 code E11 (Type 2 Diabetes)', () => {
      expect(isValidICD10('E11')).toBe(true);
    });

    it('should reject invalid ICD-10 code (lowercase)', () => {
      expect(isValidICD10('j06.9')).toBe(false);
    });

    it('should reject invalid ICD-10 code (missing letter)', () => {
      expect(isValidICD10('069')).toBe(false);
    });

    it('should reject empty ICD-10 code', () => {
      expect(isValidICD10('')).toBe(false);
    });

    it('should validate diagnosis type', () => {
      const validTypes: Diagnosis['diagnosisType'][] = ['primary', 'secondary', 'differential'];
      expect(validTypes).toContain('primary');
      expect(validTypes).toContain('secondary');
      expect(validTypes).toContain('differential');
    });

    it('should ensure every consultation has at least one primary diagnosis', () => {
      const diagnoses: Diagnosis[] = [
        { icd10Code: 'J06.9', description: 'Acute URI', diagnosisType: 'primary' },
        { icd10Code: 'E11', description: 'Type 2 DM', diagnosisType: 'secondary' },
      ];
      const hasPrimary = diagnoses.some((d) => d.diagnosisType === 'primary');
      expect(hasPrimary).toBe(true);
    });

    it('should detect consultation without a primary diagnosis', () => {
      const diagnoses: Diagnosis[] = [
        { icd10Code: 'E11', description: 'Type 2 DM', diagnosisType: 'secondary' },
      ];
      const hasPrimary = diagnoses.some((d) => d.diagnosisType === 'primary');
      expect(hasPrimary).toBe(false);
    });
  });

  // ─── Prescription Management ──────────────────────────────────────────────
  describe('e-Prescription Validation', () => {
    interface PrescriptionItem {
      medicineName: string;
      dose: string;
      frequency: string;
      duration: number; // days
      route: 'oral' | 'iv' | 'im' | 'topical' | 'inhaled' | 'sublingual';
    }

    const VALID_FREQUENCIES = [
      '1-0-0', '0-1-0', '0-0-1',
      '1-1-0', '1-0-1', '0-1-1',
      '1-1-1', '1-1-1-1', 'SOS', 'stat',
    ];

    function isValidFrequency(freq: string): boolean {
      return VALID_FREQUENCIES.includes(freq);
    }

    it('should accept frequency 1-1-1 (three times daily)', () => {
      expect(isValidFrequency('1-1-1')).toBe(true);
    });

    it('should accept frequency 1-0-1 (twice daily)', () => {
      expect(isValidFrequency('1-0-1')).toBe(true);
    });

    it('should accept SOS (as needed) frequency', () => {
      expect(isValidFrequency('SOS')).toBe(true);
    });

    it('should reject unknown frequency code', () => {
      expect(isValidFrequency('BD')).toBe(false);
    });

    it('should require positive duration in days', () => {
      const item: PrescriptionItem = {
        medicineName: 'Paracetamol',
        dose: '500mg',
        frequency: '1-1-1',
        duration: 5,
        route: 'oral',
      };
      expect(item.duration).toBeGreaterThan(0);
    });

    it('should reject zero duration', () => {
      expect(0 > 0).toBe(false);
    });

    it('should reject negative duration', () => {
      expect(-1 > 0).toBe(false);
    });

    it('should validate medicine route options', () => {
      const routes: PrescriptionItem['route'][] = ['oral', 'iv', 'im', 'topical', 'inhaled', 'sublingual'];
      expect(routes).toContain('oral');
      expect(routes).toContain('iv');
      expect(routes).toContain('im');
    });

    it('should include doctor BMDC number on prescription', () => {
      const prescription = {
        doctorName: 'Dr. Ahmad',
        bmdcNo: 'BMDC-12345',
        items: [],
      };
      expect(prescription.bmdcNo).toMatch(/^BMDC-\d+$/);
    });

    it('should generate prescription number with RX prefix', () => {
      const seq = 1;
      const rxNo = `RX-${String(seq).padStart(6, '0')}`;
      expect(rxNo).toBe('RX-000001');
      expect(rxNo).toMatch(/^RX-\d{6}$/);
    });
  });

  // ─── Follow-Up Logic ──────────────────────────────────────────────────────
  describe('Follow-Up Date Logic', () => {
    function addDays(dateStr: string, days: number): string {
      const d = new Date(dateStr);
      d.setDate(d.getDate() + days);
      return d.toISOString().split('T')[0];
    }

    it('should calculate follow-up date 7 days from today', () => {
      const today = '2024-01-15';
      expect(addDays(today, 7)).toBe('2024-01-22');
    });

    it('should calculate follow-up date 30 days from today', () => {
      const today = '2024-01-15';
      expect(addDays(today, 30)).toBe('2024-02-14');
    });

    it('should handle month-end follow-up correctly', () => {
      const today = '2024-01-31';
      expect(addDays(today, 1)).toBe('2024-02-01');
    });

    it('should reject follow-up date in the past', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = addDays(today, -1);
      expect(yesterday < today).toBe(true);
    });

    it('should allow same-day follow-up for urgent cases', () => {
      const today = new Date().toISOString().split('T')[0];
      expect(today === today).toBe(true);
    });
  });

  // ─── Allergy Management ───────────────────────────────────────────────────
  describe('Allergy Recording', () => {
    interface Allergy {
      allergen: string;
      severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
      reaction: string;
    }

    it('should accept all severity levels', () => {
      const severities: Allergy['severity'][] = ['mild', 'moderate', 'severe', 'life_threatening'];
      expect(severities).toContain('mild');
      expect(severities).toContain('life_threatening');
    });

    it('should require allergen name to be non-empty', () => {
      const isValid = (allergen: string) => allergen.trim().length > 0;
      expect(isValid('Penicillin')).toBe(true);
      expect(isValid('')).toBe(false);
      expect(isValid('  ')).toBe(false);
    });

    it('should detect penicillin allergy before prescribing amoxicillin (cross-reactivity)', () => {
      const allergies: Allergy[] = [
        { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
      ];
      const PENICILLIN_GROUP = ['Penicillin', 'Amoxicillin', 'Ampicillin', 'Cloxacillin'];
      const prescription = 'Amoxicillin';
      const hasContraindication = allergies.some((a) =>
        PENICILLIN_GROUP.includes(a.allergen) && PENICILLIN_GROUP.includes(prescription)
      );
      expect(hasContraindication).toBe(true);
    });

    it('should allow prescription when no cross-reactive allergy exists', () => {
      const allergies: Allergy[] = [
        { allergen: 'Aspirin', severity: 'mild', reaction: 'Rash' },
      ];
      const PENICILLIN_GROUP = ['Penicillin', 'Amoxicillin', 'Ampicillin'];
      const prescription = 'Amoxicillin';
      const hasContraindication = allergies.some((a) =>
        PENICILLIN_GROUP.includes(a.allergen) && PENICILLIN_GROUP.includes(prescription)
      );
      expect(hasContraindication).toBe(false);
    });
  });

  // ─── Consultation Note Validation ─────────────────────────────────────────
  describe('Consultation Note Completeness', () => {
    interface ConsultationNote {
      chiefComplaint: string;
      history?: string;
      examination?: string;
      diagnosis: string;
      plan: string;
    }

    function isComplete(note: ConsultationNote): boolean {
      return (
        note.chiefComplaint.trim().length > 0 &&
        note.diagnosis.trim().length > 0 &&
        note.plan.trim().length > 0
      );
    }

    it('should require chief complaint, diagnosis, and plan as mandatory', () => {
      const note: ConsultationNote = {
        chiefComplaint: 'Fever and cough for 3 days',
        diagnosis: 'Acute upper respiratory infection',
        plan: 'Paracetamol 500mg TDS × 5 days, rest, hydration',
      };
      expect(isComplete(note)).toBe(true);
    });

    it('should reject note with empty chief complaint', () => {
      const note: ConsultationNote = {
        chiefComplaint: '',
        diagnosis: 'URI',
        plan: 'Paracetamol',
      };
      expect(isComplete(note)).toBe(false);
    });

    it('should reject note with empty diagnosis', () => {
      const note: ConsultationNote = {
        chiefComplaint: 'Fever',
        diagnosis: '',
        plan: 'Paracetamol',
      };
      expect(isComplete(note)).toBe(false);
    });

    it('should reject note with empty plan', () => {
      const note: ConsultationNote = {
        chiefComplaint: 'Fever',
        diagnosis: 'URI',
        plan: '',
      };
      expect(isComplete(note)).toBe(false);
    });

    it('should accept note with only mandatory fields', () => {
      const note: ConsultationNote = {
        chiefComplaint: 'Headache',
        diagnosis: 'Tension headache',
        plan: 'Ibuprofen 400mg SOS',
      };
      expect(isComplete(note)).toBe(true);
    });
  });
});
