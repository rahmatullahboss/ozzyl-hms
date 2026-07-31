import { describe, expect, it } from 'vitest';
import {
  REAGENT_CONTROL_PRIMARY_TABS,
  initialReagentControlSection,
  reagentControlNextActions,
  reagentControlQueryState,
  reagentPolicySummary,
} from './reagentControlModel';

describe('reagentControlModel', () => {
  it('defines four task-oriented primary sections and opens on overview', () => {
    expect(REAGENT_CONTROL_PRIMARY_TABS.map(tab => tab.id)).toEqual([
      'overview',
      'stock',
      'recipes',
      'issues',
    ]);
    expect(REAGENT_CONTROL_PRIMARY_TABS.map(tab => tab.label)).toEqual([
      'Overview',
      'Stock',
      'Test Recipes',
      'Issues',
    ]);
    expect(initialReagentControlSection()).toBe('overview');
  });

  it('explains soft mode in plain hospital language', () => {
    expect(reagentPolicySummary({
      lab_inventory_mode: 'soft',
      reagent_consumption_timing: 'billing',
      allow_result_without_stock: true,
      require_test_mapping_for_completion: false,
    })).toEqual({
      tone: 'safe',
      title: 'Safe rollout is active',
      description: 'Reagent deduction is attempted when a lab test is billed. Missing stock or recipes create warnings instead of stopping service.',
      timing: 'When billed',
      blocking: 'Billing and results continue',
      recipes: 'Missing recipes create warnings',
    });
  });

  it('uses the actual deduction timing in soft-mode guidance', () => {
    expect(reagentPolicySummary({
      lab_inventory_mode: 'soft',
      reagent_consumption_timing: 'result',
      allow_result_without_stock: true,
      require_test_mapping_for_completion: false,
    })).toMatchObject({
      title: 'Safe rollout is active',
      timing: 'When result is completed',
      description: 'Reagent deduction is attempted when a lab result is completed. Missing stock or recipes create warnings instead of stopping service.',
    });
  });

  it('explains strict and disabled modes without ambiguous labels', () => {
    expect(reagentPolicySummary({
      lab_inventory_mode: 'strict',
      reagent_consumption_timing: 'result',
      allow_result_without_stock: false,
      require_test_mapping_for_completion: true,
    })).toMatchObject({
      tone: 'strict',
      title: 'Strict stock control is active',
      timing: 'When result is completed',
      blocking: 'Unsafe stock cases can stop completion',
      recipes: 'Test recipes are required',
    });

    expect(reagentPolicySummary({
      lab_inventory_mode: 'disabled',
      reagent_consumption_timing: 'billing',
      allow_result_without_stock: true,
      require_test_mapping_for_completion: false,
    })).toMatchObject({
      tone: 'off',
      title: 'Reagent control is off',
      blocking: 'No reagent stock is deducted',
    });
  });

  it('returns at most three prioritized next actions', () => {
    const actions = reagentControlNextActions({
      inventoryMode: 'disabled',
      missingRecipes: 4,
      lowStockCount: 3,
      expiringCount: 2,
      openIssues: 5,
      reconciliationIssues: 1,
    });

    expect(actions).toHaveLength(3);
    expect(actions.map(action => action.id)).toEqual([
      'enable-safe-control',
      'fix-recipes',
      'review-stock',
    ]);
  });

  it('returns a healthy state when no action is needed', () => {
    expect(reagentControlNextActions({
      inventoryMode: 'soft',
      missingRecipes: 0,
      lowStockCount: 0,
      expiringCount: 0,
      openIssues: 0,
      reconciliationIssues: 0,
    })).toEqual([]);
  });

  it('enables only section-specific heavy queries', () => {
    expect(reagentControlQueryState('overview')).toEqual({
      loadRecipes: false,
      loadStockDetails: false,
      loadReconciliation: false,
      loadLogs: false,
      loadReadinessDetails: false,
    });
    expect(reagentControlQueryState('recipes')).toMatchObject({
      loadRecipes: true,
      loadReconciliation: false,
      loadLogs: false,
    });
    expect(reagentControlQueryState('stock')).toMatchObject({
      loadStockDetails: true,
      loadRecipes: false,
    });
    expect(reagentControlQueryState('issues')).toMatchObject({
      loadReconciliation: true,
      loadRecipes: false,
    });
    expect(reagentControlQueryState('overview', { advancedOpen: true })).toMatchObject({
      loadLogs: true,
      loadReadinessDetails: true,
    });
  });
});
