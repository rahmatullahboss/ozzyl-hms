import { describe, expect, it } from 'vitest';
import {
  evaluateProductionFinancialShadowScope,
  PRODUCTION_FINANCIAL_SHADOW_SCOPE_SQL,
  type ProductionFinancialShadowFlagRow,
} from '../../scripts/canonical/validate-production-financial-shadow-scope';

function rows(): ProductionFinancialShadowFlagRow[] {
  return [
    { tenant_id: '100', tenant_status: 'active', flag_count: 1, domain: 'financial', mode: 'shadow', is_enabled: 1, version: 6, config_json: '{"tenantScope":["100"],"writePolicy":"shadow"}' },
    { tenant_id: '101', tenant_status: 'active', flag_count: 1, domain: 'financial', mode: 'shadow', is_enabled: 1, version: 1, config_json: '{"tenantScope":["101"],"writePolicy":"shadow"}' },
    { tenant_id: '102', tenant_status: 'active', flag_count: 1, domain: 'financial', mode: 'shadow', is_enabled: 1, version: 1, config_json: '{"tenantScope":["102"],"writePolicy":"shadow"}' },
  ];
}

describe('production financial shadow scope', () => {
  it('queries every active tenant and any orphan financial flag without mutating data', () => {
    expect(PRODUCTION_FINANCIAL_SHADOW_SCOPE_SQL).toContain("FROM tenants WHERE status='active'");
    expect(PRODUCTION_FINANCIAL_SHADOW_SCOPE_SQL).toContain("canonical_financial_dual_write_v1");
    expect(PRODUCTION_FINANCIAL_SHADOW_SCOPE_SQL).toContain('UNION');
    expect(PRODUCTION_FINANCIAL_SHADOW_SCOPE_SQL).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  it('accepts one exact enabled shadow policy per active tenant', () => {
    expect(evaluateProductionFinancialShadowScope(rows())).toEqual({
      schemaVersion: 1,
      evidenceReady: true,
      activationReady: true,
      activeTenantIds: ['100', '101', '102'],
      issueCount: 0,
      issues: [],
      aggregateOnly: true,
      productionMutationPerformed: false,
      rowsWritten: 0,
    });
  });

  it('reports missing, malformed, disabled and duplicate active-tenant policies', () => {
    const input = rows();
    input[0] = { ...input[0], flag_count: 0, domain: null, mode: null, is_enabled: null, version: null, config_json: null };
    input[1] = { ...input[1], mode: 'disabled', is_enabled: 0 };
    input[2] = { ...input[2], flag_count: 2, config_json: '{"tenantScope":["999"],"writePolicy":"strict"}' };
    const receipt = evaluateProductionFinancialShadowScope(input);
    expect(receipt.activationReady).toBe(false);
    expect(receipt.issues).toEqual(expect.arrayContaining([
      'FINANCIAL_SHADOW_FLAG_MISSING:100',
      'FINANCIAL_SHADOW_FLAG_NOT_ACTIVE:101',
      'FINANCIAL_SHADOW_FLAG_DUPLICATE:102',
      'FINANCIAL_SHADOW_FLAG_CONFIG_INVALID:102',
    ]));
  });

  it('reports a financial flag that belongs to an inactive tenant', () => {
    const receipt = evaluateProductionFinancialShadowScope([
      ...rows(),
      { tenant_id: '200', tenant_status: 'inactive', flag_count: 1, domain: 'financial', mode: 'shadow', is_enabled: 1, version: 1, config_json: '{"tenantScope":["200"],"writePolicy":"shadow"}' },
    ]);
    expect(receipt.activationReady).toBe(false);
    expect(receipt.issues).toContain('FINANCIAL_SHADOW_FLAG_ORPHAN:200');
  });

  it('rejects unsafe or duplicate tenant identities in evidence', () => {
    expect(() => evaluateProductionFinancialShadowScope([
      { ...rows()[0], tenant_id: ' 100' },
    ])).toThrow(/tenant/i);
    expect(() => evaluateProductionFinancialShadowScope([
      rows()[0], rows()[0],
    ])).toThrow(/duplicate tenant evidence/i);
  });
});
