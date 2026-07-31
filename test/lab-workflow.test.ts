import { describe, expect, it } from 'vitest';
import {
  buildLabSampleBarcode,
  calculateLabTatMinutes,
  isLabDelayed,
  isLabStatusTransitionAllowed,
  resolveLabScanCode,
} from '../src/lib/lab-workflow';

describe('lab workflow helpers', () => {
  it('allows only forward LIS sample transitions', () => {
    expect(isLabStatusTransitionAllowed('pending', 'collected')).toBe(true);
    expect(isLabStatusTransitionAllowed('collected', 'received')).toBe(true);
    expect(isLabStatusTransitionAllowed('received', 'completed')).toBe(false);
    expect(isLabStatusTransitionAllowed('verified', 'pending')).toBe(false);
    expect(isLabStatusTransitionAllowed('rejected', 'pending')).toBe(true);
  });

  it('builds scanner-safe sample tokens without patient data', () => {
    expect(buildLabSampleBarcode(45)).toBe('SAMPLE-000045');
  });

  it('resolves order, sample, and test scan formats', () => {
    expect(resolveLabScanCode('LABORDER-000123')).toMatchObject({
      entityType: 'order',
      orderNo: 'LO-000123',
    });

    expect(resolveLabScanCode('sample-000456')).toMatchObject({
      entityType: 'sample',
      sampleBarcode: 'SAMPLE-000456',
      itemId: 456,
    });

    expect(resolveLabScanCode('TEST-789')).toMatchObject({
      entityType: 'item',
      itemId: 789,
    });
  });

  it('calculates TAT and delayed flags in minutes', () => {
    const orderedAt = '2026-05-18T08:00:00.000Z';
    const completedAt = '2026-05-18T09:45:00.000Z';
    expect(calculateLabTatMinutes(orderedAt, completedAt)).toBe(105);
    expect(isLabDelayed(orderedAt, 60, completedAt)).toBe(true);
    expect(isLabDelayed(orderedAt, 120, completedAt)).toBe(false);
  });
});
