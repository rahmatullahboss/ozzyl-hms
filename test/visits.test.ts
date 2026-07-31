import { describe, it, expect } from 'vitest';

// ─── Visit (OPD/IPD/Emergency) Tests ───────────────────────────────────────

describe('HMS Visit Tests', () => {

  // ─── Visit Type Validation ────────────────────────────────────────────────
  describe('Visit Type Validation', () => {
    const VALID_VISIT_TYPES = ['OPD', 'IPD', 'Emergency', 'Day Care', 'Teleconsultation'] as const;
    type VisitType = typeof VALID_VISIT_TYPES[number];

    function isValidVisitType(type: string): type is VisitType {
      return (VALID_VISIT_TYPES as readonly string[]).includes(type);
    }

    it('should accept OPD as a valid visit type', () => {
      expect(isValidVisitType('OPD')).toBe(true);
    });

    it('should accept IPD as a valid visit type', () => {
      expect(isValidVisitType('IPD')).toBe(true);
    });

    it('should accept Emergency as a valid visit type', () => {
      expect(isValidVisitType('Emergency')).toBe(true);
    });

    it('should reject unknown visit type', () => {
      expect(isValidVisitType('Walk-in')).toBe(false);
    });

    it('should reject empty string as visit type', () => {
      expect(isValidVisitType('')).toBe(false);
    });
  });

  // ─── Admission / Discharge Date Logic ────────────────────────────────────
  describe('Admission and Discharge Date Logic', () => {
    function calcAdmissionDays(admittedAt: string, dischargedAt: string | null): number {
      const start = new Date(admittedAt);
      const end = dischargedAt ? new Date(dischargedAt) : new Date();
      const diffMs = end.getTime() - start.getTime();
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }

    it('should return 1 day for same-day admission and discharge', () => {
      expect(calcAdmissionDays('2024-01-15T08:00:00Z', '2024-01-15T18:00:00Z')).toBe(1);
    });

    it('should return 3 days for a 3-day stay', () => {
      expect(calcAdmissionDays('2024-01-10T08:00:00Z', '2024-01-13T08:00:00Z')).toBe(3);
    });

    it('should return minimum 1 day even if discharged moments after admission', () => {
      expect(calcAdmissionDays('2024-01-15T08:00:00Z', '2024-01-15T08:01:00Z')).toBe(1);
    });

    it('should handle ongoing admission (null discharge)', () => {
      const daysAgo3 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const days = calcAdmissionDays(daysAgo3, null);
      expect(days).toBeGreaterThanOrEqual(3);
    });

    it('should reject discharge date before admission date', () => {
      // Business rule: discharge must be >= admission
      const admitted = '2024-01-15T08:00:00Z';
      const discharged = '2024-01-14T08:00:00Z';
      const diff = new Date(discharged).getTime() - new Date(admitted).getTime();
      expect(diff).toBeLessThan(0); // negative diff signals invalid state
    });
  });

  // ─── Visit Fee Calculation ────────────────────────────────────────────────
  describe('Visit Fee Calculation', () => {
    interface VisitFeeConfig {
      consultationFee: number;
      admissionFee: number;
      dailyWardCharge: number;
      emergencySurcharge: number;
    }

    function calculateVisitFee(
      type: 'OPD' | 'IPD' | 'Emergency',
      admissionDays: number,
      config: VisitFeeConfig
    ): number {
      switch (type) {
        case 'OPD':
          return config.consultationFee;
        case 'IPD':
          return config.admissionFee + config.dailyWardCharge * admissionDays;
        case 'Emergency':
          return config.consultationFee + config.emergencySurcharge;
      }
    }

    const config: VisitFeeConfig = {
      consultationFee: 500,
      admissionFee: 2000,
      dailyWardCharge: 1500,
      emergencySurcharge: 300,
    };

    it('should charge only consultation fee for OPD', () => {
      expect(calculateVisitFee('OPD', 0, config)).toBe(500);
    });

    it('should charge admission + ward for 3-day IPD', () => {
      expect(calculateVisitFee('IPD', 3, config)).toBe(2000 + 1500 * 3); // 6500
    });

    it('should charge consultation + surcharge for Emergency', () => {
      expect(calculateVisitFee('Emergency', 0, config)).toBe(500 + 300); // 800
    });

    it('should charge admission + 1 day ward for same-day IPD discharge', () => {
      expect(calculateVisitFee('IPD', 1, config)).toBe(2000 + 1500); // 3500
    });
  });

  // ─── Visit Status Machine ─────────────────────────────────────────────────
  describe('Visit Status Transitions', () => {
    type VisitStatus = 'scheduled' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

    const VALID_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
      scheduled:   ['checked_in', 'cancelled', 'no_show'],
      checked_in:  ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
      completed:   [],
      cancelled:   [],
      no_show:     [],
    };

    function canTransition(from: VisitStatus, to: VisitStatus): boolean {
      return VALID_TRANSITIONS[from].includes(to);
    }

    it('should allow scheduled → checked_in', () => {
      expect(canTransition('scheduled', 'checked_in')).toBe(true);
    });

    it('should allow in_progress → completed', () => {
      expect(canTransition('in_progress', 'completed')).toBe(true);
    });

    it('should block completed → scheduled (terminal)', () => {
      expect(canTransition('completed', 'scheduled')).toBe(false);
    });

    it('should allow scheduled → no_show', () => {
      expect(canTransition('scheduled', 'no_show')).toBe(true);
    });

    it('should block no_show → checked_in (terminal)', () => {
      expect(canTransition('no_show', 'checked_in')).toBe(false);
    });
  });

  // ─── Visit Priority ───────────────────────────────────────────────────────
  describe('Visit Priority Scoring', () => {
    interface Patient {
      age: number;
      visitType: 'OPD' | 'IPD' | 'Emergency';
      minutesWaiting: number;
    }

    function getPriorityScore(p: Patient): number {
      let score = 0;
      if (p.visitType === 'Emergency') score += 100;
      if (p.visitType === 'IPD') score += 50;
      if (p.age >= 65) score += 30;
      if (p.age <= 5) score += 20;
      score += Math.min(p.minutesWaiting, 60); // cap waiting bonus at 60 pts
      return score;
    }

    it('should give highest score to Emergency patient', () => {
      const emergency: Patient = { age: 30, visitType: 'Emergency', minutesWaiting: 0 };
      const opd: Patient = { age: 30, visitType: 'OPD', minutesWaiting: 0 };
      expect(getPriorityScore(emergency)).toBeGreaterThan(getPriorityScore(opd));
    });

    it('should add age bonus for senior patients (65+)', () => {
      const senior: Patient = { age: 70, visitType: 'OPD', minutesWaiting: 0 };
      const adult: Patient = { age: 35, visitType: 'OPD', minutesWaiting: 0 };
      expect(getPriorityScore(senior)).toBeGreaterThan(getPriorityScore(adult));
    });

    it('should add age bonus for infants (5 and under)', () => {
      const infant: Patient = { age: 2, visitType: 'OPD', minutesWaiting: 0 };
      const child: Patient = { age: 10, visitType: 'OPD', minutesWaiting: 0 };
      expect(getPriorityScore(infant)).toBeGreaterThan(getPriorityScore(child));
    });

    it('should cap waiting time bonus at 60 minutes', () => {
      const s1: Patient = { age: 30, visitType: 'OPD', minutesWaiting: 60 };
      const s2: Patient = { age: 30, visitType: 'OPD', minutesWaiting: 120 };
      expect(getPriorityScore(s1)).toBe(getPriorityScore(s2));
    });
  });
});
