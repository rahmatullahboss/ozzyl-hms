import { describe, expect, it } from 'vitest';
import { evaluateLisQcGate } from '../src/lib/lis-qc-gate';
import { createMockDB } from './integration/helpers/mock-db';

function createQcDb(options: {
  configured?: number;
  calibrationCount?: number;
  latest?: Record<string, unknown> | null;
  failAt?: 'config' | 'calibration' | 'qc';
} = {}) {
  return createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lab_qc_ranges') && lower.includes('count(*)')) {
        if (options.failAt === 'config') throw new Error('qc schema unavailable');
        return { first: { total: options.configured ?? 1 } };
      }
      if (lower.includes('from lab_calibrations')) {
        if (options.failAt === 'calibration') throw new Error('calibration query failed');
        return { first: { total: options.calibrationCount ?? 0 } };
      }
      if (lower.includes('from lab_qc_results')) {
        if (options.failAt === 'qc') throw new Error('qc query failed');
        return { first: options.latest === undefined ? {
          result_value: 5.1,
          is_out_of_range: 0,
          westgard_violations: '[]',
          created_at: '2026-07-10T07:00:00.000Z',
        } : options.latest };
      }
      return null;
    },
  });
}

const now = new Date('2026-07-10T08:00:00.000Z');

describe('LIS QC gate fail-closed policy', () => {
  it('blocks when QC configuration is missing', async () => {
    const mock = createQcDb({ configured: 0 });
    await expect(evaluateLisQcGate(mock.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'config_missing',
      eligible: false,
      reason: 'qc_not_configured',
    });
  });

  it('blocks when QC configuration cannot be read', async () => {
    const mock = createQcDb({ failAt: 'config' });
    await expect(evaluateLisQcGate(mock.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'system_error',
      eligible: false,
      reason: 'qc_configuration_unavailable',
    });
  });

  it('blocks an overdue or failed calibration', async () => {
    const mock = createQcDb({ calibrationCount: 1 });
    await expect(evaluateLisQcGate(mock.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'fail',
      eligible: false,
      reason: 'calibration_not_current',
    });
  });

  it('blocks when calibration status cannot be established', async () => {
    const mock = createQcDb({ failAt: 'calibration' });
    await expect(evaluateLisQcGate(mock.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'system_error',
      eligible: false,
      reason: 'calibration_status_unavailable',
    });
  });

  it('blocks when no QC result exists', async () => {
    const mock = createQcDb({ latest: null });
    await expect(evaluateLisQcGate(mock.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'not_run',
      eligible: false,
      reason: 'qc_result_missing',
    });
  });

  it('blocks stale QC evidence', async () => {
    const mock = createQcDb({
      latest: {
        result_value: 5.1,
        is_out_of_range: 0,
        westgard_violations: '[]',
        created_at: '2026-07-08T07:00:00.000Z',
      },
    });
    await expect(evaluateLisQcGate(mock.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'stale',
      eligible: false,
      reason: 'qc_result_stale',
    });
  });

  it('blocks failed QC and accepts current passing QC', async () => {
    const failed = createQcDb({
      latest: {
        result_value: 8.5,
        is_out_of_range: 1,
        westgard_violations: '["1_3s"]',
        created_at: '2026-07-10T07:00:00.000Z',
      },
    });
    await expect(evaluateLisQcGate(failed.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'fail',
      eligible: false,
      reason: 'qc_failed',
    });

    const passed = createQcDb();
    await expect(evaluateLisQcGate(passed.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'pass',
      eligible: true,
      reason: 'qc_passed',
    });
  });

  it('blocks when QC evidence cannot be read', async () => {
    const mock = createQcDb({ failAt: 'qc' });
    await expect(evaluateLisQcGate(mock.db as any, 'tenant-1', 1, 7, now)).resolves.toMatchObject({
      state: 'system_error',
      eligible: false,
      reason: 'qc_result_unavailable',
    });
  });
});
