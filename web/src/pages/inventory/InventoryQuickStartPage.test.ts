import { describe, expect, it } from 'vitest';
import { buildDefaultLabItemsPath, buildDefaultStoresPath, buildProcessGuidePath, buildQuickStartReadinessPath, readinessLabel, statusTone } from './InventoryQuickStartPage';

describe('InventoryQuickStartPage helpers', () => {
  it('builds readiness API endpoints by mode', () => {
    expect(buildQuickStartReadinessPath('simple')).toBe('/api/inventory/quick-start/readiness?mode=simple');
    expect(buildQuickStartReadinessPath('standard')).toBe('/api/inventory/quick-start/readiness?mode=standard');
    expect(buildQuickStartReadinessPath('enterprise')).toBe('/api/inventory/quick-start/readiness?mode=enterprise');
  });

  it('builds default-store setup endpoint', () => {
    expect(buildDefaultStoresPath()).toBe('/api/inventory/quick-start/default-stores');
  });

  it('builds default lab item master setup endpoint', () => {
    expect(buildDefaultLabItemsPath()).toBe('/api/inventory/quick-start/default-lab-items');
  });

  it('builds process-guide endpoint by mode', () => {
    expect(buildProcessGuidePath('simple')).toBe('/api/inventory/quick-start/process-guide?mode=simple');
    expect(buildProcessGuidePath('enterprise')).toBe('/api/inventory/quick-start/process-guide?mode=enterprise');
  });

  it('labels readiness scores for small-hospital setup guidance', () => {
    expect(readinessLabel(90)).toContain('Enterprise');
    expect(readinessLabel(75)).toContain('small hospital');
    expect(readinessLabel(50)).toContain('attention');
    expect(readinessLabel(20)).toContain('not ready');
  });

  it('maps checklist status to visible tones', () => {
    expect(statusTone('done')).toContain('emerald');
    expect(statusTone('warning')).toContain('amber');
    expect(statusTone('missing')).toContain('red');
    expect(statusTone('action_required')).toContain('red');
  });
});
