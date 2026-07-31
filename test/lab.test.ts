import { describe, it, expect } from 'vitest';

// ─── Lab Tests ─────────────────────────────────────────────────────────────

describe('HMS Lab Tests', () => {

  // ─── Lab Order Status Transitions ────────────────────────────────────────
  describe('Lab Order Status Transitions', () => {
    const LAB_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
    type LabStatus = typeof LAB_STATUSES[number];

    const VALID_TRANSITIONS: Record<LabStatus, LabStatus[]> = {
      pending:     ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
      completed:   [],
      cancelled:   [],
    };

    function canTransition(from: LabStatus, to: LabStatus): boolean {
      return VALID_TRANSITIONS[from].includes(to);
    }

    it('should allow pending → in_progress', () => {
      expect(canTransition('pending', 'in_progress')).toBe(true);
    });

    it('should allow in_progress → completed', () => {
      expect(canTransition('in_progress', 'completed')).toBe(true);
    });

    it('should block completed → in_progress (no reversal)', () => {
      expect(canTransition('completed', 'in_progress')).toBe(false);
    });

    it('should allow pending → cancelled', () => {
      expect(canTransition('pending', 'cancelled')).toBe(true);
    });

    it('should block cancelled → pending (terminal state)', () => {
      expect(canTransition('cancelled', 'pending')).toBe(false);
    });
  });

  // ─── Lab Result Validation ────────────────────────────────────────────────
  describe('Lab Result Validation', () => {
    interface LabResult {
      value: number;
      normalMin: number;
      normalMax: number;
      unit: string;
    }

    function getResultFlag(result: LabResult): 'normal' | 'low' | 'high' | 'critical' {
      const { value, normalMin, normalMax } = result;
      if (value < normalMin * 0.5) return 'critical';
      if (value > normalMax * 1.5) return 'critical';
      if (value < normalMin) return 'low';
      if (value > normalMax) return 'high';
      return 'normal';
    }

    it('should flag result as normal when within range', () => {
      const r: LabResult = { value: 90, normalMin: 70, normalMax: 110, unit: 'mg/dL' };
      expect(getResultFlag(r)).toBe('normal');
    });

    it('should flag result as high when above normal max', () => {
      const r: LabResult = { value: 140, normalMin: 70, normalMax: 110, unit: 'mg/dL' };
      expect(getResultFlag(r)).toBe('high');
    });

    it('should flag result as low when below normal min', () => {
      const r: LabResult = { value: 50, normalMin: 70, normalMax: 110, unit: 'mg/dL' };
      expect(getResultFlag(r)).toBe('low');
    });

    it('should flag result as critical when dangerously low (< 50% of min)', () => {
      const r: LabResult = { value: 20, normalMin: 70, normalMax: 110, unit: 'mg/dL' };
      expect(getResultFlag(r)).toBe('critical');
    });

    it('should flag result as critical when dangerously high (> 150% of max)', () => {
      const r: LabResult = { value: 400, normalMin: 70, normalMax: 110, unit: 'mg/dL' };
      expect(getResultFlag(r)).toBe('critical');
    });
  });

  // ─── Lab Item Category Validation ────────────────────────────────────────
  describe('Lab Item Category Validation', () => {
    const VALID_CATEGORIES = [
      'hematology', 'biochemistry', 'microbiology', 'serology',
      'urine_analysis', 'stool_analysis', 'hormones', 'tumor_markers',
    ];

    function isValidCategory(category: string): boolean {
      return VALID_CATEGORIES.includes(category);
    }

    it('should accept valid lab category hematology', () => {
      expect(isValidCategory('hematology')).toBe(true);
    });

    it('should accept valid lab category biochemistry', () => {
      expect(isValidCategory('biochemistry')).toBe(true);
    });

    it('should reject unknown lab category', () => {
      expect(isValidCategory('xray_panel')).toBe(false);
    });

    it('should reject empty string category', () => {
      expect(isValidCategory('')).toBe(false);
    });
  });

  // ─── Lab Report Formatting ────────────────────────────────────────────────
  describe('Lab Report Formatting', () => {
    function formatResultDisplay(value: number, unit: string, precision = 2): string {
      return `${value.toFixed(precision)} ${unit}`;
    }

    it('should format glucose result correctly', () => {
      expect(formatResultDisplay(95.5, 'mg/dL')).toBe('95.50 mg/dL');
    });

    it('should format hemoglobin with correct precision', () => {
      expect(formatResultDisplay(13.8, 'g/dL')).toBe('13.80 g/dL');
    });

    it('should handle whole number values', () => {
      expect(formatResultDisplay(4, 'x10^6/μL')).toBe('4.00 x10^6/μL');
    });
  });

  // ─── Turnaround Time ──────────────────────────────────────────────────────
  describe('Turnaround Time (TAT) Calculation', () => {
    function calcTATMinutes(orderedAt: string, completedAt: string): number {
      return (new Date(completedAt).getTime() - new Date(orderedAt).getTime()) / 60000;
    }

    it('should calculate TAT of 30 minutes correctly', () => {
      const ordered = '2024-01-15T09:00:00Z';
      const completed = '2024-01-15T09:30:00Z';
      expect(calcTATMinutes(ordered, completed)).toBe(30);
    });

    it('should calculate TAT spanning midnight', () => {
      const ordered = '2024-01-15T23:30:00Z';
      const completed = '2024-01-16T00:30:00Z';
      expect(calcTATMinutes(ordered, completed)).toBe(60);
    });

    it('should return 0 for same time (instant completion)', () => {
      const t = '2024-01-15T10:00:00Z';
      expect(calcTATMinutes(t, t)).toBe(0);
    });
  });
});
