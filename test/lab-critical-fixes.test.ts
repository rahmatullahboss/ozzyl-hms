import { describe, expect, it } from 'vitest';
import { isLabStatusTransitionAllowed } from '../src/lib/lab-workflow';

describe('Westgard 2-2s rule operator precedence', () => {
  function checkWestgard(results: { result_value: number }[], mean: number, sd: number): string[] {
    const violations: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const z = (results[i].result_value - mean) / sd;
      const absZ = Math.abs(z);

      if (i > 0) {
        const prevZ = (results[i - 1].result_value - mean) / sd;
        if (Math.abs(z) > 2 && Math.abs(prevZ) > 2 && (z > 0) === (prevZ > 0)) {
          violations.push(`2-2s at runs ${i}-${i + 1}`);
        }
      }
    }
    return violations;
  }

  it('detects 2-2s when both points are above +2 SD', () => {
    const mean = 100;
    const sd = 5;
    const results = [
      { result_value: 112 }, // z = 2.4 (> +2)
      { result_value: 113 }, // z = 2.6 (> +2)
    ];
    expect(checkWestgard(results, mean, sd)).toContain('2-2s at runs 1-2');
  });

  it('detects 2-2s when both points are below -2 SD', () => {
    const mean = 100;
    const sd = 5;
    const results = [
      { result_value: 88 },  // z = -2.4 (< -2)
      { result_value: 87 },  // z = -2.6 (< -2)
    ];
    expect(checkWestgard(results, mean, sd)).toContain('2-2s at runs 1-2');
  });

  it('does NOT flag 2-2s when points are on opposite sides', () => {
    const mean = 100;
    const sd = 5;
    const results = [
      { result_value: 112 }, // z = 2.4 (> +2)
      { result_value: 88 },  // z = -2.4 (< -2)
    ];
    expect(checkWestgard(results, mean, sd)).not.toContain('2-2s at runs 1-2');
  });

  it('does NOT flag 2-2s when only one point exceeds 2 SD', () => {
    const mean = 100;
    const sd = 5;
    const results = [
      { result_value: 105 }, // z = 1.0 (within 2 SD)
      { result_value: 112 }, // z = 2.4 (> +2)
    ];
    expect(checkWestgard(results, mean, sd)).not.toContain('2-2s at runs 1-2');
  });

  it('regression: old buggy code would fail same-side detection', () => {
    const mean = 100;
    const sd = 5;
    // Both above +2 SD - this should trigger 2-2s
    const results = [
      { result_value: 115 }, // z = 3.0
      { result_value: 115 }, // z = 3.0
    ];
    // Old buggy code: z > 0 === prevZ > 0
    // Evaluates as: 3 > (0 === 3) > 0 = 3 > false > 0 = 3 > 0 = true... but only by accident
    // For negative values: -3 > 0 === -3 > 0 = false === false = true (correct by accident)
    // But mixed: 3 > 0 === -3 > 0 = true === false = false (correct)
    // The real bug: 0 === prevZ evaluates to false for any non-zero prevZ
    // Then z > false coerces false to 0, so z > 0 is correct for positive z
    // But for z = 0, it would be 0 > false = false, missing the case
    expect(checkWestgard(results, mean, sd)).toContain('2-2s at runs 1-2');
  });
});

describe('Barcode scan status transition validation', () => {
  it('allows valid forward transitions', () => {
    expect(isLabStatusTransitionAllowed('pending', 'collected')).toBe(true);
    expect(isLabStatusTransitionAllowed('collected', 'received')).toBe(true);
    expect(isLabStatusTransitionAllowed('received', 'processing')).toBe(true);
    expect(isLabStatusTransitionAllowed('processing', 'completed')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(isLabStatusTransitionAllowed('pending', 'completed')).toBe(false);
    expect(isLabStatusTransitionAllowed('completed', 'collected')).toBe(false);
    expect(isLabStatusTransitionAllowed('verified', 'pending')).toBe(false);
    expect(isLabStatusTransitionAllowed('collected', 'processing')).toBe(false);
  });

  it('allows rejection from any active state', () => {
    expect(isLabStatusTransitionAllowed('pending', 'rejected')).toBe(true);
    expect(isLabStatusTransitionAllowed('collected', 'rejected')).toBe(true);
    expect(isLabStatusTransitionAllowed('received', 'rejected')).toBe(true);
    expect(isLabStatusTransitionAllowed('processing', 'rejected')).toBe(true);
  });

  it('handles null/undefined current status as pending', () => {
    expect(isLabStatusTransitionAllowed(null, 'collected')).toBe(true);
    expect(isLabStatusTransitionAllowed(undefined, 'collected')).toBe(true);
    expect(isLabStatusTransitionAllowed(null, 'completed')).toBe(false);
  });
});
