import { describe, expect, it } from 'vitest';
import {
  ADMIN_DASHBOARD_METRICS,
  ADMIN_DASHBOARD_ROLE_PRESETS,
  dashboardWorkspaceForMetric,
} from '../../packages/shared/src/dashboard';

describe('admin dashboard metric registry', () => {
  it('defines unique and complete metric semantics', () => {
    const keys = ADMIN_DASHBOARD_METRICS.map((metric) => metric.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const metric of ADMIN_DASHBOARD_METRICS) {
      expect(metric.key.trim()).not.toBe('');
      expect(metric.fallbackLabel.trim()).not.toBe('');
      expect(metric.description.trim()).not.toBe('');
      expect(metric.formula.trim()).not.toBe('');
      expect(metric.sourceOfTruth.length).toBeGreaterThan(0);
      expect(metric.requiredPermission.trim()).not.toBe('');
      expect(metric.drillTarget.route.startsWith('/')).toBe(true);
      expect(metric.drillTarget.permission).toBe(metric.requiredPermission);
    }
  });

  it('limits the hospital admin primary preset and excludes uncategorized income', () => {
    const preset = ADMIN_DASHBOARD_ROLE_PRESETS.hospital_admin;
    const registryKeys = new Set(ADMIN_DASHBOARD_METRICS.map((metric) => metric.key));

    expect(preset.primaryMetricKeys.length).toBeLessThanOrEqual(10);
    expect(preset.primaryMetricKeys).not.toContain('uncategorized_income');
    expect(preset.primaryMetricKeys.every((key) => registryKeys.has(key))).toBe(true);
  });

  it('keeps revenue, collection, deposits, drawer cash, and doctor liability distinct', () => {
    const byKey = new Map(ADMIN_DASHBOARD_METRICS.map((metric) => [metric.key, metric]));
    const keys = [
      'recognized_income',
      'total_collection',
      'patient_deposit_liability',
      'available_drawer_cash',
      'doctor_payable_outstanding',
    ];

    for (const key of keys) expect(byKey.has(key)).toBe(true);

    expect(byKey.get('recognized_income')?.dateBasis).toBe('posting_date');
    expect(byKey.get('total_collection')?.dateBasis).toBe('payment_date');
    expect(byKey.get('patient_deposit_liability')?.temporalMode).toBe('as_of');
    expect(byKey.get('available_drawer_cash')?.temporalMode).toBe('live');
    expect(byKey.get('doctor_payable_outstanding')?.dateBasis).toBe('commission_accrual_date');

    const formulas = keys.map((key) => byKey.get(key)?.formula);
    expect(new Set(formulas).size).toBe(keys.length);
  });

  it('maps configured legacy metrics into dedicated workspaces without making them primary', () => {
    expect(dashboardWorkspaceForMetric('lab_income')).toBe('diagnostics');
    expect(dashboardWorkspaceForMetric('inventory_low_stock')).toBe('inventory');
    expect(dashboardWorkspaceForMetric('total_commission')).toBe('doctors');
    expect(dashboardWorkspaceForMetric('cash_movement')).toBe('money');
    expect(dashboardWorkspaceForMetric('uncategorized_income')).toBe('audit');

    const primary = ADMIN_DASHBOARD_ROLE_PRESETS.hospital_admin.primaryMetricKeys;
    expect(primary).not.toContain('lab_income');
    expect(primary).not.toContain('inventory_low_stock');
    expect(primary).not.toContain('total_commission');
  });

  it('defines the four supported role presets', () => {
    expect(Object.keys(ADMIN_DASHBOARD_ROLE_PRESETS).sort()).toEqual([
      'accountant',
      'hospital_admin',
      'manager_operations',
      'md_director',
    ]);
  });
});
