import { describe, expect, it } from 'vitest';
import {
  buildLabSampleBarcode,
  calculateLabTatMinutes,
  isLabDelayed,
  isLabStatusTransitionAllowed,
  resolveLabScanCode,
} from '../src/lib/lab-workflow';

describe('Lab MVP Workflow', () => {
  describe('Status Transitions - Full Workflow', () => {
    it('should follow order → collect → process → result → report workflow', () => {
      // Order created → item is 'pending'
      expect(isLabStatusTransitionAllowed('pending', 'collected')).toBe(true);

      // Sample collected → 'collected'
      expect(isLabStatusTransitionAllowed('collected', 'received')).toBe(true);

      // Sample received in lab → 'received'
      expect(isLabStatusTransitionAllowed('received', 'processing')).toBe(true);

      // Processing started → 'processing'
      expect(isLabStatusTransitionAllowed('processing', 'completed')).toBe(true);

      // Result entered → 'completed'
      expect(isLabStatusTransitionAllowed('completed', 'verified')).toBe(true);
    });

    it('should block backward transitions', () => {
      expect(isLabStatusTransitionAllowed('completed', 'processing')).toBe(false);
      expect(isLabStatusTransitionAllowed('verified', 'completed')).toBe(false);
      expect(isLabStatusTransitionAllowed('collected', 'pending')).toBe(false);
    });

    it('should allow rejection from any non-terminal state', () => {
      expect(isLabStatusTransitionAllowed('pending', 'rejected')).toBe(true);
      expect(isLabStatusTransitionAllowed('collected', 'rejected')).toBe(true);
      expect(isLabStatusTransitionAllowed('received', 'rejected')).toBe(true);
      expect(isLabStatusTransitionAllowed('processing', 'rejected')).toBe(true);
    });

    it('should allow recollection from rejected state', () => {
      expect(isLabStatusTransitionAllowed('rejected', 'pending')).toBe(true);
    });

    it('should block transitions from terminal states', () => {
      expect(isLabStatusTransitionAllowed('verified', 'pending')).toBe(false);
      expect(isLabStatusTransitionAllowed('cancelled', 'pending')).toBe(false);
    });
  });

  describe('Barcode and Scan Resolution', () => {
    it('should generate scanner-safe sample barcodes', () => {
      expect(buildLabSampleBarcode(1)).toBe('SAMPLE-000001');
      expect(buildLabSampleBarcode(45)).toBe('SAMPLE-000045');
      expect(buildLabSampleBarcode(999999)).toBe('SAMPLE-999999');
    });

    it('should resolve LABORDER format', () => {
      const result = resolveLabScanCode('LABORDER-000123');
      expect(result.entityType).toBe('order');
      expect(result.orderNo).toBe('LO-000123');
    });

    it('should resolve LO format', () => {
      const result = resolveLabScanCode('LO-456');
      expect(result.entityType).toBe('order');
      expect(result.orderNo).toBe('LO-456');
    });

    it('should resolve SAMPLE format', () => {
      const result = resolveLabScanCode('SAMPLE-000456');
      expect(result.entityType).toBe('sample');
      expect(result.sampleBarcode).toBe('SAMPLE-000456');
      expect(result.itemId).toBe(456);
    });

    it('should resolve TEST format', () => {
      const result = resolveLabScanCode('TEST-789');
      expect(result.entityType).toBe('item');
      expect(result.itemId).toBe(789);
    });

    it('should resolve generic alphanumeric as sample barcode', () => {
      const result = resolveLabScanCode('ABC-123-XYZ');
      expect(result.entityType).toBe('sample');
      expect(result.sampleBarcode).toBe('ABC-123-XYZ');
    });

    it('should return unknown for empty input', () => {
      const result = resolveLabScanCode('');
      expect(result.entityType).toBe('unknown');
    });
  });

  describe('TAT (Turnaround Time) Calculations', () => {
    it('should calculate TAT in minutes', () => {
      const orderedAt = '2026-05-18T08:00:00.000Z';
      const completedAt = '2026-05-18T09:45:00.000Z';
      expect(calculateLabTatMinutes(orderedAt, completedAt)).toBe(105);
    });

    it('should return null for invalid dates', () => {
      expect(calculateLabTatMinutes(null, null)).toBeNull();
      expect(calculateLabTatMinutes('invalid', 'invalid')).toBeNull();
    });

    it('should calculate TAT to current time when completedAt is null', () => {
      const orderedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      const tat = calculateLabTatMinutes(orderedAt, null);
      expect(tat).toBeGreaterThanOrEqual(59);
      expect(tat).toBeLessThanOrEqual(61);
    });

    it('should detect delayed orders', () => {
      const orderedAt = '2026-05-18T08:00:00.000Z';
      const completedAt = '2026-05-18T09:45:00.000Z'; // 105 minutes

      expect(isLabDelayed(orderedAt, 60, completedAt)).toBe(true); // 60 min target, took 105
      expect(isLabDelayed(orderedAt, 120, completedAt)).toBe(false); // 120 min target, took 105
    });

    it('should not flag as delayed when target TAT is 0 or null', () => {
      expect(isLabDelayed('2026-05-18T08:00:00.000Z', 0, '2026-05-18T20:00:00.000Z')).toBe(false);
      expect(isLabDelayed('2026-05-18T08:00:00.000Z', null, '2026-05-18T20:00:00.000Z')).toBe(false);
    });
  });

  describe('Result Abnormal Flag Detection', () => {
    function detectAbnormalFlag(
      numericValue: number | undefined,
      normalRange: string | null | undefined,
      criticalLow?: number | null,
      criticalHigh?: number | null
    ): 'normal' | 'high' | 'low' | 'critical' | 'pending' {
      if (numericValue === undefined || numericValue === null || !normalRange) {
        return 'pending';
      }

      const rangeStr = normalRange.includes('|')
        ? normalRange.split('|')[0].replace(/^[MF]:/, '')
        : normalRange;

      const match = rangeStr.match(/^([\d.]+)-([\d.]+)$/);
      if (!match) return 'pending';

      const low = parseFloat(match[1]);
      const high = parseFloat(match[2]);

      if (isNaN(low) || isNaN(high)) return 'pending';

      const cLow = (criticalLow != null && !isNaN(criticalLow)) ? criticalLow : low - (high - low);
      const cHigh = (criticalHigh != null && !isNaN(criticalHigh)) ? criticalHigh : high + (high - low);

      if (numericValue < cLow || numericValue > cHigh) return 'critical';
      if (numericValue < low) return 'low';
      if (numericValue > high) return 'high';
      return 'normal';
    }

    it('should flag normal results within range', () => {
      expect(detectAbnormalFlag(90, '70-110')).toBe('normal');
      expect(detectAbnormalFlag(70, '70-110')).toBe('normal');
      expect(detectAbnormalFlag(110, '70-110')).toBe('normal');
    });

    it('should flag high results above range', () => {
      expect(detectAbnormalFlag(120, '70-110')).toBe('high');
    });

    it('should flag low results below range', () => {
      expect(detectAbnormalFlag(60, '70-110')).toBe('low');
    });

    it('should flag critical results far outside range', () => {
      // critical low = 70 - (110-70) = 30, so 29 is critical
      expect(detectAbnormalFlag(29, '70-110')).toBe('critical');
      // critical high = 110 + (110-70) = 150, so 151 is critical
      expect(detectAbnormalFlag(151, '70-110')).toBe('critical');
    });

    it('should use custom critical thresholds when provided', () => {
      expect(detectAbnormalFlag(50, '70-110', 40, 150)).toBe('low');
      expect(detectAbnormalFlag(35, '70-110', 40, 150)).toBe('critical');
      expect(detectAbnormalFlag(160, '70-110', 40, 150)).toBe('critical');
    });

    it('should handle gender-specific ranges', () => {
      expect(detectAbnormalFlag(4.7, 'M:4.5-5.5|F:4.0-5.0')).toBe('normal');
      expect(detectAbnormalFlag(4.3, 'M:4.5-5.5|F:4.0-5.0')).toBe('low');
    });

    it('should return pending for missing data', () => {
      expect(detectAbnormalFlag(undefined, '70-110')).toBe('pending');
      expect(detectAbnormalFlag(90, null)).toBe('pending');
      expect(detectAbnormalFlag(90, undefined)).toBe('pending');
    });
  });
});
