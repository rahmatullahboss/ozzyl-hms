import { describe, expect, it } from 'vitest';
import {
  INVENTORY_CONSUMPTION_DEDUCTION_MODES,
  INVENTORY_CONSUMPTION_TRIGGER_TYPES,
  buildRuleIdempotencyKey,
  normalizeConsumptionRuleInput,
  shouldAutoPostConsumptionRule,
} from '../src/lib/inventory-consumption-rules';

describe('inventory consumption rule helpers', () => {
  it('exposes trigger types and deduction modes from the design contract', () => {
    expect(INVENTORY_CONSUMPTION_TRIGGER_TYPES).toEqual([
      'billing_item',
      'lab_test',
      'ot_procedure',
      'procedure',
      'nursing_task',
      'emergency_service',
      'pharmacy_sale',
      'package',
      'manual_reference',
    ]);
    expect(INVENTORY_CONSUMPTION_DEDUCTION_MODES).toEqual([
      'auto',
      'suggest_confirm',
      'scan_required',
      'approval_required',
      'manual_only',
    ]);
  });

  it('normalizes rule inputs with soft rollout defaults', () => {
    const normalized = normalizeConsumptionRuleInput({
      tenantId: 't1',
      ruleName: ' Dressing Small ',
      triggerType: 'billing_item',
      triggerId: 45,
      defaultStoreId: 3,
      items: [{ itemId: 7, quantity: 2 }],
    });

    expect(normalized).toMatchObject({
      tenantId: 't1',
      ruleName: 'Dressing Small',
      ruleCode: 'DRESSING-SMALL',
      triggerType: 'billing_item',
      triggerId: 45,
      deductionMode: 'suggest_confirm',
      chargePolicy: 'none',
      isActive: true,
    });
    expect(normalized.items[0]).toMatchObject({
      itemId: 7,
      quantity: 2,
      isMandatory: true,
      requiresScan: false,
      requiresApproval: false,
      highValueFlag: false,
      allowSubstitution: false,
      varianceToleranceQty: 0,
      varianceTolerancePercent: 0,
    });
  });

  it('requires valid trigger type, mode, and positive item quantities', () => {
    expect(() => normalizeConsumptionRuleInput({
      tenantId: 't1',
      ruleName: 'Bad',
      triggerType: 'unknown' as any,
      items: [{ itemId: 1, quantity: 1 }],
    })).toThrow(/invalid trigger type/i);

    expect(() => normalizeConsumptionRuleInput({
      tenantId: 't1',
      ruleName: 'Bad',
      triggerType: 'billing_item',
      deductionMode: 'bad' as any,
      items: [{ itemId: 1, quantity: 1 }],
    })).toThrow(/invalid deduction mode/i);

    expect(() => normalizeConsumptionRuleInput({
      tenantId: 't1',
      ruleName: 'Bad',
      triggerType: 'billing_item',
      items: [{ itemId: 1, quantity: 0 }],
    })).toThrow(/positive quantity/i);
  });

  it('builds stable idempotency keys for matching rules without duplicate engines', () => {
    expect(buildRuleIdempotencyKey({ tenantId: 't1', triggerType: 'billing_item', triggerId: 12, ruleCode: 'DRESSING' })).toBe('t1:billing_item:12:DRESSING');
    expect(buildRuleIdempotencyKey({ tenantId: 't1', triggerType: 'billing_item', ruleCode: undefined })).toBe('t1:billing_item:0:');
  });

  it('only auto-posts low-risk auto rules when policy allows it', () => {
    expect(shouldAutoPostConsumptionRule({ deductionMode: 'auto', hasScanRequiredItems: false, hasApprovalRequiredItems: false }, { autoDeductLowRiskItems: true })).toBe(true);
    expect(shouldAutoPostConsumptionRule({ deductionMode: 'auto', hasScanRequiredItems: true, hasApprovalRequiredItems: false }, { autoDeductLowRiskItems: true })).toBe(false);
    expect(shouldAutoPostConsumptionRule({ deductionMode: 'suggest_confirm', hasScanRequiredItems: false, hasApprovalRequiredItems: false }, { autoDeductLowRiskItems: true })).toBe(false);
    expect(shouldAutoPostConsumptionRule({ deductionMode: 'auto', hasScanRequiredItems: false, hasApprovalRequiredItems: false }, { autoDeductLowRiskItems: false })).toBe(false);
  });
});
