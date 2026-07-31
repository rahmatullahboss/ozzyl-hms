import { describe, expect, it } from 'vitest';
import {
  canRunInventoryIntelligenceMutation,
  classifyDashboardStatus,
  isInventoryIntelligenceSchemaError,
  parsePositiveIntegerParam,
} from '../../src/routes/tenant/inventory/intelligence';

describe('inventory intelligence route helpers', () => {
  it('parses only safe positive integer route params', () => {
    expect(parsePositiveIntegerParam('42')).toBe(42);
    expect(parsePositiveIntegerParam('0')).toBeNull();
    expect(parsePositiveIntegerParam('-1')).toBeNull();
    expect(parsePositiveIntegerParam('1.5')).toBeNull();
    expect(parsePositiveIntegerParam('abc')).toBeNull();
  });

  it('detects only expected missing intelligence table errors', () => {
    expect(isInventoryIntelligenceSchemaError(new Error('D1_ERROR: no such table: inventory_recommendation'))).toBe(true);
    expect(isInventoryIntelligenceSchemaError(new Error('no such table: inventory_stock_intelligence_snapshot'))).toBe(true);
    expect(isInventoryIntelligenceSchemaError(new Error('database is locked'))).toBe(false);
    expect(isInventoryIntelligenceSchemaError('no such table: inventory_recommendation')).toBe(true);
  });

  it('classifies dashboard status as not configured, stale, or ready', () => {
    expect(classifyDashboardStatus({ snapshotCount: 0, lastComputedAt: null, now: '2026-07-05T00:00:00.000Z' })).toBe('not_configured');
    expect(classifyDashboardStatus({ snapshotCount: 2, lastComputedAt: '2026-07-01T00:00:00.000Z', now: '2026-07-05T00:00:00.000Z' })).toBe('stale');
    expect(classifyDashboardStatus({ snapshotCount: 2, lastComputedAt: '2026-07-05T00:00:00.000Z', now: '2026-07-05T12:00:00.000Z' })).toBe('ready');
  });

  it('allows only operational leadership roles to change intelligence state', () => {
    expect(canRunInventoryIntelligenceMutation('hospital_admin')).toBe(true);
    expect(canRunInventoryIntelligenceMutation('md')).toBe(true);
    expect(canRunInventoryIntelligenceMutation('director')).toBe(true);
    expect(canRunInventoryIntelligenceMutation('reception')).toBe(false);
    expect(canRunInventoryIntelligenceMutation('nurse')).toBe(false);
    expect(canRunInventoryIntelligenceMutation('doctor')).toBe(false);
    expect(canRunInventoryIntelligenceMutation(undefined)).toBe(false);
  });
});
