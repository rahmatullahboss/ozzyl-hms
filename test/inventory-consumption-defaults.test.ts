import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_INVENTORY_CONSUMPTION_RULE_TEMPLATES,
  buildInventoryConsumptionSeedToast,
  normalizeInventoryConsumptionTemplateCode,
} from '../src/lib/inventory-consumption-defaults';

describe('inventory consumption default starter rules', () => {
  it('defines editable starter rules for common procedure and OT workflows', () => {
    const codes = DEFAULT_INVENTORY_CONSUMPTION_RULE_TEMPLATES.map(rule => rule.ruleCode);
    expect(codes).toEqual(expect.arrayContaining([
      'DRESSING_SMALL',
      'NEBULIZATION',
      'IV_CANNULATION',
      'C_SECTION_STANDARD_PACK',
      'APPENDECTOMY_STANDARD_PACK',
    ]));
    const otRule = DEFAULT_INVENTORY_CONSUMPTION_RULE_TEMPLATES.find(rule => rule.ruleCode === 'C_SECTION_STANDARD_PACK');
    expect(otRule).toMatchObject({ triggerType: 'ot_procedure', deductionMode: 'suggest_confirm', department: 'OT' });
    expect(otRule?.items.length).toBeGreaterThan(2);
  });

  it('normalizes template codes and formats seed summaries for UI feedback', () => {
    expect(normalizeInventoryConsumptionTemplateCode('Dressing Small')).toBe('DRESSING_SMALL');
    expect(buildInventoryConsumptionSeedToast({ rules: 7, created: 3, skipped: 4 })).toBe('Starter consumption rules checked: 7 rules, 3 created, 4 skipped.');
  });

  it('exposes a manager-safe seed endpoint and UI action', () => {
    const route = readFileSync('src/routes/tenant/inventory/consumptionRules.ts', 'utf8');
    const ui = readFileSync('web/src/pages/inventory/InventoryConsumptionAutomation.tsx', 'utf8');
    const test = readFileSync('web/src/pages/inventory/InventoryConsumptionAutomation.test.ts', 'utf8');
    expect(route).toContain('/defaults/seed');
    expect(route).toContain('seedInventoryConsumptionDefaults');
    expect(ui).toContain('/api/inventory/consumption-rules/defaults/seed');
    expect(ui).toContain('data-testid="seed-inventory-consumption-rules"');
    expect(test).toContain('seed-inventory-consumption-rules');
  });
});
